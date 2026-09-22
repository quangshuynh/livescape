import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installFakeCanvas } from '../test/fakeCanvas.js';
import {
  DEFAULT_MASK_SHAPING,
  HYSTERESIS,
  MaskCanvas,
  clamp,
  shapeConfidence,
  shapeWithHysteresis,
  type MaskShaping,
} from './mask.js';

describe('clamp', () => {
  it.each([
    [5, 0, 1, 1],
    [-5, 0, 1, 0],
    [0.5, 0, 1, 0.5],
  ])('clamps %s into [%s, %s]', (value, min, max, expected) => {
    expect(clamp(value, min, max)).toBe(expected);
  });
});

describe('shapeConfidence', () => {
  it('cuts hard when softness is zero', () => {
    expect(shapeConfidence(0.49, 0.5, 0)).toBe(0);
    expect(shapeConfidence(0.51, 0.5, 0)).toBe(1);
  });

  it('is half covered at the threshold', () => {
    expect(shapeConfidence(0.5, 0.5, 0.2)).toBeCloseTo(0.5, 5);
  });

  it('saturates outside the ramp', () => {
    expect(shapeConfidence(0.1, 0.5, 0.2)).toBe(0);
    expect(shapeConfidence(0.9, 0.5, 0.2)).toBe(1);
  });

  it('rises monotonically across the ramp', () => {
    const samples = [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65].map((value) =>
      shapeConfidence(value, 0.5, 0.2),
    );

    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
  });

  it('follows the threshold', () => {
    // A higher threshold demands more confidence for the same coverage.
    expect(shapeConfidence(0.5, 0.7, 0.2)).toBeLessThan(shapeConfidence(0.5, 0.5, 0.2));
  });
});

describe('defaults', () => {
  it('uses a temporal smoothing default that motion still bypasses', () => {
    // Smoothing only applies to small changes, so the default can steady a
    // still edge; a full change must still land in one frame (see temporal).
    expect(DEFAULT_MASK_SHAPING.smoothing).toBeGreaterThan(0);
    expect(DEFAULT_MASK_SHAPING.smoothing).toBeLessThanOrEqual(0.6);
  });

  it('refines edges by default', () => {
    expect(DEFAULT_MASK_SHAPING.refineEdges).toBe(true);
  });

  it('feathers the edge by default', () => {
    expect(DEFAULT_MASK_SHAPING.softness).toBeGreaterThan(0);
    expect(DEFAULT_MASK_SHAPING.featherPx).toBeGreaterThan(0);
  });
});

describe('shapeWithHysteresis', () => {
  const threshold = 0.5;
  const softness = 0.1;

  it('lets a pixel that was subject stay subject a little below the threshold', () => {
    const value = threshold - HYSTERESIS / 2;

    expect(shapeWithHysteresis(value, threshold, softness, true)).toBeGreaterThan(0.5);
    expect(shapeWithHysteresis(value, threshold, softness, false)).toBeLessThan(0.5);
  });

  it('still lets a confident change through in either direction', () => {
    expect(shapeWithHysteresis(0.05, threshold, softness, true)).toBe(0);
    expect(shapeWithHysteresis(0.95, threshold, softness, false)).toBe(1);
  });

  it('works with a hard cut', () => {
    expect(shapeWithHysteresis(0.48, threshold, 0, true)).toBe(1);
    expect(shapeWithHysteresis(0.52, threshold, 0, false)).toBe(0);
  });
});

describe('MaskCanvas', () => {
  let canvas: ReturnType<typeof installFakeCanvas>;
  beforeEach(() => {
    canvas = installFakeCanvas();
  });
  afterEach(() => canvas.restore());

  const shaping: MaskShaping = { ...DEFAULT_MASK_SHAPING, softness: 0.1 };

  function alphaOf(mask: MaskCanvas): number[] {
    const context = canvas.contexts.find((c) => c.canvas === mask.canvas);
    const call = context?.calls.filter((c) => c[0] === 'putImageData').at(-1);
    const image = call?.[1] as ImageData;
    return [...image.data].filter((_, i) => i % 4 === 3);
  }

  const mask = (values: number[]) => ({
    width: values.length,
    height: 1,
    data: new Float32Array(values),
  });

  it('turns confidence into coverage', () => {
    const matte = new MaskCanvas();
    matte.update(mask([0, 1]), shaping);

    expect(alphaOf(matte)).toEqual([0, 255]);
  });

  it('holds a still edge steady instead of flipping it every frame', () => {
    const matte = new MaskCanvas();
    const seen: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      // Confidence wobbling around the threshold, as a still hair edge does.
      matte.update(mask([i % 2 === 0 ? 0.53 : 0.47]), shaping);
      seen.push(alphaOf(matte)[0]!);
    }

    const late = seen.slice(10);
    expect(Math.max(...late) - Math.min(...late)).toBeLessThan(40);
  });

  it('refines only against a guide that matches the mask', () => {
    const matte = new MaskCanvas();
    const guide = { width: 2, height: 1, data: new Uint8ClampedArray(8) };

    matte.update(mask([0, 1]), shaping, { guide, refineRadius: 1 });
    expect(matte.lastRefined).toBe(true);

    matte.update(mask([0, 1, 1]), shaping, { guide, refineRadius: 1 });
    expect(matte.lastRefined).toBe(false);
  });

  it('skips refinement when it is switched off or has no radius', () => {
    const matte = new MaskCanvas();
    const guide = { width: 2, height: 1, data: new Uint8ClampedArray(8) };

    matte.update(mask([0, 1]), { ...shaping, refineEdges: false }, { guide, refineRadius: 1 });
    expect(matte.lastRefined).toBe(false);
    matte.update(mask([0, 1]), shaping, { guide, refineRadius: 0 });
    expect(matte.lastRefined).toBe(false);
  });

  it('drops all history on reset', () => {
    const matte = new MaskCanvas();
    const guide = { width: 2, height: 1, data: new Uint8ClampedArray(8) };
    matte.update(mask([0.2, 0.8]), shaping, { guide, refineRadius: 1 });
    expect(matte.historySize).toBeGreaterThan(0);

    matte.reset();

    expect(matte.historySize).toBe(0);
  });
});
