import { describe, expect, it } from 'vitest';

import { FrameMaskSync } from './sync.js';

function harness() {
  const released: string[] = [];
  const sync = new FrameMaskSync<string>((frame) => released.push(frame));
  return { sync, released };
}

describe('FrameMaskSync', () => {
  it('shows nothing before the first mask', () => {
    const { sync } = harness();
    sync.capture(1, 0, 'f1');

    expect(sync.displayed).toBeNull();
    expect(sync.age(10)).toBeNull();
  });

  it('shows each frame with the mask computed from it', () => {
    const { sync } = harness();
    sync.capture(1, 100, 'f1');

    const shown = sync.resolve(1);

    expect(shown?.frame).toBe('f1');
    expect(sync.displayed?.sequence).toBe(1);
    expect(sync.waiting).toBeNull();
  });

  it('keeps showing the last pair while the next frame is being segmented', () => {
    const { sync } = harness();
    sync.capture(1, 0, 'f1');
    sync.resolve(1);

    sync.capture(2, 33, 'f2');

    // The newer frame has no mask yet, so the older pair stays on screen
    // rather than the newer frame being shown under the older mask.
    expect(sync.displayed?.frame).toBe('f1');
    expect(sync.waiting?.frame).toBe('f2');
  });

  it('rejects a mask whose frame is no longer waiting', () => {
    const { sync } = harness();
    sync.capture(1, 0, 'f1');
    sync.capture(2, 33, 'f2');

    expect(sync.resolve(1)).toBeNull();
    expect(sync.stale).toBe(1);
    expect(sync.resolve(2)?.frame).toBe('f2');
  });

  it('rejects a mask that arrives after a reset', () => {
    const { sync } = harness();
    sync.capture(1, 0, 'f1');
    sync.reset();

    expect(sync.resolve(1)).toBeNull();
    expect(sync.displayed).toBeNull();
    expect(sync.stale).toBe(1);
  });

  it('never holds more than two frames, and releases each exactly once', () => {
    const { sync, released } = harness();
    const frames: string[] = [];
    for (let sequence = 1; sequence <= 50; sequence += 1) {
      const frame = `f${sequence}`;
      frames.push(frame);
      sync.capture(sequence, sequence * 33, frame);
      expect(sync.held).toBeLessThanOrEqual(2);
      if (sequence % 3 !== 0) sync.resolve(sequence);
      expect(sync.held).toBeLessThanOrEqual(2);
    }
    sync.reset();

    expect(sync.held).toBe(0);
    expect([...released].sort()).toEqual([...frames].sort());
    expect(new Set(released).size).toBe(released.length);
  });

  it('releases the waiting frame when its inference produced nothing', () => {
    const { sync, released } = harness();
    sync.capture(1, 0, 'f1');

    sync.abandon(1);

    expect(released).toEqual(['f1']);
    expect(sync.waiting).toBeNull();
    expect(sync.resolve(1)).toBeNull();
  });

  it('ignores an abandon for a frame that is not waiting', () => {
    const { sync, released } = harness();
    sync.capture(2, 0, 'f2');

    sync.abandon(1);

    expect(released).toEqual([]);
    expect(sync.waiting?.frame).toBe('f2');
  });

  it('reports the age of the frame on screen', () => {
    const { sync } = harness();
    sync.capture(1, 1000, 'f1');
    sync.resolve(1);

    expect(sync.age(1024)).toBe(24);
    expect(sync.age(900)).toBe(0);
  });
});
