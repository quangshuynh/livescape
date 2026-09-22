import { useEffect, useRef } from 'react';

import type { ActiveEffectState } from '../rendererState.js';
import { createEffectSystem, type EffectSystem, type Viewport } from './particles.js';

function effectKey(effect: ActiveEffectState): string {
  return `${effect.effectId}:${effect.instance}`;
}

interface EffectsLayerProps {
  readonly effects: readonly ActiveEffectState[];
  readonly reducedMotion: boolean;
}

/**
 * Single canvas that hosts every active effect.
 *
 * The animation loop only runs while something is active, so an idle renderer
 * sitting in OBS costs nothing.
 */
export function EffectsLayer({ effects, reducedMotion }: EffectsLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const systemsRef = useRef(new Map<string, EffectSystem>());
  const effectsRef = useRef(effects);
  const hasEffects = effects.length > 0;

  useEffect(() => {
    effectsRef.current = effects;
  }, [effects]);

  useEffect(() => {
    const systems = systemsRef.current;
    const wanted = new Set(effects.map(effectKey));

    for (const key of [...systems.keys()]) {
      if (!wanted.has(key)) systems.delete(key);
    }
    for (const effect of effects) {
      const key = effectKey(effect);
      const existing = systems.get(key);
      if (existing) {
        existing.setIntensity(effect.intensity);
      } else {
        systems.set(key, createEffectSystem(effect.effectId, { intensity: effect.intensity, reducedMotion }));
      }
    }
  }, [effects, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let lastTime = 0;
    let stopped = false;

    const viewport: Viewport = { width: 0, height: 0 };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth || window.innerWidth;
      const height = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      Object.assign(viewport, { width, height });
    };

    resize();
    window.addEventListener('resize', resize);

    if (!hasEffects) {
      // Nothing to animate: clear the layer and leave the CPU alone.
      ctx.clearRect(0, 0, viewport.width, viewport.height);
      return () => {
        window.removeEventListener('resize', resize);
      };
    }

    const tick = (time: number) => {
      if (stopped) return;
      const dtMs = lastTime === 0 ? 16 : Math.min(64, time - lastTime);
      lastTime = time;

      ctx.clearRect(0, 0, viewport.width, viewport.height);
      for (const effect of effectsRef.current) {
        const system = systemsRef.current.get(effectKey(effect));
        if (!system) continue;
        system.update(dtMs, viewport);
        system.draw(ctx, viewport);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [hasEffects]);

  return <canvas ref={canvasRef} className="effects-layer" aria-hidden="true" />;
}
