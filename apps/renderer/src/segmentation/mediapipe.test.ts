import { beforeEach, describe, expect, it, vi } from 'vitest';

const forVisionTasks = vi.fn();
const createFromOptions = vi.fn();

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks },
  ImageSegmenter: { createFromOptions },
}));

const {
  MEDIAPIPE_WASM_PATH,
  MediaPipeSubjectSegmenter,
  SELFIE_SEGMENTER_MODEL_PATH,
  defaultMediaPipeOptions,
  resolveAssetUrl,
} = await import('./mediapipe.js');

const FRAME = {} as HTMLCanvasElement;

interface FakeMask {
  width: number;
  height: number;
  getAsFloat32Array: () => Float32Array;
}

function mask(width: number, height: number, fill: number): FakeMask {
  return {
    width,
    height,
    getAsFloat32Array: () => new Float32Array(width * height).fill(fill),
  };
}

function fakeSegmenter(masks: FakeMask[] | undefined) {
  return {
    close: vi.fn(),
    segmentForVideo: vi.fn(
      (_frame: unknown, _ts: number, callback: (r: unknown) => void) => {
        callback({ confidenceMasks: masks });
      },
    ),
  };
}

const OPTIONS = {
  wasmBaseUrl: 'http://127.0.0.1:5173/vendor/mediapipe/wasm',
  modelUrl: 'http://127.0.0.1:5173/models/selfie_segmenter.tflite',
  delegate: 'GPU' as const,
};

const delegatesTried = () =>
  createFromOptions.mock.calls.map((call) => (call[1] as { baseOptions: { delegate: string } }).baseOptions.delegate);

beforeEach(() => {
  forVisionTasks.mockReset().mockResolvedValue({ wasmLoaderPath: 'x' });
  createFromOptions.mockReset();
});

describe('asset resolution', () => {
  it('serves the runtime and model from the renderer origin, not a CDN', () => {
    const options = defaultMediaPipeOptions('http://127.0.0.1:4173/');

    expect(options.wasmBaseUrl).toBe('http://127.0.0.1:4173/vendor/mediapipe/wasm');
    expect(options.modelUrl).toBe('http://127.0.0.1:4173/models/selfie_segmenter.tflite');
  });

  it('keeps assets relative so a sub-path deployment still resolves', () => {
    expect(resolveAssetUrl(MEDIAPIPE_WASM_PATH, 'http://host/livescape/')).toBe(
      'http://host/livescape/vendor/mediapipe/wasm',
    );
    expect(resolveAssetUrl(SELFIE_SEGMENTER_MODEL_PATH, 'http://host/livescape/')).toBe(
      'http://host/livescape/models/selfie_segmenter.tflite',
    );
  });
});

describe('delegate selection', () => {
  it('prefers the GPU delegate', async () => {
    createFromOptions.mockResolvedValue(fakeSegmenter([mask(2, 2, 1)]));
    const segmenter = new MediaPipeSubjectSegmenter(OPTIONS);

    await segmenter.initialize();

    expect(delegatesTried()).toEqual(['GPU']);
    expect(segmenter.name).toBe('mediapipe-selfie/GPU');
  });

  it('falls back to CPU when the GPU delegate cannot be created', async () => {
    createFromOptions
      .mockRejectedValueOnce(new Error('no WebGL context'))
      .mockResolvedValueOnce(fakeSegmenter([mask(2, 2, 1)]));
    const segmenter = new MediaPipeSubjectSegmenter(OPTIONS);

    await segmenter.initialize();

    expect(delegatesTried()).toEqual(['GPU', 'CPU']);
    expect(segmenter.name).toBe('mediapipe-selfie/CPU');
  });

  it('does not try the GPU when CPU was asked for', async () => {
    createFromOptions.mockResolvedValue(fakeSegmenter([mask(2, 2, 1)]));

    await new MediaPipeSubjectSegmenter({ ...OPTIONS, delegate: 'CPU' }).initialize();

    expect(delegatesTried()).toEqual(['CPU']);
  });

  it('reports the failure when no delegate works', async () => {
    createFromOptions.mockRejectedValue(new Error('WASM blocked'));

    await expect(new MediaPipeSubjectSegmenter(OPTIONS).initialize()).rejects.toThrow(
      'WASM blocked',
    );
  });

  it('is anonymous about its delegate before it has one', () => {
    expect(new MediaPipeSubjectSegmenter(OPTIONS).name).toBe('mediapipe-selfie');
  });

  it('initialises only once', async () => {
    createFromOptions.mockResolvedValue(fakeSegmenter([mask(2, 2, 1)]));
    const segmenter = new MediaPipeSubjectSegmenter(OPTIONS);

    await segmenter.initialize();
    await segmenter.initialize();

    expect(createFromOptions).toHaveBeenCalledTimes(1);
  });
});

