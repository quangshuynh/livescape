import { useCallback, useEffect, useRef } from 'react';

import type { CameraState, Resolution, SegmentationStatus } from '../camera/types.js';
import { MaskCanvas, type MaskGuide } from '../segmentation/mask.js';
import { createMediaPipeSegmenter } from '../segmentation/mediapipe.js';
import { QUALITY_PRESETS } from '../segmentation/quality.js';
import { EMPTY_SEGMENTATION_STATS, SegmentationScheduler } from '../segmentation/scheduler.js';
import { FrameMaskSync } from '../segmentation/sync.js';
import type { SegmenterFactory } from '../segmentation/types.js';
import { drawCameraFrame, type CompositorView } from './draw.js';
import { computeFrameRect, segmentationInputSize } from './framing.js';
import { holdFrame, type HeldFrame } from './heldFrame.js';
import { stageZIndex } from './layers.js';
import { FrameRateMeter, ema, type CompositorStats } from './stats.js';
import { VideoFrameWatcher } from './videoFrames.js';

/** How often diagnostics are pushed upwards, in milliseconds. */
const STATS_INTERVAL_MS = 500;

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Segmentation failed to start.';
}

/** Everything that decides what the subject canvas shows. */
interface DrawKey {
  readonly state: CameraState;
  readonly view: CompositorView;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** The frame/mask pair on screen, or the raw frame count; NaN is never equal. */
  readonly content: number;
}

function sameDraw(a: DrawKey, b: DrawKey): boolean {
  return (
    a.content === b.content &&
    a.state === b.state &&
    a.view === b.view &&
    a.width === b.width &&
    a.height === b.height &&
    a.dpr === b.dpr
  );
}

/** Everything one segmentation session owns; rebuilt when quality changes. */
interface SegmentationSession {
  readonly scheduler: SegmentationScheduler;
  readonly sync: FrameMaskSync<HeldFrame>;
  readonly mask: MaskCanvas;
  readonly input: HTMLCanvasElement;
  /** Copy targets for browsers without `VideoFrame`. */
  readonly spares: readonly [HTMLCanvasElement, HTMLCanvasElement];
  inputSize: Resolution | null;
  maskResolution: Resolution | null;
  processingMs: number;
  hasMask: boolean;
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  // Shrinking a canvas to nothing frees its backing store immediately rather
  // than whenever the garbage collector gets to it.
  canvas.width = 0;
  canvas.height = 0;
}

export interface CameraLayerProps {
  readonly state: CameraState;
  readonly stream: MediaStream | null;
  readonly onSegmentationStatus: (status: SegmentationStatus, error?: string) => void;
  /** Only supplied while a local diagnostics surface is mounted. */
  readonly onStats?: ((stats: CompositorStats) => void) | undefined;
  /**
   * `matte` draws the mask instead of the subject. Only the setup panel sets
   * it; the OBS URL has no way to.
   */
  readonly view?: CompositorView | undefined;
  /** Injected by the tests so no ML runtime is needed in CI. */
  readonly createSegmenter?: SegmenterFactory | undefined;
}

/**
 * The subject layer: a hidden video element feeding one canvas that sits
 * between everything behind the subject and everything in front of it.
 *
 * In segmented mode the canvas never shows the live video. Each camera frame
 * that is segmented is held (see `heldFrame.ts`), and drawn with its own mask
 * once the mask arrives, so a moving hand and its matte always come from the same
 * instant (see `segmentation/sync.ts`).
 *
 * Frames go from the camera to these canvases and nowhere else. Nothing here
 * posts, uploads, records or persists a frame.
 */
