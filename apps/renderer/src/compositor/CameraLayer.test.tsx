import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

function mount(state: CameraState, segmenter = new FakeSegmenter()): Harness {
  const statuses: [SegmentationStatus, string | undefined][] = [];
  const props = {
    stream: {} as MediaStream,
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
    // Camera frame, then the mask composited over it.
    expect(draws.length).toBe(2);
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
