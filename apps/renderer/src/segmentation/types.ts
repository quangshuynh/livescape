/**
 * Renderer-local segmentation boundary.
 *
 * LiveScape talks to this interface and never to a specific ML runtime, so the
 * backend can be replaced (a worker, WebGPU, a different model) without
 * touching the camera lifecycle or the compositor.
 */

/** Anything the browser can hand to an image-processing backend. */
export type FrameSource = HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

/**
 * Per-pixel person confidence for one frame, row-major, values in `[0, 1]`.
 *
 * `data` is borrowed, not owned: a segmenter may hand back the same buffer on
 * every call so a live pipeline does not allocate per frame. Copy it if you
 * need it to survive the next `segment()`.
 */
export interface SegmentationMask {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

export interface SubjectSegmenter {
  /** Stable identifier for diagnostics, for example `mediapipe-selfie`. */
  readonly name: string;
  /** Loads the runtime and model. Rejects if the backend is unavailable. */
  initialize(): Promise<void>;
  /**
   * Segments one frame. `timestampMs` must increase monotonically; backends
   * that track video time rely on it. Resolves to `null` when the backend
   * produced no mask for this frame.
   */
  segment(frame: FrameSource, timestampMs: number): Promise<SegmentationMask | null>;
  /** Releases the runtime. Safe to call more than once. */
  dispose(): Promise<void>;
}

export type SegmenterFactory = () => SubjectSegmenter;

/** How hard the segmenter is asked to work. Presets live in `quality.ts`. */
export type SegmentationQuality = 'performance' | 'balanced' | 'quality';
