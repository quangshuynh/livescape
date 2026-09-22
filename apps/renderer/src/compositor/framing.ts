import type { FramingState, Resolution } from '../camera/types.js';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where the whole camera frame lands on the stage.
 *
 * The rect covers the entire source frame rather than a crop of it, so the
 * mask -- which also covers the entire frame -- can be drawn into the same
 * rect and line up exactly. Changing the framing therefore never invalidates a
 * mask, and never needs another inference.
 */
export function computeFrameRect(
  source: Resolution,
  dest: Resolution,
  framing: FramingState,
): Rect {
  if (source.width <= 0 || source.height <= 0 || dest.width <= 0 || dest.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const scaleX = dest.width / source.width;
  const scaleY = dest.height / source.height;
  const fitted = framing.fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const scale = fitted * framing.scale;

  const width = source.width * scale;
  const height = source.height * scale;

  return {
    x: (dest.width - width) / 2 + framing.offsetX * dest.width,
    y: (dest.height - height) / 2 + framing.offsetY * dest.height,
    width,
    height,
  };
}

/**
 * Size of the frame handed to the segmenter: the camera's aspect ratio with
 * its longest side clamped to the quality preset.
 */
export function segmentationInputSize(source: Resolution, longestSide: number): Resolution {
  if (source.width <= 0 || source.height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(source.width, source.height);
  const scale = Math.min(1, longestSide / longest);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}
