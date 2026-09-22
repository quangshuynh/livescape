import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeCanvas, stubVideoSize } from '../test/fakeCanvas.js';
import { holdFrame } from './heldFrame.js';

let canvas: ReturnType<typeof installFakeCanvas>;
let restoreVideo: () => void;

beforeEach(() => {
  canvas = installFakeCanvas();
  restoreVideo = stubVideoSize(1280, 720);
});

afterEach(() => {
  restoreVideo();
  canvas.restore();
  vi.unstubAllGlobals();
});

const spares = () => [document.createElement('canvas'), document.createElement('canvas')] as const;

describe('holdFrame with WebCodecs', () => {
  it('holds a VideoFrame without copying, and closes it exactly once', () => {
    const closed: number[] = [];
    let made = 0;
    vi.stubGlobal(
      'VideoFrame',
      class {
        readonly id = ++made;
        readonly displayWidth = 1280;
        readonly displayHeight = 720;
        close() {
          closed.push(this.id);
        }
      },
    );
    const pool = spares();

    const held = holdFrame(document.createElement('video'), pool, null);

    expect(held?.width).toBe(1280);
    expect(held?.height).toBe(720);
    expect(held?.source).not.toBe(pool[0]);
    expect(pool[0].width).not.toBe(1280);
    held?.close();
    held?.close();
    expect(closed).toEqual([1]);
  });

  it('falls back to a copy when the frame cannot be wrapped', () => {
    vi.stubGlobal(
      'VideoFrame',
      class {
        constructor() {
          throw new DOMException('no frame yet', 'InvalidStateError');
        }
      },
    );
    const pool = spares();

    const held = holdFrame(document.createElement('video'), pool, null);

    expect(held?.source).toBe(pool[0]);
  });
});

describe('holdFrame without WebCodecs', () => {
  beforeEach(() => vi.stubGlobal('VideoFrame', undefined));

  it('copies into the spare canvas that is not on screen', () => {
    const pool = spares();
    const video = document.createElement('video');

    const first = holdFrame(video, pool, null);
    const second = holdFrame(video, pool, first!.source);
    const third = holdFrame(video, pool, second!.source);

    expect(first?.source).toBe(pool[0]);
    expect(second?.source).toBe(pool[1]);
    expect(third?.source).toBe(pool[0]);
    expect(pool[0].width).toBe(1280);
  });

  it('holds nothing before the video has a frame', () => {
    restoreVideo();
    restoreVideo = stubVideoSize(0, 0);

    expect(holdFrame(document.createElement('video'), spares(), null)).toBeNull();
  });
});