describe('segmentation', () => {
  it('returns the person mask, not the background one', async () => {
    const backend = fakeSegmenter([mask(2, 2, 0.1), mask(2, 2, 0.9)]);
    createFromOptions.mockResolvedValue(backend);
    const segmenter = new MediaPipeSubjectSegmenter(OPTIONS);
    await segmenter.initialize();

    const result = await segmenter.segment(FRAME, 100);

    expect(result).toMatchObject({ width: 2, height: 2 });
    expect(result!.data).toHaveLength(4);
    for (const value of result!.data) expect(value).toBeCloseTo(0.9, 5);
  });

  it('uses the only mask when the model emits one', async () => {
    createFromOptions.mockResolvedValue(fakeSegmenter([mask(2, 1, 0.4)]));
    const segmenter = new MediaPipeSubjectSegmenter(OPTIONS);
    await segmenter.initialize();

    const result = await segmenter.segment(FRAME, 1);

    expect(result!.data).toHaveLength(2);
    for (const value of result!.data) expect(value).toBeCloseTo(0.4, 5);
  });

  it('reuses one buffer instead of allocating per frame', async () => {
    createFromOptions.mockResolvedValue(fakeSegmenter([mask(2, 2, 1)]));
    const segmenter = new MediaPipeSubjectSegmenter(OPTIONS);
    await segmenter.initialize();

    const first = await segmenter.segment(FRAME, 1);
    const second = await segmenter.segment(FRAME, 2);

    expect(second!.data).toBe(first!.data);
  });

  it('returns nothing when the backend produced no mask', async () => {
    createFromOptions.mockResolvedValue(fakeSegmenter([]));
    const segmenter = new MediaPipeSubjectSegmenter(OPTIONS);
    await segmenter.initialize();

    expect(await segmenter.segment(FRAME, 1)).toBeNull();
  });

  it('returns nothing before initialisation', async () => {
    expect(await new MediaPipeSubjectSegmenter(OPTIONS).segment(FRAME, 1)).toBeNull();
  });
});

describe('disposal', () => {
  it('closes the underlying segmenter', async () => {
    const backend = fakeSegmenter([mask(2, 2, 1)]);
    createFromOptions.mockResolvedValue(backend);
    const segmenter = new MediaPipeSubjectSegmenter(OPTIONS);
    await segmenter.initialize();

    await segmenter.dispose();

    expect(backend.close).toHaveBeenCalledTimes(1);
    expect(segmenter.name).toBe('mediapipe-selfie');
    expect(await segmenter.segment(FRAME, 1)).toBeNull();
  });

  it('is safe to dispose twice', async () => {
    createFromOptions.mockResolvedValue(fakeSegmenter([mask(2, 2, 1)]));
    const segmenter = new MediaPipeSubjectSegmenter(OPTIONS);
    await segmenter.initialize();

    await segmenter.dispose();
    await segmenter.dispose();

    expect(segmenter.name).toBe('mediapipe-selfie');
  });

  it('closes a segmenter that finished loading after disposal', async () => {
    const backend = fakeSegmenter([mask(2, 2, 1)]);
    let release: (value: unknown) => void = () => {};
    createFromOptions.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const segmenter = new MediaPipeSubjectSegmenter(OPTIONS);

    const pending = segmenter.initialize();
    // Dispose only once the runtime is genuinely mid-construction, which is
    // the interleaving that would otherwise leak a WASM instance.
    while (createFromOptions.mock.calls.length === 0) await Promise.resolve();
    await segmenter.dispose();
    release(backend);
    await pending;

    expect(backend.close).toHaveBeenCalledTimes(1);
  });

  it('never starts loading after disposal', async () => {
    const segmenter = new MediaPipeSubjectSegmenter(OPTIONS);

    await segmenter.dispose();
    await segmenter.initialize();

    expect(createFromOptions).not.toHaveBeenCalled();
  });
});
