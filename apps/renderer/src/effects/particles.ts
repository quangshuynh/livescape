import type { EffectId } from '@livescape/protocol';

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface EffectOptions {
  readonly intensity: number;
  readonly reducedMotion: boolean;
  readonly random?: () => number;
}

export interface EffectSystem {
  readonly effectId: EffectId;
  setIntensity(intensity: number): void;
  update(dtMs: number, viewport: Viewport): void;
  draw(ctx: CanvasRenderingContext2D, viewport: Viewport): void;
}

/** Particle budget per effect, scaled by the event's normalized intensity. */
export const PARTICLE_BUDGET: Record<EffectId, { min: number; max: number }> = {
  rain: { min: 90, max: 520 },
  snow: { min: 60, max: 340 },
  fireworks: { min: 1, max: 4 },
};

export function particleCountFor(
  effectId: EffectId,
  intensity: number,
  reducedMotion = false,
): number {
  const budget = PARTICLE_BUDGET[effectId];
  const clamped = Math.min(1, Math.max(0, intensity));
  const count = Math.round(budget.min + (budget.max - budget.min) * clamped);
  return reducedMotion ? Math.max(1, Math.round(count * 0.35)) : count;
}

interface Drop {
  x: number;
  y: number;
  length: number;
  speed: number;
  alpha: number;
}

class RainSystem implements EffectSystem {
  readonly effectId = 'rain' as const;
  private drops: Drop[] = [];
  private readonly random: () => number;
  private readonly speedScale: number;

  constructor(
    private intensity: number,
    private readonly reducedMotion: boolean,
    random: () => number = Math.random,
  ) {
    this.random = random;
    this.speedScale = reducedMotion ? 0.45 : 1;
  }

  setIntensity(intensity: number): void {
    this.intensity = intensity;
  }

  private spawn(viewport: Viewport, aboveScreen: boolean): Drop {
    return {
      x: this.random() * viewport.width,
      y: aboveScreen ? -this.random() * viewport.height : this.random() * viewport.height,
      length: 10 + this.random() * 18 * (0.5 + this.intensity),
      speed: (900 + this.random() * 700) * this.speedScale,
      alpha: 0.25 + this.random() * 0.45,
    };
  }

  update(dtMs: number, viewport: Viewport): void {
    const target = particleCountFor('rain', this.intensity, this.reducedMotion);
    while (this.drops.length < target) this.drops.push(this.spawn(viewport, this.drops.length > 0));
    if (this.drops.length > target) this.drops.length = target;

    const dt = dtMs / 1000;
    for (const drop of this.drops) {
      drop.y += drop.speed * dt;
      drop.x += 60 * dt * this.speedScale;
      if (drop.y - drop.length > viewport.height) {
        drop.y = -drop.length - this.random() * 120;
        drop.x = this.random() * viewport.width;
      }
      if (drop.x > viewport.width) drop.x -= viewport.width;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.3;
    for (const drop of this.drops) {
      ctx.strokeStyle = `rgba(186, 214, 255, ${drop.alpha})`;
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - 4, drop.y - drop.length);
      ctx.stroke();
    }
  }
}

interface Flake {
  x: number;
  y: number;
  radius: number;
  speed: number;
  sway: number;
  phase: number;
  alpha: number;
}

class SnowSystem implements EffectSystem {
  readonly effectId = 'snow' as const;
  private flakes: Flake[] = [];
  private readonly random: () => number;
  private readonly speedScale: number;

  constructor(
    private intensity: number,
    private readonly reducedMotion: boolean,
    random: () => number = Math.random,
  ) {
    this.random = random;
    this.speedScale = reducedMotion ? 0.4 : 1;
  }

  setIntensity(intensity: number): void {
    this.intensity = intensity;
  }

