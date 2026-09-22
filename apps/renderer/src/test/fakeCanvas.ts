import { vi } from 'vitest';

export interface FakeContext {
  readonly calls: [string, ...unknown[]][];
  readonly canvas: HTMLCanvasElement;
}

/**
 * A 2D context that records instead of rasterising, plus a manual animation
 * clock.
 *
 * The renderer's default test setup makes `getContext` return null, which is
 * right for the effect canvases but would stop the compositor's loop before it
 * did anything. Installing this lets the compositor tests run the real loop.
 */
export function installFakeCanvas(): {
  contexts: FakeContext[];
  frames: FrameClock;
  restore: () => void;
} {
  const contexts: FakeContext[] = [];
  const original = HTMLCanvasElement.prototype.getContext;
  const originalRaf = window.requestAnimationFrame;
  const originalCancel = window.cancelAnimationFrame;
  const frames = new FrameClock();

  HTMLCanvasElement.prototype.getContext = function getContext(
    this: HTMLCanvasElement,
    kind: string,
  ) {
    if (kind !== '2d') return null;
    const calls: [string, ...unknown[]][] = [];
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
      };

    const context = {
      calls,
      canvas: this,
      save: record('save'),
      restore: record('restore'),
      clearRect: record('clearRect'),
      drawImage: record('drawImage'),
      translate: record('translate'),
      scale: record('scale'),
      setTransform: record('setTransform'),
      putImageData: record('putImageData'),
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      globalCompositeOperation: 'source-over',
      filter: 'none',
    };
    contexts.push(context as unknown as FakeContext);
    return context as unknown as CanvasRenderingContext2D;
  } as HTMLCanvasElement['getContext'];

  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    frames.request(callback)) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((handle: number) =>
    frames.cancel(handle)) as typeof window.cancelAnimationFrame;

  return {
    contexts,
    frames,
    restore: () => {
      HTMLCanvasElement.prototype.getContext = original;
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCancel;
    },
  };
}

/** Animation frames the test drives by hand. */
export class FrameClock {
  private pending = new Map<number, FrameRequestCallback>();
  private next = 1;
  time = 0;

  request(callback: FrameRequestCallback): number {
    const handle = this.next++;
    this.pending.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.pending.delete(handle);
  }

  get scheduled(): number {
    return this.pending.size;
  }

  /** Runs whatever is currently queued, once, at `time + stepMs`. */
  tick(stepMs = 16): void {
    this.time += stepMs;
    const due = [...this.pending.entries()];
    this.pending.clear();
    for (const [, callback] of due) callback(this.time);
  }
}

/** jsdom video elements report no intrinsic size; the compositor needs one. */
export function stubVideoSize(width: number, height: number): () => void {
  const spies = (['videoWidth', 'videoHeight'] as const).map((property, index) =>
    vi.spyOn(HTMLVideoElement.prototype, property, 'get').mockReturnValue(
      index === 0 ? width : height,
    ),
  );
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(() => Promise.resolve());
  return () => {
    for (const spy of spies) spy.mockRestore();
    play.mockRestore();
  };
}
