import { describe, expect, it } from 'vitest';

import { GuidedMatteRefiner, boxMean, downsample, rgbaToLuma } from './refine.js';

/** Brute-force clamped box mean, the reference the fast version must match. */
function referenceBox(src: Float32Array, width: number, height: number, radius: number) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy += 1) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
          sum += src[yy * width + xx]!;
          count += 1;
        }
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

/** Deterministic pseudo-random values in [0, 1). */
function noise(count: number, seed = 1): Float32Array {
  const out = new Float32Array(count);
  let state = seed;
  for (let i = 0; i < count; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = state / 2 ** 32;
  }
  return out;
}

/** First x along the middle row where the matte reaches one half. */
function halfCrossing(matte: Float32Array, width: number, height: number): number {
  const row = Math.floor(height / 2) * width;
  for (let x = 0; x < width; x += 1) if (matte[row + x]! >= 0.5) return x;
  return width;
}

describe('boxMean', () => {
  it.each([
    [7, 5, 1],
    [13, 9, 2],
    [4, 3, 5],
    [1, 1, 3],
  ])('matches a brute-force mean on %ix%i with radius %i', (width, height, radius) => {
    const src = noise(width * height);
    const dst = new Float32Array(width * height);

    boxMean(src, dst, new Float32Array(width * height), width, height, radius);

    const expected = referenceBox(src, width, height, radius);
    for (let i = 0; i < dst.length; i += 1) expect(dst[i]).toBeCloseTo(expected[i]!, 5);
  });
});

describe('downsample', () => {
  it('averages blocks, including partial blocks at the edges', () => {
    // 3x2 halves to 2x1: [avg(0,1,3,4), avg(2,5)].
    const src = new Float32Array([0, 1, 2, 3, 4, 5]);
    const dst = new Float32Array(2);

    downsample(src, 3, 2, 2, dst);

    expect(dst[0]).toBeCloseTo(2, 6);
    expect(dst[1]).toBeCloseTo(3.5, 6);
  });
});

describe('rgbaToLuma', () => {
  it('maps black to 0, white to 1 and weights green above red above blue', () => {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    ]);
    const luma = new Float32Array(5);

    rgbaToLuma(rgba, 5, luma);

    expect(luma[0]).toBeCloseTo(0, 6);
    expect(luma[1]).toBeCloseTo(1, 6);
    expect(luma[3]!).toBeGreaterThan(luma[2]!);
    expect(luma[2]!).toBeGreaterThan(luma[4]!);
  });
});

describe('GuidedMatteRefiner', () => {
  const width = 32;
  const height = 16;
  const count = width * height;

  it('leaves the matte alone at radius 0', () => {
    const matte = noise(count, 3);
    const before = [...matte];

    new GuidedMatteRefiner().refine(matte, noise(count, 4), width, height, 0);

    expect([...matte]).toEqual(before);
  });

  it('keeps output inside [0, 1]', () => {
    const matte = noise(count, 5);

    new GuidedMatteRefiner().refine(matte, noise(count, 6), width, height, 2);

    for (const value of matte) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('never invents a subject where the model saw none', () => {
    const matte = new Float32Array(count);

    // A busy guide image must not pull foreground out of nothing.
    new GuidedMatteRefiner().refine(matte, noise(count, 7), width, height, 2);

    for (const value of matte) expect(value).toBeCloseTo(0, 6);
  });

  it('keeps a confident subject confident', () => {
    const matte = new Float32Array(count).fill(1);

    new GuidedMatteRefiner().refine(matte, noise(count, 8), width, height, 2);

    for (const value of matte) expect(value).toBeCloseTo(1, 5);
  });

  it('snaps a soft model edge onto the real edge in the image', () => {
    // The image has a hard edge at x = 12 (dark room, bright subject). The
    // model's edge is a soft ramp from x = 9 to 17, centred a pixel off, as a
    // mask upscaled from 256x256 typically is.
    const luma = new Float32Array(count);
    const matte = new Float32Array(count);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        luma[y * width + x] = x >= 12 ? 0.85 : 0.15;
        matte[y * width + x] = Math.min(1, Math.max(0, (x - 9) / 8));
      }
    }
    const row = Math.floor(height / 2) * width;
    const stepBefore = matte[row + 12]! - matte[row + 11]!;
    expect(halfCrossing(matte, width, height)).toBe(13);

    new GuidedMatteRefiner().refine(matte, luma, width, height, 2);

    // The half-coverage point lands on the image edge, and the matte now
    // changes sharply there instead of ramping across it.
    expect(halfCrossing(matte, width, height)).toBe(12);
    expect(matte[row + 12]! - matte[row + 11]!).toBeGreaterThan(stepBefore * 3);
  });

  it('releases its buffers on reset and reallocates for a new size', () => {
    const refiner = new GuidedMatteRefiner();
    refiner.refine(noise(count), noise(count, 2), width, height, 1);
    expect(refiner.size).toBeGreaterThan(0);

    refiner.reset();
    expect(refiner.size).toBe(0);

    refiner.refine(noise(64), noise(64, 2), 8, 8, 1);
    expect(refiner.size).toBe(16);
  });
});
