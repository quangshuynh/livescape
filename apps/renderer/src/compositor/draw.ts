import type { Rect } from './framing.js';

/** The 2D context surface the compositor uses, so a fake can record the calls. */
export type CompositorContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'clearRect'
  | 'drawImage'
  | 'translate'
  | 'scale'
  | 'setTransform'
  | 'fillRect'
> & {
  globalCompositeOperation: GlobalCompositeOperation;
  filter: string;
  fillStyle: CanvasRenderingContext2D['fillStyle'];
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
};

/**
 * `composite` is the only view that ever reaches OBS. `matte` shows the mask
 * itself, white subject on black, and is only offered by the setup panel.
 */
export type CompositorView = 'composite' | 'matte';

export type DrawableImage = CanvasImageSource;

export interface CameraFrameDraw {
  readonly source: DrawableImage;
  /** Alpha-encoded subject coverage, or `null` for an unsegmented frame. */
  readonly mask: DrawableImage | null;
  readonly rect: Rect;
  readonly mirror: boolean;
  readonly featherPx: number;
  readonly view?: CompositorView;
  /** Stage size in CSS pixels. */
  readonly width: number;
  readonly height: number;
}

/**
 * Draws one camera frame onto the subject layer.
 *
 * Background removal is a composite, not a per-pixel loop: the frame goes down
 * first, then the mask is drawn over it with `destination-in`, which keeps
 * only the pixels the mask covers. The mask is much smaller than the stage, so
 * it is upscaled with the browser's high-quality filter, which keeps a smooth
 * contour instead of the stair-stepping a bilinear upscale of a small alpha
 * mask shows along diagonal edges. The optional blur widens the edge further.
 */
export function drawCameraFrame(ctx: CompositorContext, frame: CameraFrameDraw): void {
  const { rect } = frame;
  ctx.clearRect(0, 0, frame.width, frame.height);
  if (rect.width <= 0 || rect.height <= 0) return;

  ctx.save();
  if (frame.mirror) {
    // Flip around the rect's own centre so mirroring never moves the framing.
    ctx.translate(rect.x + rect.width / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(rect.x + rect.width / 2), 0);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';

  if (frame.view === 'matte' && frame.mask) {
    ctx.fillStyle = '#000';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.drawImage(frame.mask, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
    return;
  }

  ctx.drawImage(frame.source, rect.x, rect.y, rect.width, rect.height);

  if (frame.mask) {
    const feather = frame.featherPx > 0;
    ctx.globalCompositeOperation = 'destination-in';
    if (feather) ctx.filter = `blur(${frame.featherPx}px)`;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(frame.mask, rect.x, rect.y, rect.width, rect.height);
    ctx.imageSmoothingQuality = 'low';
    // Both are reset rather than left to `restore()`, because a leaked filter
    // would blur the next frame's camera image as well as its mask.
    if (feather) ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}
