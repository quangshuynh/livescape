import { describe, expect, it } from 'vitest';

import { MOTION_HIGH, MOTION_LOW, TemporalMatteFilter, temporalKeep } from './temporal.js';

function run(filter: TemporalMatteFilter, values: number[], smoothing: number): number[] {
  const input = new Float32Array(values);
  const out = new Float32Array(values.length);
  filter.apply(input, values.length, smoothing, out);
  return [...out];
}

describe('temporalKeep', () => {
  it('keeps the full smoothing weight for changes below the noise band', () => {
    expect(temporalKeep(0, 0.5)).toBe(0.5);
    expect(temporalKeep(MOTION_LOW, 0.5)).toBe(0.5);
    expect(temporalKeep(-MOTION_LOW / 2, 0.5)).toBe(0.5);
  });

  it('keeps nothing for changes that are clearly motion', () => {
    expect(temporalKeep(MOTION_HIGH, 0.9)).toBe(0);
    expect(temporalKeep(-1, 0.9)).toBe(0);
    expect(temporalKeep(1, 0.9)).toBe(0);
  });

  it('falls monotonically as the change grows, symmetrically in sign', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let delta = 0; delta <= 1; delta += 0.02) {
      const keep = temporalKeep(delta, 0.6);
      expect(keep).toBeLessThanOrEqual(previous);
      expect(temporalKeep(-delta, 0.6)).toBeCloseTo(keep, 10);
      previous = keep;
    }
  });

  it('clamps the smoothing weight', () => {
    expect(temporalKeep(0, 5)).toBe(0.9);
    expect(temporalKeep(0, -1)).toBe(0);
  });
});

describe('TemporalMatteFilter', () => {
  it('passes the first frame straight through', () => {
    const filter = new TemporalMatteFilter();

    expect(run(filter, [0.1, 0.9], 0.9)).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(0.9, 6),
    ]);
  });

  it('lets a hand arrive in a single frame, whatever the smoothing', () => {
    const filter = new TemporalMatteFilter();
    run(filter, [0.02], 0.9);

    // Background to confident subject: no fade-in, so no clipped hand.
    expect(run(filter, [0.97], 0.9)[0]).toBeCloseTo(0.97, 6);
  });

  it('lets a hand leave in a single frame, so no ghost trails behind it', () => {
    const filter = new TemporalMatteFilter();
    run(filter, [0.98], 0.9);

    // Subject to background: the room behind must not stay "person".
    expect(run(filter, [0.03], 0.9)[0]).toBeCloseTo(0.03, 6);
  });

  it('damps jitter on a still edge', () => {
    const filter = new TemporalMatteFilter();
    const raw: number[] = [];
    const filtered: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const value = 0.5 + (i % 2 === 0 ? 0.04 : -0.04);
      raw.push(value);
      filtered.push(run(filter, [value], 0.6)[0]!);
    }

    const swing = (values: number[]) =>
      Math.max(...values.slice(20)) - Math.min(...values.slice(20));
    expect(swing(filtered)).toBeLessThan(swing(raw) * 0.5);
  });

  it('is a pass-through with smoothing at zero', () => {
    const filter = new TemporalMatteFilter();
    run(filter, [0.5, 0.5], 0);

    expect(run(filter, [0.52, 0.47], 0)).toEqual([
      expect.closeTo(0.52, 6),
      expect.closeTo(0.47, 6),
    ]);
  });

  it('can filter in place', () => {
    const filter = new TemporalMatteFilter();
    const data = new Float32Array([0.5]);
    filter.apply(data, 1, 0.5, data);
    data[0] = 0.54;
    filter.apply(data, 1, 0.5, data);

    expect(data[0]).toBeCloseTo(0.52, 6);
  });

  it('holds exactly one frame of history and drops it on reset', () => {
    const filter = new TemporalMatteFilter();
    for (let i = 0; i < 50; i += 1) run(filter, [0.1, 0.2, 0.3], 0.5);

    expect(filter.size).toBe(3);
    filter.reset();
    expect(filter.size).toBe(0);
  });

  it('starts over when the mask size changes', () => {
    const filter = new TemporalMatteFilter();
    run(filter, [0.5, 0.5], 0.9);

    // A different size is a different camera or preset: no history applies.
    expect(run(filter, [0.54, 0.54, 0.54], 0.9)[0]).toBeCloseTo(0.54, 6);
    expect(filter.size).toBe(3);
  });
});
