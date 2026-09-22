import { describe, expect, it, vi } from 'vitest';

import { FakeSegmenter, solidMask } from '../test/fakeSegmenter.js';
import { FAILURE_THRESHOLD, SegmentationScheduler } from './scheduler.js';
import type { SegmentationMask } from './types.js';

/** A frame stand-in: the scheduler never looks inside it. */
const FRAME = {} as HTMLCanvasElement;

interface Harness {
  readonly scheduler: SegmentationScheduler;
  readonly segmenter: FakeSegmenter;
  readonly masks: SegmentationMask[];
  readonly failures: unknown[];
  advance(ms: number): void;
}

function harness(minIntervalMs = 0): Harness {
  const segmenter = new FakeSegmenter();
  const masks: SegmentationMask[] = [];
  const failures: unknown[] = [];
  let clock = 0;

  const scheduler = new SegmentationScheduler({
    segmenter,
    minIntervalMs,
    onMask: (mask) => masks.push(mask),
    onFailure: (error) => failures.push(error),
    now: () => clock,
  });

  return {
    scheduler,
    segmenter,
    masks,
    failures,
    advance: (ms) => {
      clock += ms;
    },
  };
}

/** Lets the scheduler's internal promise chain settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SegmentationScheduler concurrency', () => {
  it('runs one inference at a time', async () => {
    const { scheduler, segmenter } = harness();

    expect(scheduler.submit(FRAME, 0)).toBe('started');
    expect(scheduler.submit(FRAME, 16)).toBe('skipped');
    expect(scheduler.submit(FRAME, 32)).toBe('skipped');

    expect(segmenter.inFlight).toBe(1);
    expect(segmenter.calls).toHaveLength(1);
  });

  it('drops stale frames instead of queueing them', async () => {
    const { scheduler, segmenter, masks } = harness();

    scheduler.submit(FRAME, 0);
    for (let i = 1; i <= 20; i += 1) scheduler.submit(FRAME, i * 16);

    expect(scheduler.stats.skipped).toBe(20);

    // Finishing the one outstanding call must not release a backlog.
    segmenter.finishOne(solidMask(2, 2, 1));
    await settle();

    expect(masks).toHaveLength(1);
    expect(segmenter.inFlight).toBe(0);
    expect(segmenter.calls).toHaveLength(1);
  });

  it('accepts the newest frame once inference finishes', async () => {
    const { scheduler, segmenter } = harness();

    scheduler.submit(FRAME, 0);
    scheduler.submit(FRAME, 16);
    segmenter.finishOne();
    await settle();

    expect(scheduler.submit(FRAME, 999)).toBe('started');
    expect(segmenter.calls.at(-1)).toBe(999);
  });

  it('holds inference to the configured interval', async () => {
    const { scheduler, segmenter, advance } = harness(40);

    expect(scheduler.submit(FRAME, 0)).toBe('started');
    segmenter.finishOne();
    await settle();

    advance(16);
    expect(scheduler.submit(FRAME, 16)).toBe('throttled');

    advance(40);
    expect(scheduler.submit(FRAME, 56)).toBe('started');
    expect(scheduler.stats.throttled).toBe(1);
  });

  it('keeps timestamps monotonic even when the caller repeats one', async () => {
    const { scheduler, segmenter } = harness();

    scheduler.submit(FRAME, 100);
    segmenter.finishOne();
    await settle();
    scheduler.submit(FRAME, 100);

    expect(segmenter.calls).toEqual([100, 101]);
  });
});

describe('SegmentationScheduler measurement', () => {
  it('records inference duration and mask throughput', async () => {
    const { scheduler, segmenter, advance } = harness();

    scheduler.submit(FRAME, 0);
    advance(18);
    segmenter.finishOne();
    await settle();

    expect(scheduler.stats.completed).toBe(1);
    expect(scheduler.stats.lastInferenceMs).toBe(18);
    expect(scheduler.stats.inferenceMs).toBe(18);

    advance(22);
    scheduler.submit(FRAME, 40);
    advance(20);
    segmenter.finishOne();
    await settle();

    expect(scheduler.stats.completed).toBe(2);
    expect(scheduler.stats.segmentationFps).toBeGreaterThan(0);
  });

  it('starts from zeroed counters', () => {
    expect(harness().scheduler.stats).toMatchObject({
      completed: 0,
      skipped: 0,
      throttled: 0,
      errors: 0,
    });
  });
});

describe('SegmentationScheduler failure handling', () => {
  it('keeps running after an isolated failure', async () => {
    const { scheduler, segmenter, masks } = harness();

    scheduler.submit(FRAME, 0);
    segmenter.failOne(new Error('one bad frame'));
    await settle();

    expect(scheduler.stats.errors).toBe(1);
    expect(scheduler.hasFailed).toBe(false);

    scheduler.submit(FRAME, 16);
    segmenter.finishOne(solidMask(2, 2, 1));
    await settle();

    expect(masks).toHaveLength(1);
  });

  it('gives up after repeated failures and reports once', async () => {
    const { scheduler, segmenter, failures } = harness();

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
      scheduler.submit(FRAME, i * 16);
      segmenter.failOne(new Error(`failure ${i}`));
      await settle();
    }

    expect(scheduler.hasFailed).toBe(true);
    expect(failures).toHaveLength(1);
    expect(scheduler.submit(FRAME, 999)).toBe('stopped');
  });

  it('resets the failure run after a success', async () => {
    const { scheduler, segmenter, failures } = harness();

    for (let i = 0; i < FAILURE_THRESHOLD - 1; i += 1) {
      scheduler.submit(FRAME, i * 16);
      segmenter.failOne(new Error('transient'));
      await settle();
    }

    scheduler.submit(FRAME, 500);
    segmenter.finishOne(solidMask(2, 2, 1));
    await settle();

    scheduler.submit(FRAME, 600);
    segmenter.failOne(new Error('transient'));
    await settle();

    expect(scheduler.hasFailed).toBe(false);
    expect(failures).toHaveLength(0);
  });

  it('tolerates a backend that resolves without a mask', async () => {
    const { scheduler, segmenter, masks } = harness();

    scheduler.submit(FRAME, 0);
    segmenter.finishOne(null);
    await settle();

    expect(masks).toHaveLength(0);
    expect(scheduler.stats.completed).toBe(1);
    expect(scheduler.hasFailed).toBe(false);
  });

  it('never reports a failure without an onFailure handler', async () => {
    const segmenter = new FakeSegmenter();
    const scheduler = new SegmentationScheduler({
      segmenter,
      minIntervalMs: 0,
      onMask: () => {},
    });

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
      scheduler.submit(FRAME, i * 16);
      segmenter.failOne(new Error('boom'));
      await settle();
    }

    expect(scheduler.hasFailed).toBe(true);
  });
});

describe('SegmentationScheduler disposal', () => {
  it('disposes the backend and refuses further work', async () => {
    const { scheduler, segmenter } = harness();

    await scheduler.dispose();

    expect(segmenter.disposed).toBe(1);
    expect(scheduler.submit(FRAME, 0)).toBe('stopped');
  });

  it('is safe to dispose twice', async () => {
    const { scheduler, segmenter } = harness();

    await scheduler.dispose();
    await scheduler.dispose();

    expect(segmenter.disposed).toBe(1);
  });

  it('drops a mask that arrives after disposal', async () => {
    const { scheduler, segmenter, masks } = harness();
    const onMask = vi.fn();

    scheduler.submit(FRAME, 0);
    await scheduler.dispose();
    segmenter.finishOne(solidMask(2, 2, 1));
    await settle();

    expect(masks).toHaveLength(0);
    expect(onMask).not.toHaveBeenCalled();
  });

  it('swallows a failure that arrives after disposal', async () => {
    const { scheduler, segmenter, failures } = harness();

    scheduler.submit(FRAME, 0);
    await scheduler.dispose();
    segmenter.failOne(new Error('too late'));
    await settle();

    expect(failures).toHaveLength(0);
    expect(scheduler.stats.errors).toBe(0);
  });
});

describe('SegmentationScheduler frame capture and pairing', () => {
  it('only captures a frame when an inference actually starts', async () => {
    const { scheduler, segmenter } = harness(40);
    const captures: number[] = [];
    const capture = (sequence: number) => {
      captures.push(sequence);
      return FRAME;
    };

    expect(scheduler.submit(capture, 0)).toBe('started');
    expect(scheduler.submit(capture, 16)).toBe('skipped');
    segmenter.finishOne(solidMask(2, 2, 1));
    await settle();
    expect(scheduler.submit(capture, 20)).toBe('throttled');

    // Skipped and throttled frames were never copied.
    expect(captures).toEqual([1]);
  });

  it('numbers inferences and hands the number back with the mask', async () => {
    const segmenter = new FakeSegmenter();
    segmenter.manual = false;
    const results: number[] = [];
    const scheduler = new SegmentationScheduler({
      segmenter,
      minIntervalMs: 0,
      onMask: (_mask, result) => results.push(result.sequence),
    });

    for (let i = 0; i < 3; i += 1) {
      scheduler.submit(FRAME, i * 33);
      await settle();
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it('reports a started inference that produced no mask', async () => {
    const segmenter = new FakeSegmenter();
    const dropped: number[] = [];
    const scheduler = new SegmentationScheduler({
      segmenter,
      minIntervalMs: 0,
      onMask: () => {},
      onDrop: (sequence) => dropped.push(sequence),
    });

    scheduler.submit(FRAME, 0);
    segmenter.finishOne(null);
    await settle();
    scheduler.submit(FRAME, 33);
    segmenter.failOne(new Error('lost context'));
    await settle();

    expect(dropped).toEqual([1, 2]);
  });

  it('does not start when the capture yields nothing', () => {
    const { scheduler, segmenter } = harness();

    expect(scheduler.submit(() => null, 0)).toBe('stopped');
    expect(segmenter.calls).toHaveLength(0);
    expect(scheduler.isBusy).toBe(false);
  });
});

describe('SegmentationScheduler duty cycle', () => {
  function timed(maxDutyCycle: number) {
    const segmenter = new FakeSegmenter();
    let clock = 0;
    const scheduler = new SegmentationScheduler({
      segmenter,
      minIntervalMs: 20,
      maxDutyCycle,
      onMask: () => {},
      now: () => clock,
    });
    return {
      scheduler,
      segmenter,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it('stretches the interval when masks cost more than the budget allows', async () => {
    const { scheduler, segmenter, advance } = timed(0.5);

    scheduler.submit(FRAME, 0);
    advance(30); // each mask costs 30 ms
    segmenter.finishOne();
    await settle();

    // 30 ms at a 50% duty cycle needs 60 ms between starts, not the preset's 20.
    expect(scheduler.stats.costMs).toBe(30);
    expect(scheduler.stats.intervalMs).toBe(60);
    advance(20);
    expect(scheduler.submit(FRAME, 50)).toBe('throttled');
    advance(10);
    expect(scheduler.submit(FRAME, 60)).toBe('started');
  });

  it('keeps the preset interval while masks are cheap', async () => {
    const { scheduler, segmenter, advance } = timed(0.5);

    scheduler.submit(FRAME, 0);
    advance(5);
    segmenter.finishOne();
    await settle();

    expect(scheduler.stats.intervalMs).toBe(20);
  });

  it('applies no budget without a duty cycle', async () => {
    const segmenter = new FakeSegmenter();
    let clock = 0;
    const scheduler = new SegmentationScheduler({
      segmenter,
      minIntervalMs: 10,
      onMask: () => {},
      now: () => clock,
    });

    scheduler.submit(FRAME, 0);
    clock += 100;
    segmenter.finishOne();
    await settle();

    expect(scheduler.stats.intervalMs).toBe(10);
  });
});
