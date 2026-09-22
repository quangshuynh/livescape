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
> & {
  globalCompositeOperation: GlobalCompositeOperation;
  filter: string;
};

export type DrawableImage = CanvasImageSource;

export interface CameraFrameDraw {
  readonly source: DrawableImage;
  /** Alpha-encoded subject coverage, or `null` for an unsegmented frame. */
  readonly mask: DrawableImage | null;
  readonly rect: Rect;
  readonly mirror: boolean;
  readonly featherPx: number;
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
 * the browser's bilinear upscale is what softens the edge, and the optional
 * blur widens it further.
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

  ctx.drawImage(frame.source, rect.x, rect.y, rect.width, rect.height);

  if (frame.mask) {
    const feather = frame.featherPx > 0;
    ctx.globalCompositeOperation = 'destination-in';
    if (feather) ctx.filter = `blur(${frame.featherPx}px)`;
    ctx.drawImage(frame.mask, rect.x, rect.y, rect.width, rect.height);
    // Both are reset rather than left to `restore()`, because a leaked filter
    // would blur the next frame's camera image as well as its mask.
    if (feather) ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}