  private spawn(viewport: Viewport, aboveScreen: boolean): Flake {
    return {
      x: this.random() * viewport.width,
      y: aboveScreen ? -this.random() * viewport.height : this.random() * viewport.height,
      radius: 1 + this.random() * 2.6,
      speed: (28 + this.random() * 55) * this.speedScale,
      sway: (12 + this.random() * 36) * (this.reducedMotion ? 0.3 : 1),
      phase: this.random() * Math.PI * 2,
      alpha: 0.5 + this.random() * 0.5,
    };
  }

  update(dtMs: number, viewport: Viewport): void {
    const target = particleCountFor('snow', this.intensity, this.reducedMotion);
    while (this.flakes.length < target) {
      this.flakes.push(this.spawn(viewport, this.flakes.length > 0));
    }
    if (this.flakes.length > target) this.flakes.length = target;

    const dt = dtMs / 1000;
    for (const flake of this.flakes) {
      flake.y += flake.speed * dt;
      flake.phase += dt * 0.8;
      if (flake.y - flake.radius > viewport.height) {
        flake.y = -flake.radius - this.random() * 60;
        flake.x = this.random() * viewport.width;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const flake of this.flakes) {
      const x = flake.x + Math.sin(flake.phase) * flake.sway;
      ctx.fillStyle = `rgba(244, 249, 255, ${flake.alpha})`;
      ctx.beginPath();
      ctx.arc(x, flake.y, flake.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
}

class FireworksSystem implements EffectSystem {
  readonly effectId = 'fireworks' as const;
  private sparks: Spark[] = [];
  private cooldownMs = 0;
  private readonly random: () => number;
  private readonly speedScale: number;

  constructor(
    private intensity: number,
    private readonly reducedMotion: boolean,
    random: () => number = Math.random,
  ) {
    this.random = random;
    this.speedScale = reducedMotion ? 0.5 : 1;
  }

  setIntensity(intensity: number): void {
    this.intensity = intensity;
  }

  /** Milliseconds between bursts: higher intensity means more frequent bursts. */
  private burstIntervalMs(): number {
    const bursts = particleCountFor('fireworks', this.intensity, this.reducedMotion);
    return Math.max(220, 1400 / bursts);
  }

  private burst(viewport: Viewport): void {
    const cx = viewport.width * (0.15 + this.random() * 0.7);
    const cy = viewport.height * (0.12 + this.random() * 0.38);
    const hue = Math.floor(this.random() * 360);
    const count = this.reducedMotion ? 26 : 54 + Math.floor(this.random() * 40);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + this.random() * 0.2;
      const speed = (70 + this.random() * 190) * this.speedScale;
      const maxLife = 900 + this.random() * 900;
      this.sparks.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: maxLife,
        maxLife,
        hue: hue + this.random() * 40 - 20,
      });
    }
  }

  update(dtMs: number, viewport: Viewport): void {
    this.cooldownMs -= dtMs;
    if (this.cooldownMs <= 0) {
      this.burst(viewport);
      this.cooldownMs = this.burstIntervalMs();
    }

    const dt = dtMs / 1000;
    const gravity = 58 * this.speedScale;
    const alive: Spark[] = [];
    for (const spark of this.sparks) {
      spark.life -= dtMs;
      if (spark.life <= 0) continue;
      spark.vy += gravity * dt;
      spark.vx *= 0.99;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      alive.push(spark);
    }
    this.sparks = alive;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const spark of this.sparks) {
      const fade = Math.max(0, spark.life / spark.maxLife);
      ctx.fillStyle = `hsla(${spark.hue}, 95%, ${55 + fade * 20}%, ${fade})`;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, 1.1 + fade * 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Effect ids resolve only through this factory -- nothing else can be run. */
export function createEffectSystem(effectId: EffectId, options: EffectOptions): EffectSystem {
  const { intensity, reducedMotion, random } = options;
  switch (effectId) {
    case 'rain':
      return new RainSystem(intensity, reducedMotion, random);
    case 'snow':
      return new SnowSystem(intensity, reducedMotion, random);
    case 'fireworks':
      return new FireworksSystem(intensity, reducedMotion, random);
  }
}
