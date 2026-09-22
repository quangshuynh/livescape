import { useCallback, useEffect, useRef } from 'react';

import type { CameraState, Resolution, SegmentationStatus } from '../camera/types.js';
import { MaskCanvas } from '../segmentation/mask.js';
import { createMediaPipeSegmenter } from '../segmentation/mediapipe.js';
import { QUALITY_PRESETS } from '../segmentation/quality.js';
import { EMPTY_SEGMENTATION_STATS, SegmentationScheduler } from '../segmentation/scheduler.js';
import type { SegmenterFactory } from '../segmentation/types.js';
import { drawCameraFrame } from './draw.js';
import { computeFrameRect, segmentationInputSize } from './framing.js';
import { FrameRateMeter, type CompositorStats } from './stats.js';

/** How often diagnostics are pushed upwards, in milliseconds. */
const STATS_INTERVAL_MS = 500;

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Segmentation failed to start.';
}

export interface CameraLayerProps {
  readonly state: CameraState;
  readonly stream: MediaStream | null;
  readonly onSegmentationStatus: (status: SegmentationStatus, error?: string) => void;
  /** Only supplied while a local diagnostics surface is mounted. */
  readonly onStats?: ((stats: CompositorStats) => void) | undefined;
  /** Injected by the tests so no ML runtime is needed in CI. */
  readonly createSegmenter?: SegmenterFactory | undefined;
}

/**
 * The subject layer: a hidden video element feeding one canvas that sits
 * between the background and foreground effect planes.
 *
 * Frames go from the camera to this canvas and nowhere else. Nothing here
 * posts, uploads, records or persists a frame.
 */
export function CameraLayer({
  state,
  stream,
  onSegmentationStatus,
  onStats,
  createSegmenter,
}: CameraLayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<MaskCanvas | null>(null);
  const schedulerRef = useRef<SegmentationScheduler | null>(null);
  const hasMaskRef = useRef(false);
  const meterRef = useRef(new FrameRateMeter());
  const inputSizeRef = useRef<Resolution | null>(null);

  // The animation loop reads the newest state without being torn down and
  // rebuilt every time a slider moves.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

    const mask = maskRef.current ?? new MaskCanvas();
    maskRef.current = mask;
    mask.reset();
    hasMaskRef.current = false;

    const segmenter = factory();
    const scheduler = new SegmentationScheduler({
      segmenter,
      minIntervalMs: QUALITY_PRESETS[quality].minIntervalMs,
      onMask: (result) => {
        mask.update(result, stateRef.current.shaping);
        hasMaskRef.current = true;
      },
      onFailure: (error) => statusRef.current('failed', describe(error)),
    });

    let disposed = false;
    statusRef.current('loading');

    void segmenter
      .initialize()
      .then(() => {
        if (disposed) return;
        schedulerRef.current = scheduler;
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
      schedulerRef.current = null;
      hasMaskRef.current = false;
      inputSizeRef.current = null;
      mask.reset();
      void scheduler.dispose();
    };
  }, [wantsSegmentation, quality, factory]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d') ?? null;
    if (!canvas || !context) return;

    const meter = meterRef.current;
    meter.reset();

    if (!active) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let frame = 0;
    let stopped = false;
    let lastStatsAt = 0;

    const tick = (time: number) => {
      if (stopped) return;
      frame = window.requestAnimationFrame(tick);

      const current = stateRef.current;
      const video = videoRef.current;
      if (!video) return;

      const source: Resolution = { width: video.videoWidth, height: video.videoHeight };
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

      const fps = meter.sample(time);
      if (source.width === 0 || source.height === 0) {
        context.clearRect(0, 0, width, height);
        return;
      }

      const scheduler = schedulerRef.current;
      if (current.mode === 'segmented' && scheduler) {
        const size = segmentationInputSize(source, QUALITY_PRESETS[current.quality].inputSize);
        const input = inputCanvasRef.current ?? document.createElement('canvas');
        inputCanvasRef.current = input;
        const inputContext = input.getContext('2d');
        if (inputContext) {
          if (input.width !== size.width || input.height !== size.height) {
            input.width = size.width;
            input.height = size.height;
          }
          inputContext.drawImage(video, 0, 0, size.width, size.height);
          inputSizeRef.current = size;
          // Dropped rather than queued when inference is still running.
          scheduler.submit(input, time);
        }
      }

      const maskCanvas =
        current.mode === 'segmented' && hasMaskRef.current
          ? (maskRef.current?.canvas ?? null)
          : null;

      // Segmented mode shows nothing until a mask exists. Showing the raw feed
      // instead would put the physical background on stream at the one moment
      // the operator asked for it to be gone.
      if (current.mode === 'segmented' && !maskCanvas) {
        context.clearRect(0, 0, width, height);
        return;
      }

      drawCameraFrame(context, {
        source: video,
        mask: maskCanvas,
        rect: computeFrameRect(source, { width, height }, current.framing),
        mirror: current.framing.mirror,
        featherPx: current.shaping.featherPx,
        width,
        height,
      });

      const report = statsRef.current;
      if (report && time - lastStatsAt >= STATS_INTERVAL_MS) {
        lastStatsAt = time;
        report({
          renderFps: fps,
          cameraResolution: source,
          segmentationInput: current.mode === 'segmented' ? inputSizeRef.current : null,
          segmentationBackend: scheduler?.backend ?? null,
          segmentation: scheduler?.stats ?? EMPTY_SEGMENTATION_STATS,
        });
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      stopped = true;
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
      {active ? <canvas ref={canvasRef} className="camera-layer" aria-hidden="true" /> : null}
    </>
  );
}
