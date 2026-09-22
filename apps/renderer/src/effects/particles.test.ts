import { describe, expect, it } from 'vitest';

import { createEffectSystem, particleCountFor, type Viewport } from './particles.js';

const viewport: Viewport = { width: 1920, height: 1080 };

/** Deterministic stand-in for Math.random so particle tests are repeatable. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length] ?? 0.5;
    index += 1;
    return value;
  };
}

describe('particleCountFor', () => {
  it('scales the particle budget with intensity', () => {
    expect(particleCountFor('rain', 0)).toBe(90);
    expect(particleCountFor('rain', 1)).toBe(520);
    expect(particleCountFor('rain', 0.5)).toBeGreaterThan(particleCountFor('rain', 0.2));
  });

  it('clamps intensity outside the protocol range', () => {
    expect(particleCountFor('snow', -5)).toBe(particleCountFor('snow', 0));
    expect(particleCountFor('snow', 9)).toBe(particleCountFor('snow', 1));
  });

  it('cuts the budget when the viewer asked for reduced motion', () => {
    expect(particleCountFor('rain', 1, true)).toBeLessThan(particleCountFor('rain', 1, false));
    expect(particleCountFor('fireworks', 0, true)).toBeGreaterThanOrEqual(1);
  });
});

describe('effect systems', () => {
  it('rejects nothing outside the registry: the factory is exhaustive by type', () => {
    for (const effectId of ['rain', 'snow', 'fireworks'] as const) {
      const system = createEffectSystem(effectId, { intensity: 0.5, reducedMotion: false });
      expect(system.effectId).toBe(effectId);
    }
  });

  it('keeps rain drops inside the viewport by recycling them', () => {
    const system = createEffectSystem('rain', {
      intensity: 0.1,
      reducedMotion: false,
      random: sequence([0.5, 0.25, 0.75]),
    });

    for (let step = 0; step < 200; step += 1) {
      system.update(16, viewport);
    }

    const drops = (system as unknown as { drops: { x: number; y: number }[] }).drops;
    expect(drops.length).toBe(particleCountFor('rain', 0.1));
    for (const drop of drops) {
      expect(drop.y).toBeLessThanOrEqual(viewport.height + 60);
      expect(drop.x).toBeLessThanOrEqual(viewport.width);
    }
  });

  it('recycles snow flakes that fall past the bottom edge', () => {
    const system = createEffectSystem('snow', {
      intensity: 1,
      reducedMotion: false,
      random: sequence([0.9, 0.1, 0.6]),
    });

    for (let step = 0; step < 400; step += 1) {
      system.update(16, viewport);
    }

    const flakes = (system as unknown as { flakes: { y: number }[] }).flakes;
    expect(flakes.length).toBe(particleCountFor('snow', 1));
    for (const flake of flakes) {
      expect(flake.y).toBeLessThanOrEqual(viewport.height + 10);
    }
  });

  it('spawns fireworks sparks that eventually burn out', () => {
    const system = createEffectSystem('fireworks', {
      intensity: 1,
      reducedMotion: false,
      random: sequence([0.4, 0.8, 0.2, 0.6]),
    });
    const sparksOf = () => (system as unknown as { sparks: unknown[] }).sparks.length;

    system.update(16, viewport);
    expect(sparksOf()).toBeGreaterThan(0);

    const afterBurst = sparksOf();
    for (let step = 0; step < 40; step += 1) {
      system.update(60, viewport);
    }
    expect(sparksOf()).not.toBe(afterBurst);
  });

  it('accepts an intensity update without rebuilding the system', () => {
    const system = createEffectSystem('rain', { intensity: 0.1, reducedMotion: false });
    system.update(16, viewport);
    system.setIntensity(1);
    system.update(16, viewport);

    const drops = (system as unknown as { drops: unknown[] }).drops;
    expect(drops.length).toBe(particleCountFor('rain', 1));
  });
});
