import { describe, expect, it } from 'vitest';

import { VideoFrameWatcher, type VideoFrameSource } from './videoFrames.js';

/** A video element whose frames the test delivers by hand. */
class FakeVideo implements VideoFrameSource {
  private callbacks = new Map<number, (now: number) => void>();
  private next = 1;
  cancelled: number[] = [];

  requestVideoFrameCallback = (callback: (now: number) => void): number => {
    const handle = this.next++;
    this.callbacks.set(handle, callback);
    return handle;
  };

  cancelVideoFrameCallback = (handle: number): void => {
    this.cancelled.push(handle);
    this.callbacks.delete(handle);
  };

  get pending(): number {
    return this.callbacks.size;
  }

  present(now: number): void {
    const due = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of due) callback(now);
  }
}

describe('VideoFrameWatcher', () => {
  it('reports a new frame once per camera frame, not once per animation frame', () => {
    const video = new FakeVideo();
    const watcher = new VideoFrameWatcher(video);

    expect(watcher.hasNewFrame).toBe(false);
    video.present(33);
    expect(watcher.hasNewFrame).toBe(true);

    watcher.consume();
    // A second animation frame before the camera delivers again: nothing new.
    expect(watcher.hasNewFrame).toBe(false);
  });

  it('counts frames and measures the camera rate', () => {
    const video = new FakeVideo();
    const watcher = new VideoFrameWatcher(video);

    for (let i = 1; i <= 30; i += 1) video.present(i * (1000 / 30));

    expect(watcher.presentedFrames).toBe(30);
    expect(watcher.fps).toBeCloseTo(30, 0);
  });

  it('keeps exactly one callback registered, and cancels it on dispose', () => {
    const video = new FakeVideo();
    const watcher = new VideoFrameWatcher(video);
    video.present(1);
    video.present(2);
    expect(video.pending).toBe(1);

    watcher.dispose();

    expect(video.pending).toBe(0);
    expect(video.cancelled).toHaveLength(1);
  });

  it('treats every animation frame as new where the browser cannot report frames', () => {
    const watcher = new VideoFrameWatcher({});

    expect(watcher.supported).toBe(false);
    watcher.consume();
    expect(watcher.hasNewFrame).toBe(true);
    expect(watcher.fps).toBe(0);
  });
});
