import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cameraReducer, initialCameraState } from '../camera/cameraState.js';
import type { CameraAction } from '../camera/cameraState.js';
import type { CameraMode, CameraState, SegmentationStatus } from '../camera/types.js';
import { installFakeCanvas, stubVideoSize, type FrameClock } from '../test/fakeCanvas.js';
import { FakeSegmenter, solidMask } from '../test/fakeSegmenter.js';
import { CameraLayer } from './CameraLayer.js';

const READY: CameraAction = {
  type: 'stream/ready',
  deviceId: 'cam-a',
  resolution: { width: 1280, height: 720 },
};

function cameraState(mode: CameraMode, ...extra: CameraAction[]): CameraState {
  const base: CameraAction[] =
    mode === 'off' ? [] : [{ type: 'mode/set', mode }, READY, ...extra];
  return base.reduce(cameraReducer, initialCameraState);
}

let canvas: ReturnType<typeof installFakeCanvas>;
let frames: FrameClock;
let restoreVideo: () => void;

beforeEach(() => {
  canvas = installFakeCanvas();
  frames = canvas.frames;
  restoreVideo = stubVideoSize(1280, 720);
});

afterEach(() => {
  cleanup();
  restoreVideo();
  canvas.restore();
});

interface Harness {
  readonly segmenter: FakeSegmenter;
  readonly statuses: [SegmentationStatus, string | undefined][];
  readonly container: HTMLElement;
  rerenderWith(state: CameraState): void;
  unmount(): void;
}

function mount(
  state: CameraState,
  segmenter = new FakeSegmenter(),
  view: 'composite' | 'matte' = 'composite',
): Harness {
  const statuses: [SegmentationStatus, string | undefined][] = [];
  const props = {
    stream: {} as MediaStream,
    view,
    onSegmentationStatus: (status: SegmentationStatus, error?: string) => {
      statuses.push([status, error]);
    },
    createSegmenter: () => segmenter,
  };

  const { container, rerender, unmount } = render(<CameraLayer state={state} {...props} />);

  return {
    segmenter,
    statuses,
    container,
    rerenderWith: (next) => rerender(<CameraLayer state={next} {...props} />),
    unmount,
  };
}

const cameraCanvas = (container: HTMLElement) => container.querySelector('.camera-layer');
const drawCalls = () =>
  canvas.contexts.flatMap((context) => context.calls.filter((call) => call[0] === 'drawImage'));

describe('CameraLayer when the camera is off', () => {
  it('mounts no canvas and runs no animation loop', () => {
    const { container } = mount(cameraState('off'));

    expect(cameraCanvas(container)).toBeNull();
    expect(frames.scheduled).toBe(0);
  });

  it('never creates a segmenter', () => {
    const { segmenter } = mount(cameraState('off'));

    expect(segmenter.initialized).toBe(0);
  });

  it('still provides the video element the stream decodes into', () => {
    const { container } = mount(cameraState('off'));

    expect(container.querySelector('.camera-source')).not.toBeNull();
  });
});

describe('CameraLayer in raw mode', () => {
  it('draws the camera every frame with no segmentation', () => {
    const { container, segmenter } = mount(cameraState('raw'));

    expect(cameraCanvas(container)).not.toBeNull();
    act(() => frames.tick());

    expect(drawCalls().length).toBeGreaterThan(0);
    expect(segmenter.initialized).toBe(0);
    expect(segmenter.calls).toHaveLength(0);
  });

  it('keeps the loop running across frames', () => {
    mount(cameraState('raw'));

    act(() => frames.tick());
    const first = drawCalls().length;
    act(() => frames.tick());

    expect(drawCalls().length).toBeGreaterThan(first);
  });

  it('stops the loop when the camera is switched off', () => {
    const { rerenderWith } = mount(cameraState('raw'));
    act(() => frames.tick());

    act(() => rerenderWith(cameraState('off')));

    expect(frames.scheduled).toBe(0);
  });
});

