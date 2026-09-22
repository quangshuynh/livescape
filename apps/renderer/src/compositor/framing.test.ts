import { describe, expect, it } from 'vitest';

import { DEFAULT_FRAMING } from '../camera/cameraState.js';
import type { FramingState } from '../camera/types.js';
import { computeFrameRect, segmentationInputSize } from './framing.js';

const STAGE = { width: 1920, height: 1080 };
const CAMERA = { width: 1280, height: 720 };
const PORTRAIT_CAMERA = { width: 720, height: 1280 };

function framing(patch: Partial<FramingState> = {}): FramingState {
  return { ...DEFAULT_FRAMING, ...patch };
}

describe('computeFrameRect', () => {
  it('fills the stage when the aspect ratios match', () => {
    const rect = computeFrameRect(CAMERA, STAGE, framing({ fit: 'cover' }));

    expect(rect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('covers by overflowing the narrow axis', () => {
    const rect = computeFrameRect(PORTRAIT_CAMERA, STAGE, framing({ fit: 'cover' }));

    expect(rect.width).toBeCloseTo(1920, 5);
    expect(rect.height).toBeGreaterThan(STAGE.height);
    expect(rect.y).toBeLessThan(0);
  });

  it('contains by letterboxing instead of cropping', () => {
    const rect = computeFrameRect(PORTRAIT_CAMERA, STAGE, framing({ fit: 'contain' }));

    expect(rect.height).toBeCloseTo(1080, 5);
    expect(rect.width).toBeLessThan(STAGE.width);
    expect(rect.x).toBeGreaterThan(0);
  });

  it('stays centred when scaled', () => {
    const rect = computeFrameRect(CAMERA, STAGE, framing({ scale: 0.5 }));

    expect(rect.width).toBe(960);
    expect(rect.height).toBe(540);
    expect(rect.x + rect.width / 2).toBeCloseTo(STAGE.width / 2, 5);
    expect(rect.y + rect.height / 2).toBeCloseTo(STAGE.height / 2, 5);
  });

  it('offsets by a fraction of the stage', () => {
    const rect = computeFrameRect(CAMERA, STAGE, framing({ scale: 0.5, offsetX: 0.25 }));

    expect(rect.x).toBeCloseTo((STAGE.width - 960) / 2 + 0.25 * STAGE.width, 5);
  });

  it('moves the subject down for a positive vertical offset', () => {
    const centred = computeFrameRect(CAMERA, STAGE, framing({ scale: 0.5 }));
    const lowered = computeFrameRect(CAMERA, STAGE, framing({ scale: 0.5, offsetY: 0.2 }));

    expect(lowered.y).toBeGreaterThan(centred.y);
  });

  it('preserves the camera aspect ratio whatever the framing', () => {
    const rect = computeFrameRect(CAMERA, STAGE, framing({ scale: 1.7, offsetX: -0.4 }));

    expect(rect.width / rect.height).toBeCloseTo(CAMERA.width / CAMERA.height, 5);
  });

  it.each([
    ['no camera yet', { width: 0, height: 0 }, STAGE],
    ['no stage yet', CAMERA, { width: 0, height: 0 }],
  ])('returns an empty rect when there is %s', (_name, source, dest) => {
    expect(computeFrameRect(source, dest, framing())).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe('segmentationInputSize', () => {
  it('clamps the longest side to the quality budget', () => {
    expect(segmentationInputSize(CAMERA, 256)).toEqual({ width: 256, height: 144 });
  });

  it('clamps the tall side for a portrait camera', () => {
    expect(segmentationInputSize(PORTRAIT_CAMERA, 256)).toEqual({ width: 144, height: 256 });
  });

  it('never upscales a camera that is already small', () => {
    expect(segmentationInputSize({ width: 160, height: 120 }, 256)).toEqual({
      width: 160,
      height: 120,
    });
  });

  it('keeps the camera aspect ratio, so the mask maps onto the whole frame', () => {
    const size = segmentationInputSize({ width: 1920, height: 1080 }, 384);

    expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
  });

  it('returns nothing for a camera that has not reported a size', () => {
    expect(segmentationInputSize({ width: 0, height: 0 }, 256)).toEqual({ width: 0, height: 0 });
  });
});
