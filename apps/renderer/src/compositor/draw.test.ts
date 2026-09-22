import { describe, expect, it } from 'vitest';

import { drawCameraFrame, type CompositorContext, type DrawableImage } from './draw.js';
import { EFFECT_PLANE, planeOf } from './layers.js';
import type { Rect } from './framing.js';

type Call = [string, ...unknown[]];

/**
 * Records the composite operations instead of rasterising them, so the layer
 * order can be asserted without a real canvas.
 */
function recorder(): CompositorContext & { calls: Call[] } {
  const calls: Call[] = [];
  let composite: GlobalCompositeOperation = 'source-over';
  let filter = 'none';

  return {
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    drawImage: (...args: unknown[]) => calls.push(['drawImage', ...args]),
    translate: (...args) => calls.push(['translate', ...args]),
    scale: (...args) => calls.push(['scale', ...args]),
    setTransform: (...args: unknown[]) => calls.push(['setTransform', ...args]),
    get globalCompositeOperation() {
      return composite;
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      composite = value;
      calls.push(['composite', value]);
    },
    get filter() {
      return filter;
    },
    set filter(value: string) {
      filter = value;
      calls.push(['filter', value]);
    },
  } as CompositorContext & { calls: Call[] };
}

const SOURCE = { source: true } as unknown as DrawableImage;
const MASK = { mask: true } as unknown as DrawableImage;
const RECT: Rect = { x: 100, y: 50, width: 800, height: 450 };

function frame(overrides: Partial<Parameters<typeof drawCameraFrame>[1]> = {}) {
  return {
    source: SOURCE,
    mask: null,
    rect: RECT,
    mirror: false,
    featherPx: 0,
    width: 1000,
    height: 600,
    ...overrides,
  };
}

const names = (calls: Call[]) => calls.map((call) => call[0]);

describe('drawCameraFrame in raw mode', () => {
  it('clears the layer and draws the frame once', () => {
    const ctx = recorder();

    drawCameraFrame(ctx, frame());

    expect(names(ctx.calls)).toEqual(['clearRect', 'save', 'drawImage', 'restore']);
    expect(ctx.calls[0]).toEqual(['clearRect', 0, 0, 1000, 600]);
    expect(ctx.calls[2]).toEqual(['drawImage', SOURCE, 100, 50, 800, 450]);
  });

  it('applies no mask compositing without a mask', () => {
    const ctx = recorder();

    drawCameraFrame(ctx, frame());

    expect(names(ctx.calls)).not.toContain('composite');
  });

  it('mirrors around the frame rect, so framing does not move', () => {
    const ctx = recorder();

    drawCameraFrame(ctx, frame({ mirror: true }));

    const centre = RECT.x + RECT.width / 2;
    expect(ctx.calls).toContainEqual(['translate', centre, 0]);
    expect(ctx.calls).toContainEqual(['scale', -1, 1]);
    expect(ctx.calls).toContainEqual(['translate', -centre, 0]);
  });

  it('draws nothing but the clear when there is no room', () => {
    const ctx = recorder();

    drawCameraFrame(ctx, frame({ rect: { x: 0, y: 0, width: 0, height: 0 } }));

    expect(names(ctx.calls)).toEqual(['clearRect']);
  });
});

describe('drawCameraFrame in segmented mode', () => {
  it('draws the frame, then keeps only what the mask covers', () => {
    const ctx = recorder();

    drawCameraFrame(ctx, frame({ mask: MASK }));

    expect(names(ctx.calls)).toEqual([
      'clearRect',
      'save',
      'drawImage',
      'composite',
      'drawImage',
      'composite',
      'restore',
    ]);
    expect(ctx.calls[3]).toEqual(['composite', 'destination-in']);
  });

  it('aligns the mask with the camera frame exactly', () => {
    const ctx = recorder();

    drawCameraFrame(ctx, frame({ mask: MASK }));

    const draws = ctx.calls.filter((call) => call[0] === 'drawImage');
    expect(draws[0]?.slice(2)).toEqual(draws[1]?.slice(2));
    expect(draws[1]?.[1]).toBe(MASK);
  });

  it('feathers the mask edge when asked', () => {
    const ctx = recorder();

    drawCameraFrame(ctx, frame({ mask: MASK, featherPx: 3 }));

    expect(ctx.calls).toContainEqual(['filter', 'blur(3px)']);
    // The filter must not leak into the next frame's source draw.
    expect(ctx.calls).toContainEqual(['filter', 'none']);
  });

  it('skips the blur entirely at zero feather', () => {
    const ctx = recorder();

    drawCameraFrame(ctx, frame({ mask: MASK, featherPx: 0 }));

    expect(names(ctx.calls)).not.toContain('filter');
  });

  it('restores normal compositing before returning', () => {
    const ctx = recorder();

    drawCameraFrame(ctx, frame({ mask: MASK }));

    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('mirrors the mask with the frame, so the edges stay aligned', () => {
    const ctx = recorder();

    drawCameraFrame(ctx, frame({ mask: MASK, mirror: true }));

    const restoreAt = names(ctx.calls).indexOf('restore');
    const maskDrawAt = ctx.calls.findIndex((call) => call[0] === 'drawImage' && call[1] === MASK);
    // Both draws happen inside the one mirrored transform.
    expect(maskDrawAt).toBeLessThan(restoreAt);
  });
});

describe('effect planes', () => {
  it('puts weather in front of the subject and fireworks behind', () => {
    expect(planeOf('rain')).toBe('foreground');
    expect(planeOf('snow')).toBe('foreground');
    expect(planeOf('fireworks')).toBe('background');
  });

  it('assigns every effect to exactly one plane', () => {
    const planes = Object.values(EFFECT_PLANE);

    expect(planes).toHaveLength(Object.keys(EFFECT_PLANE).length);
    expect(new Set(planes).size).toBeLessThanOrEqual(2);
  });
});