describe('CameraLayer in segmented mode', () => {
  it('initialises the segmenter and reports its progress', async () => {
    const { segmenter, statuses } = mount(cameraState('segmented'));

    await waitFor(() => expect(statuses.map(([status]) => status)).toContain('ready'));
    expect(segmenter.initialized).toBe(1);
    expect(statuses[0]?.[0]).toBe('loading');
  });

  it('withholds the frame until the first mask arrives', async () => {
    const { segmenter, statuses } = mount(cameraState('segmented'));
    await waitFor(() => expect(statuses.map(([s]) => s)).toContain('ready'));

    act(() => frames.tick());

    // The input canvas is written to, but nothing reaches the subject layer:
    // showing the raw feed here would leak the physical background.
    expect(segmenter.calls.length).toBeGreaterThan(0);
    const layer = canvas.contexts.find((context) =>
      context.canvas.classList.contains('camera-layer'),
    );
    expect(layer?.calls.some((call) => call[0] === 'drawImage')).toBe(false);
  });

  it('composites the subject once a mask exists', async () => {
    const { segmenter, statuses } = mount(cameraState('segmented'));
    await waitFor(() => expect(statuses.map(([s]) => s)).toContain('ready'));

    act(() => frames.tick());
    await act(async () => {
      segmenter.finishOne(solidMask(16, 9, 1));
    });
    act(() => frames.tick(50));

    const layer = canvas.contexts.find((context) =>
      context.canvas.classList.contains('camera-layer'),
    );
    const draws = layer?.calls.filter((call) => call[0] === 'drawImage') ?? [];
    // Every draw is a camera frame followed by the mask composited over it.
    expect(draws.length).toBeGreaterThanOrEqual(2);
    expect(draws.length % 2).toBe(0);
    expect(layer?.calls.some((call) => call[0] === 'setTransform')).toBe(true);
  });

  it('never runs two inferences at once, however many frames pass', async () => {
    const { segmenter, statuses } = mount(cameraState('segmented'));
    await waitFor(() => expect(statuses.map(([s]) => s)).toContain('ready'));

    act(() => {
      for (let i = 0; i < 12; i += 1) frames.tick(50);
    });

    expect(segmenter.inFlight).toBe(1);
    expect(segmenter.calls).toHaveLength(1);
  });

  it('keeps drawing after segmentation fails to start', async () => {
    const segmenter = new FakeSegmenter();
    segmenter.failInitialize = new Error('no WebGL delegate');
    const { statuses, container } = mount(cameraState('segmented'), segmenter);

    await waitFor(() =>
      expect(statuses.some(([status]) => status === 'failed')).toBe(true),
    );

    // The renderer keeps running; only the subject is missing.
    expect(statuses.at(-1)?.[1]).toBe('no WebGL delegate');
    expect(cameraCanvas(container)).not.toBeNull();
    expect(() => act(() => frames.tick())).not.toThrow();
  });

  it('does not submit frames when the segmenter never came up', async () => {
    const segmenter = new FakeSegmenter();
    segmenter.failInitialize = new Error('nope');
    const { statuses } = mount(cameraState('segmented'), segmenter);
    await waitFor(() => expect(statuses.some(([s]) => s === 'failed')).toBe(true));

    act(() => frames.tick());

    expect(segmenter.calls).toHaveLength(0);
  });

  it('disposes the segmenter when leaving segmented mode', async () => {
    const { segmenter, statuses, rerenderWith } = mount(cameraState('segmented'));
    await waitFor(() => expect(statuses.map(([s]) => s)).toContain('ready'));

    await act(async () => rerenderWith(cameraState('raw')));

    expect(segmenter.disposed).toBe(1);
  });

  it('disposes the segmenter on unmount', async () => {
    const { segmenter, statuses, unmount } = mount(cameraState('segmented'));
    await waitFor(() => expect(statuses.map(([s]) => s)).toContain('ready'));

    await act(async () => unmount());

    expect(segmenter.disposed).toBe(1);
  });

  it('rebuilds the segmenter when the quality preset changes', async () => {
    const { segmenter, statuses, rerenderWith } = mount(cameraState('segmented'));
    await waitFor(() => expect(statuses.map(([s]) => s)).toContain('ready'));

    await act(async () =>
      rerenderWith(cameraState('segmented', { type: 'quality/set', quality: 'quality' })),
    );

    expect(segmenter.disposed).toBe(1);
    expect(segmenter.initialized).toBe(2);
  });

  it('reports diagnostics only when something is listening', async () => {
    const segmenter = new FakeSegmenter();
    const reports: unknown[] = [];
    const state = cameraState('raw');

    const { rerender } = render(
      <CameraLayer
        state={state}
        stream={{} as MediaStream}
        onSegmentationStatus={() => {}}
        createSegmenter={() => segmenter}
      />,
    );
    act(() => frames.tick(600));
    expect(reports).toHaveLength(0);

    rerender(
      <CameraLayer
        state={state}
        stream={{} as MediaStream}
        onSegmentationStatus={() => {}}
        createSegmenter={() => segmenter}
        onStats={(stats) => reports.push(stats)}
      />,
    );
    act(() => frames.tick(600));

    expect(reports.length).toBeGreaterThan(0);
  });
});

