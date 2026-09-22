import type { MediaDevicesLike } from '../camera/media.js';

/**
 * Stand-ins for the media APIs jsdom does not implement.
 *
 * Every camera test drives these, so CI needs no webcam and no permission
 * prompt, and failure modes that are awkward to reproduce on real hardware
 * (denied, busy, unplugged mid-stream) are just another fake.
 */
export class FakeMediaStreamTrack {
  readonly kind = 'video';
  stopped = false;
  private listeners: (() => void)[] = [];

  constructor(private readonly settings: MediaTrackSettings) {}

  getSettings(): MediaTrackSettings {
    return this.settings;
  }

  stop(): void {
    this.stopped = true;
  }

  addEventListener(_type: 'ended', listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Simulates the device being unplugged or taken over. */
  end(): void {
    this.stopped = true;
    for (const listener of this.listeners) listener();
  }
}

export class FakeMediaStream {
  constructor(readonly tracks: FakeMediaStreamTrack[]) {}

  getTracks(): FakeMediaStreamTrack[] {
    return this.tracks;
  }

  getVideoTracks(): FakeMediaStreamTrack[] {
    return this.tracks;
  }

  get allStopped(): boolean {
    return this.tracks.every((track) => track.stopped);
  }
}

export interface FakeDeviceSpec {
  readonly deviceId: string;
  readonly label: string;
  readonly width?: number;
  readonly height?: number;
}

export function mediaError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

export class FakeMediaDevices implements MediaDevicesLike {
  /** Every stream this fake has handed out, so leaks are easy to assert on. */
  readonly opened: FakeMediaStream[] = [];
  readonly requests: MediaStreamConstraints[] = [];
  enumerateCalls = 0;

  /** Set to make the next `getUserMedia` reject. */
  failWith: Error | null = null;
  /** When true, `enumerateDevices` reports empty labels, as before permission. */
  hideLabels = false;

  private listeners = new Map<string, (() => void)[]>();

  constructor(private devices: FakeDeviceSpec[] = []) {}

  setDevices(devices: FakeDeviceSpec[]): void {
    this.devices = devices;
  }

  async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    this.requests.push(constraints);
    if (this.failWith) throw this.failWith;

    const video = constraints.video;
    const requested =
      typeof video === 'object' && video !== null && typeof video.deviceId === 'object'
        ? (video.deviceId as ConstrainDOMStringParameters).exact
        : undefined;
    const wanted = typeof requested === 'string' ? requested : undefined;

    const spec = wanted
      ? this.devices.find((device) => device.deviceId === wanted)
      : this.devices[0];
    if (!spec) throw mediaError('NotFoundError');

    const stream = new FakeMediaStream([
      new FakeMediaStreamTrack({
        deviceId: spec.deviceId,
        width: spec.width ?? 1280,
        height: spec.height ?? 720,
      }),
    ]);
    this.opened.push(stream);
    return stream as unknown as MediaStream;
  }

  async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    this.enumerateCalls += 1;
    return this.devices.map(
      (device) =>
        ({
          deviceId: device.deviceId,
          kind: 'videoinput',
          label: this.hideLabels ? '' : device.label,
          groupId: '',
        }) as MediaDeviceInfo,
    );
  }

  addEventListener(type: 'devicechange', listener: () => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: 'devicechange', listener: () => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }

  emitDeviceChange(): void {
    for (const listener of this.listeners.get('devicechange') ?? []) listener();
  }

  /** True when no stream this fake handed out is still holding its tracks. */
  get allStreamsStopped(): boolean {
    return this.opened.every((stream) => stream.allStopped);
  }

  get liveStreams(): FakeMediaStream[] {
    return this.opened.filter((stream) => !stream.allStopped);
  }
}
