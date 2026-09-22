/**
 * Pairs every mask with the camera frame it was computed from.
 *
 * Drawing the live video under whichever mask finished last is what makes the
 * room flash around a moving hand: the mask describes where the hand *was*,
 * the frame shows where it *is*, and the difference is background on one side
 * and a clipped hand on the other. Instead, the frame handed to the segmenter
 * is held, and only shown once its own mask arrives. The subject is then at
 * most one inference late, but its matte always fits it.
 *
 * At most two frames are held: one waiting for its mask, one on screen. The
 * scheduler never has more than one inference in flight, so nothing more is
 * ever needed. Every frame that stops being held is handed to `release`
 * exactly once, which is what closes `VideoFrame` handles promptly.
 */
export interface SyncedFrame<T> {
  readonly frame: T;
  readonly sequence: number;
  /** When the frame was captured, on the caller's clock. */
  readonly capturedAt: number;
}

export class FrameMaskSync<T> {
  private readonly release: (frame: T) => void;
  private pending: SyncedFrame<T> | null = null;
  private shown: SyncedFrame<T> | null = null;
  private staleCount = 0;

  constructor(release: (frame: T) => void = () => {}) {
    this.release = release;
  }

  /** The pair currently on screen, or `null` before the first mask. */
  get displayed(): SyncedFrame<T> | null {
    return this.shown;
  }

  /** The frame waiting for its mask, if any. */
  get waiting(): SyncedFrame<T> | null {
    return this.pending;
  }

  /** Number of frames currently held, never more than two. */
  get held(): number {
    return (this.pending ? 1 : 0) + (this.shown ? 1 : 0);
  }

  /** Results that arrived for a frame that was no longer waiting. */
  get stale(): number {
    return this.staleCount;
  }

  /**
   * Holds `frame` as the one waiting for mask `sequence`. A frame that was
   * already waiting is released: its mask, if it ever arrives, is rejected.
   */
  capture(sequence: number, capturedAt: number, frame: T): void {
    this.drop(this.pending);
    this.pending = { frame, sequence, capturedAt };
  }

  /**
   * Called when the mask for `sequence` is ready. Returns the frame to show
   * with it, or `null` if that frame is no longer the one waiting (a reset,
   * or a newer capture, got there first).
   */
  resolve(sequence: number): SyncedFrame<T> | null {
    const pending = this.pending;
    if (!pending || pending.sequence !== sequence) {
      this.staleCount += 1;
      return null;
    }
    this.pending = null;
    this.drop(this.shown);
    this.shown = pending;
    return pending;
  }

  /** Releases the waiting frame, for example when its inference failed. */
  abandon(sequence: number): void {
    if (this.pending?.sequence !== sequence) return;
    this.drop(this.pending);
    this.pending = null;
  }

  /** Age of the frame on screen, which is also how late the subject is. */
  age(now: number): number | null {
    return this.shown ? Math.max(0, now - this.shown.capturedAt) : null;
  }

  /** Releases both frames, for example after a camera switch. */
  reset(): void {
    this.drop(this.pending);
    this.drop(this.shown);
    this.pending = null;
    this.shown = null;
  }

  private drop(entry: SyncedFrame<T> | null): void {
    if (entry) this.release(entry.frame);
  }
}