const layerCalls = () =>
  canvas.contexts.find((context) => context.canvas.classList.contains('camera-layer'))?.calls ??
  [];
/** Sources of the camera-frame draws on the subject layer (every other draw is a mask). */
const frameSources = () =>
  layerCalls()
    .filter((call) => call[0] === 'drawImage')
    .filter((_, index) => index % 2 === 0)
    .map((call) => call[1]);

async function firstMask(segmenter: FakeSegmenter, statuses: Harness['statuses']) {
  await waitFor(() => expect(statuses.map(([s]) => s)).toContain('ready'));
  act(() => frames.tick());
  await act(async () => {
    segmenter.finishOne(solidMask(16, 9, 1));
  });
}

describe('CameraLayer frame and mask synchronisation', () => {
  // The scheduler's rate limit reads `performance.now()`; tie it to the
  // animation clock so ticking frames also advances time for it.
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => frames.time);
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws the frame the mask was computed from, never the live video', async () => {
    const { segmenter, statuses, container } = mount(cameraState('segmented'));
    await firstMask(segmenter, statuses);
    act(() => frames.tick());

    const video = container.querySelector('video');
    const sources = frameSources();
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).not.toBe(video);
      expect(source).toBeInstanceOf(HTMLCanvasElement);
    }
  });

  it('keeps the previous pair on screen while the next frame is segmented', async () => {
    const { segmenter, statuses } = mount(cameraState('segmented'));
    await firstMask(segmenter, statuses);
    const shown = frameSources().at(-1);

    // The next inference starts on a newer frame but has not finished.
    act(() => frames.tick(50));
    expect(segmenter.inFlight).toBe(1);
    act(() => frames.tick(50));

    expect(frameSources().at(-1)).toBe(shown);
  });

  it('shows the new frame as soon as its own mask arrives', async () => {
    const { segmenter, statuses } = mount(cameraState('segmented'));
    await firstMask(segmenter, statuses);
    const first = frameSources().at(-1);

    act(() => frames.tick(50));
    await act(async () => {
      segmenter.finishOne(solidMask(16, 9, 1));
    });

    expect(frameSources().at(-1)).not.toBe(first);
  });

  it('does not redraw an unchanged pair on every animation frame', async () => {
    const segmenter = new FakeSegmenter();
    const { statuses } = mount(cameraState('segmented'), segmenter);
    await firstMask(segmenter, statuses);
    const before = frameSources().length;

    // Inference for the next frame is held open, so nothing new can be shown.
    act(() => {
      for (let i = 0; i < 5; i += 1) frames.tick();
    });

    expect(frameSources().length).toBe(before);
  });

  it('segments each camera frame at most once where frames are reported', async () => {
    let present: (() => void) | null = null;
    const prototype = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
    prototype.requestVideoFrameCallback = (callback: (now: number) => void) => {
      present = () => callback(frames.time);
      return 1;
    };
    prototype.cancelVideoFrameCallback = () => {};
    try {
      const segmenter = new FakeSegmenter();
      segmenter.manual = false;
      const { statuses } = mount(cameraState('segmented'), segmenter);
      await waitFor(() => expect(statuses.map(([s]) => s)).toContain('ready'));

      // No camera frame yet: nothing to segment.
      act(() => frames.tick(50));
      expect(segmenter.calls).toHaveLength(0);

      act(() => present?.());
      await act(async () => frames.tick(50));
      await act(async () => frames.tick(50));
      await act(async () => frames.tick(50));

      // One camera frame, one inference, however many animation frames ran.
      expect(segmenter.calls).toHaveLength(1);
    } finally {
      delete prototype.requestVideoFrameCallback;
      delete prototype.cancelVideoFrameCallback;
    }
  });

  it('segments a frame that arrived during inference once inference finishes', async () => {
    let present: (() => void) | null = null;
    const prototype = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
    prototype.requestVideoFrameCallback = (callback: (now: number) => void) => {
      present = () => callback(frames.time);
      return 1;
    };
    prototype.cancelVideoFrameCallback = () => {};
    try {
      const segmenter = new FakeSegmenter();
      const { statuses } = mount(cameraState('segmented'), segmenter);
      await waitFor(() => expect(statuses.map(([s]) => s)).toContain('ready'));

      act(() => present?.());
      act(() => frames.tick(50));
      expect(segmenter.calls).toHaveLength(1);

      // A camera frame arrives while that inference is still running.
      act(() => present?.());
      act(() => frames.tick(50));
      expect(segmenter.calls).toHaveLength(1);

      await act(async () => segmenter.finishOne(solidMask(16, 9, 1)));
      act(() => frames.tick(50));

      // It was kept, not dropped: no further camera frame was needed.
      expect(segmenter.calls).toHaveLength(2);
    } finally {
      delete prototype.requestVideoFrameCallback;
      delete prototype.cancelVideoFrameCallback;
    }
  });

  it('releases every held frame when segmentation stops', async () => {
    const open = new Set<number>();
    let made = 0;
    vi.stubGlobal(
      'VideoFrame',
      class {
        readonly id = ++made;
        readonly displayWidth = 1280;
        readonly displayHeight = 720;
        constructor() {
          open.add(this.id);
        }
        close() {
          open.delete(this.id);
        }
      },
    );
    try {
      const { segmenter, statuses, rerenderWith } = mount(cameraState('segmented'));
      await firstMask(segmenter, statuses);
      act(() => frames.tick(50));
      expect(made).toBe(2);
      expect(open.size).toBe(2);

      await act(async () => rerenderWith(cameraState('raw')));

      expect(open.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('CameraLayer matte view', () => {
  it('draws the mask on black instead of the subject', async () => {
    const segmenter = new FakeSegmenter();
    const { statuses } = mount(cameraState('segmented'), segmenter, 'matte');
    await firstMask(segmenter, statuses);

    const draws = layerCalls().filter((call) => call[0] === 'drawImage');
    const fills = layerCalls().filter((call) => call[0] === 'fillRect');
    // One black fill and one mask per draw: no camera frame reaches the canvas.
    expect(draws.length).toBeGreaterThan(0);
    expect(fills.length).toBe(draws.length);
  });

  it('never applies to raw mode', () => {
    mount(cameraState('raw'), new FakeSegmenter(), 'matte');
    act(() => frames.tick());

    expect(layerCalls().some((call) => call[0] === 'fillRect')).toBe(false);
  });

  it('is not drawn by default', async () => {
    const segmenter = new FakeSegmenter();
    const { statuses } = mount(cameraState('segmented'), segmenter);
    await firstMask(segmenter, statuses);

    expect(layerCalls().some((call) => call[0] === 'fillRect')).toBe(false);
  });
});