export function CameraLayer({
  state,
  stream,
  onSegmentationStatus,
  onStats,
  view = 'composite',
  createSegmenter,
}: CameraLayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<SegmentationSession | null>(null);
  const meterRef = useRef(new FrameRateMeter());
  const drawRef = useRef<(() => void) | null>(null);

  // The animation loop reads the newest state without being torn down and
  // rebuilt every time a slider moves.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const statsRef = useRef(onStats);
  useEffect(() => {
    statsRef.current = onStats;
  }, [onStats]);

  const statusRef = useRef(onSegmentationStatus);
  useEffect(() => {
    statusRef.current = onSegmentationStatus;
  }, [onSegmentationStatus]);

  const factory = useCallback<SegmenterFactory>(
    () => (createSegmenter ?? createMediaPipeSegmenter)(),
    [createSegmenter],
  );

  const active = state.mode !== 'off' && state.status === 'ready';
  const wantsSegmentation = state.mode === 'segmented' && state.status === 'ready';
  const { quality } = state;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play?.()?.catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    if (!wantsSegmentation) return;

    const preset = QUALITY_PRESETS[quality];
    const input = document.createElement('canvas');
    const spares = [document.createElement('canvas'), document.createElement('canvas')] as const;
    const sync = new FrameMaskSync<HeldFrame>((frame) => frame.close());
    const mask = new MaskCanvas();
    const segmenter = factory();

    // Assigned below; the callbacks only run after the session exists.
    let session: SegmentationSession | null = null;

    const readGuide = (width: number, height: number): MaskGuide | null => {
      if (input.width !== width || input.height !== height) return null;
      const context = input.getContext('2d');
      const image = context?.getImageData?.(0, 0, width, height);
      return image ? { width, height, data: image.data } : null;
    };

    const scheduler = new SegmentationScheduler({
      segmenter,
      minIntervalMs: preset.minIntervalMs,
      maxDutyCycle: preset.maxDutyCycle,
      onMask: (result, meta) => {
        const current = session;
        if (!current || !sync.resolve(meta.sequence)) return;

        const shaping = stateRef.current.shaping;
        const started = performance.now();
        const refine = shaping.refineEdges && preset.refineRadius > 0;
        mask.update(result, shaping, {
          guide: refine ? readGuide(result.width, result.height) : null,
          refineRadius: preset.refineRadius,
        });
        current.processingMs = ema(current.processingMs, performance.now() - started);
        current.maskResolution = { width: result.width, height: result.height };
        current.hasMask = true;

        // Draw now rather than on the next animation frame: with a synchronous
        // backend this still lands before the browser paints, so the subject
        // is shown in the same frame it was captured in.
        drawRef.current?.();
      },
      onDrop: (sequence) => sync.abandon(sequence),
      onFailure: (error) => statusRef.current('failed', describe(error)),
    });

    session = {
      scheduler,
      sync,
      mask,
      input,
      spares,
      inputSize: null,
      maskResolution: null,
      processingMs: 0,
      hasMask: false,
    };

    let disposed = false;
    statusRef.current('loading');

    void segmenter
      .initialize()
      .then(() => {
        if (disposed) return;
        sessionRef.current = session;
        statusRef.current('ready');
      })
      .catch((error: unknown) => {
        if (disposed) return;
        // A missing runtime, a blocked WASM fetch or an unsupported GPU all
        // land here. The renderer keeps running; only the subject is missing.
        statusRef.current('failed', describe(error));
      });

    return () => {
      disposed = true;
      if (sessionRef.current === session) sessionRef.current = null;
      session = null;
      sync.reset();
      mask.reset();
      for (const canvas of [input, mask.canvas, ...spares]) releaseCanvas(canvas);
      void scheduler.dispose();
    };
  }, [wantsSegmentation, quality, factory]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d') ?? null;
    const video = videoRef.current;
    if (!canvas || !context || !video) return;

    const meter = meterRef.current;
    meter.reset();

    if (!active) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const watcher = new VideoFrameWatcher(video);
    let frame = 0;
    let stopped = false;
    let lastStatsAt = 0;
    let maskAgeMs: number | null = null;

    const stageSize = (): Resolution => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth || window.innerWidth;
      const height = canvas.clientHeight || window.innerHeight;
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { width, height };
    };

    // What the last draw showed. Redrawing an unchanged image is pure GPU
    // cost, and in segmented mode the image only changes when a new
    // frame/mask pair arrives, typically 30 times a second against a 60 Hz loop.
    let drawn: DrawKey | null = null;

    const draw = () => {
      if (stopped) return;
      const current = stateRef.current;
      const { width, height } = stageSize();
      const session = current.mode === 'segmented' ? sessionRef.current : null;
      const shown = session?.hasMask ? session.sync.displayed : null;

      const key: DrawKey = {
        state: current,
        view: viewRef.current,
        width,
        height,
        dpr: canvas.width / width,
        content:
          current.mode === 'segmented'
            ? (shown?.sequence ?? -1)
            : watcher.supported
              ? watcher.presentedFrames
              : Number.NaN,
      };
      if (drawn && sameDraw(drawn, key)) return;
      drawn = key;

      let source: CanvasImageSource = video;
      let size: Resolution = { width: video.videoWidth, height: video.videoHeight };
      let maskCanvas: HTMLCanvasElement | null = null;

      if (current.mode === 'segmented') {
        // Segmented mode shows nothing until a mask exists. Showing the raw
        // feed instead would put the physical background on stream at the one
        // moment the operator asked for it to be gone.
        if (!session || !shown) {
          context.clearRect(0, 0, width, height);
          return;
        }
        source = shown.frame.source;
        size = { width: shown.frame.width, height: shown.frame.height };
        maskCanvas = session.mask.canvas;
        maskAgeMs = session.sync.age(performance.now());
      }

      if (size.width === 0 || size.height === 0) {
        context.clearRect(0, 0, width, height);
        return;
      }

      drawCameraFrame(context, {
        source,
        mask: maskCanvas,
        rect: computeFrameRect(size, { width, height }, current.framing),
        mirror: current.framing.mirror,
        featherPx: current.shaping.featherPx,
        view: current.mode === 'segmented' ? viewRef.current : 'composite',
        width,
        height,
      });
    };
    drawRef.current = draw;

    /**
     * Holds the current camera frame and scales it into the segmenter's
     * input. Called by the scheduler only when an inference is about to start.
     * The input is drawn from the held frame, not from the video element, so
     * the two are guaranteed to be the same camera frame.
     */
    const capture = (session: SegmentationSession, source: Resolution, sequence: number) => {
      const current = stateRef.current;
      const inputContext = session.input.getContext('2d');
      const held = inputContext
        ? holdFrame(video, session.spares, session.sync.displayed?.frame.source ?? null)
        : null;
      if (!inputContext || !held) return null;

      session.sync.capture(sequence, performance.now(), held);
      const size = segmentationInputSize(source, QUALITY_PRESETS[current.quality].inputSize);
      if (session.input.width !== size.width || session.input.height !== size.height) {
        session.input.width = size.width;
        session.input.height = size.height;
      }
      inputContext.drawImage(held.source, 0, 0, size.width, size.height);
      session.inputSize = size;
      return session.input;
    };

    const tick = (time: number) => {
      if (stopped) return;
      frame = window.requestAnimationFrame(tick);

      const current = stateRef.current;
      const fps = meter.sample(time);
      const source: Resolution = { width: video.videoWidth, height: video.videoHeight };
      const session = current.mode === 'segmented' ? sessionRef.current : null;

      if (session && source.width > 0 && source.height > 0 && watcher.hasNewFrame) {
        // Nothing is queued: while inference runs or the rate limit holds,
        // the camera frame stays "new" and the next animation frame offers
        // whatever frame is current by then. It is only marked done once an
        // inference actually starts on it.
        session.scheduler.submit((sequence) => {
          watcher.consume();
          return capture(session, source, sequence);
        }, time);
      }

      draw();

      const report = statsRef.current;
      if (report && time - lastStatsAt >= STATS_INTERVAL_MS) {
        lastStatsAt = time;
        const segmented = current.mode === 'segmented';
        report({
          renderFps: fps,
          cameraResolution: source,
          cameraFps: watcher.fps,
          segmentationInput: segmented ? (session?.inputSize ?? null) : null,
          maskResolution: segmented ? (session?.maskResolution ?? null) : null,
          segmentationBackend: session?.scheduler.backend ?? null,
          quality: segmented ? current.quality : null,
          segmentation: session?.scheduler.stats ?? EMPTY_SEGMENTATION_STATS,
          processingMs: session?.processingMs ?? 0,
          edgeRefined: session?.mask.lastRefined ?? false,
          maskAgeMs: segmented ? maskAgeMs : null,
          staleMasks: session?.sync.stale ?? 0,
        });
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      stopped = true;
      if (drawRef.current === draw) drawRef.current = null;
      watcher.dispose();
      window.cancelAnimationFrame(frame);
    };
  }, [active]);

  return (
    <>
      <video
        ref={videoRef}
        className="camera-source"
        autoPlay
        muted
        playsInline
        aria-hidden="true"
      />
      {active ? (
        <canvas
          ref={canvasRef}
          className="camera-layer"
          aria-hidden="true"
          style={{ zIndex: stageZIndex('subject') }}
        />
      ) : null}
    </>
  );
}
