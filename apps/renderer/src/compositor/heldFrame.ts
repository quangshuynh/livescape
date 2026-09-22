/** A camera frame kept so it can be drawn later with its own mask. */
export interface HeldFrame {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  /** Frees the frame. Safe to call more than once. */
  close(): void;
}

type VideoFrameConstructor = new (source: HTMLVideoElement) => {
  readonly displayWidth: number;
  readonly displayHeight: number;
  close(): void;
};

function videoFrameConstructor(): VideoFrameConstructor | null {
  const candidate = (globalThis as { VideoFrame?: unknown }).VideoFrame;
  return typeof candidate === 'function' ? (candidate as VideoFrameConstructor) : null;
}

/**
 * Holds the video element's current frame.
 *
 * Where WebCodecs is available the frame is a `VideoFrame`: a reference to the
 * decoder's own buffer, so nothing is copied and the GPU does no extra work.
 * Otherwise the frame is copied into whichever of the two spare canvases is
 * not `inUse` (the one on screen). A `VideoFrame` pins a camera buffer until
 * it is closed, which is why the caller must close every frame it holds; the
 * frame/mask sync never holds more than two.
 */
export function holdFrame(
  video: HTMLVideoElement,
  spares: readonly [HTMLCanvasElement, HTMLCanvasElement],
  inUse: CanvasImageSource | null,
): HeldFrame | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width <= 0 || height <= 0) return null;

  const VideoFrameImpl = videoFrameConstructor();
  if (VideoFrameImpl) {
    try {
      const frame = new VideoFrameImpl(video);
      let open = true;
      return {
        source: frame as unknown as CanvasImageSource,
        width: frame.displayWidth,
        height: frame.displayHeight,
        close: () => {
          if (!open) return;
          open = false;
          frame.close();
        },
      };
    } catch {
      // No decodable frame yet, or a browser that refuses this source: fall
      // back to a copy rather than failing the capture.
    }
  }

  const canvas = spares[0] === inUse ? spares[1] : spares[0];
  const context = canvas.getContext('2d');
  if (!context) return null;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.drawImage(video, 0, 0, width, height);
  return { source: canvas, width, height, close: () => {} };
}
