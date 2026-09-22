import type { ImageSegmenter } from '@mediapipe/tasks-vision';

import type { FrameSource, SegmentationMask, SubjectSegmenter } from './types.js';

/**
 * Where the MediaPipe runtime and model live, relative to the renderer's own
 * base URL. Both are served by LiveScape, never by a CDN, so the camera works
 * with no internet connection.
 */
export const MEDIAPIPE_WASM_PATH = 'vendor/mediapipe/wasm';
export const SELFIE_SEGMENTER_MODEL_PATH = 'models/selfie_segmenter.tflite';

export type MediaPipeDelegate = 'GPU' | 'CPU';

export interface MediaPipeSegmenterOptions {
  /** Absolute URL of the directory holding the MediaPipe WASM fileset. */
  readonly wasmBaseUrl: string;
  /** Absolute URL of the `.tflite` model. */
  readonly modelUrl: string;
  /**
   * Preferred delegate. `GPU` uses the WebGL delegate and is several times
   * faster; `CPU` runs the WASM build. A `GPU` preference falls back to `CPU`
   * rather than failing, because whether the delegate comes up is a property
   * of the host: an OBS Browser Source, for instance, reports no WebGL2
   * context to page scripts even where MediaPipe's own context works.
   */
  readonly delegate: MediaPipeDelegate;
}

export function resolveAssetUrl(path: string, base: string = document.baseURI): string {
  return new URL(path, base).href;
}

export function defaultMediaPipeOptions(
  base: string = document.baseURI,
): MediaPipeSegmenterOptions {
  return {
    wasmBaseUrl: resolveAssetUrl(MEDIAPIPE_WASM_PATH, base),
    modelUrl: resolveAssetUrl(SELFIE_SEGMENTER_MODEL_PATH, base),
    delegate: 'GPU',
  };
}

/**
 * MediaPipe Tasks Vision `ImageSegmenter` running the SelfieSegmenter model.
 *
 * `segmentForVideo` is synchronous: it blocks the calling thread for the
 * length of the inference. The `SubjectSegmenter` contract is async anyway so
 * that a worker-backed implementation can replace this one without the
 * compositor noticing.
 */
export class MediaPipeSubjectSegmenter implements SubjectSegmenter {
  private readonly options: MediaPipeSegmenterOptions;
  private segmenter: ImageSegmenter | null = null;
  private buffer: Float32Array | null = null;
  private delegate: MediaPipeDelegate | null = null;
  private disposed = false;

  constructor(options: MediaPipeSegmenterOptions) {
    this.options = options;
  }

  /** Includes the delegate that actually came up, for the diagnostics panel. */
  get name(): string {
    return this.delegate ? `mediapipe-selfie/${this.delegate}` : 'mediapipe-selfie';
  }

  async initialize(): Promise<void> {
    if (this.segmenter || this.disposed) return;

    // Deferred so ~150 kB of runtime glue stays out of the renderer's initial
    // bundle: a LiveScape instance that never turns the camera on never loads it.
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = await vision.FilesetResolver.forVisionTasks(this.options.wasmBaseUrl);

    const order: MediaPipeDelegate[] =
      this.options.delegate === 'GPU' ? ['GPU', 'CPU'] : ['CPU'];

    let lastError: unknown;
    for (const delegate of order) {
      if (this.disposed) return;
      try {
        const segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: this.options.modelUrl, delegate },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });

        if (this.disposed) {
          segmenter.close();
          return;
        }
        this.segmenter = segmenter;
        this.delegate = delegate;
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('MediaPipe could not create an image segmenter.');
  }

  async segment(frame: FrameSource, timestampMs: number): Promise<SegmentationMask | null> {
    const segmenter = this.segmenter;
    if (!segmenter || this.disposed) return null;

    let result: SegmentationMask | null = null;

    // The callback overload hands back masks that MediaPipe still owns, so the
    // data has to be copied out before it returns. The alternative overload
    // copies every mask on every frame, which this pipeline cannot afford.
    segmenter.segmentForVideo(frame, timestampMs, (output) => {
      const masks = output.confidenceMasks;
      if (!masks || masks.length === 0) return;

      // SelfieSegmenter labels are [background, person]; single-mask builds put
      // the person mask first.
      const person = masks.length > 1 ? masks[1] : masks[0];
      if (!person) return;

      const { width, height } = person;
      const source = person.getAsFloat32Array();
      const count = width * height;
      if (source.length < count) return;

      let buffer = this.buffer;
      if (!buffer || buffer.length !== count) {
        buffer = new Float32Array(count);
        this.buffer = buffer;
      }
      buffer.set(source.subarray(0, count));
      result = { width, height, data: buffer };
    });

    return result;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.segmenter?.close();
    this.segmenter = null;
    this.buffer = null;
    this.delegate = null;
  }
}

export function createMediaPipeSegmenter(
  options: MediaPipeSegmenterOptions = defaultMediaPipeOptions(),
): SubjectSegmenter {
  return new MediaPipeSubjectSegmenter(options);
}
