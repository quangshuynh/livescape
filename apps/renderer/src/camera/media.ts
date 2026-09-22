import type { CameraDevice, CameraStatus, Resolution } from './types.js';

/** The subset of `navigator.mediaDevices` LiveScape uses, so tests can fake it. */
export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  addEventListener?: (type: 'devicechange', listener: () => void) => void;
  removeEventListener?: (type: 'devicechange', listener: () => void) => void;
}

export interface OpenCamera {
  readonly stream: MediaStream;
  /** The device the browser actually opened, from the track settings. */
  readonly deviceId: string | null;
  readonly resolution: Resolution;
}

export class CameraError extends Error {
  constructor(
    readonly status: Extract<CameraStatus, 'denied' | 'unavailable' | 'busy' | 'failed'>,
    message: string,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

export function getMediaDevices(): MediaDevicesLike | null {
  const devices = navigator.mediaDevices as MediaDevicesLike | undefined;
  return devices && typeof devices.getUserMedia === 'function' ? devices : null;
}

/**
 * Maps a `getUserMedia` rejection onto a state the setup panel can explain.
 *
 * `NotReadableError` is called out separately because it is the everyday
 * failure on a streaming machine: something else, very often an OBS Video
 * Capture Device source, already has the webcam open.
 */
export function classifyMediaError(error: unknown): CameraError {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return new CameraError(
        'denied',
        'Camera access was blocked. Allow it for this page, then start the camera again.',
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new CameraError(
        'unavailable',
        'No camera matched. Check that one is connected, then pick it from the list.',
      );
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraError(
        'busy',
        'The camera is open in another application. Close that one, then start the camera again.',
      );
    default:
      return new CameraError(
        'failed',
        error instanceof Error && error.message ? error.message : 'The camera could not be opened.',
      );
  }
}

export async function listCameras(devices: MediaDevicesLike): Promise<CameraDevice[]> {
  try {
    const all = await devices.enumerateDevices();
    return all
      .filter((device) => device.kind === 'videoinput')
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  } catch {
    // Enumeration is a convenience. Losing it must not stop the camera working.
    return [];
  }
}

export function cameraConstraints(deviceId: string | null): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  // LiveScape does no audio work at all, so it never asks for a microphone.
  return { video, audio: false };
}

export async function openCamera(
  devices: MediaDevicesLike,
  deviceId: string | null,
): Promise<OpenCamera> {
  let stream: MediaStream;
  try {
    stream = await devices.getUserMedia(cameraConstraints(deviceId));
  } catch (error) {
    throw classifyMediaError(error);
  }

  const track = stream.getVideoTracks()[0];
  if (!track) {
    stopStream(stream);
    throw new CameraError('unavailable', 'The camera opened without a video track.');
  }

  const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
  return {
    stream,
    deviceId: settings.deviceId ?? deviceId,
    resolution: { width: settings.width ?? 0, height: settings.height ?? 0 },
  };
}

/**
 * Stops every track on a stream.
 *
 * Dropping the reference is not enough: until the tracks are stopped the
 * device stays open and the camera light stays on.
 */
export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // A track that is already ended throws on some engines; nothing to do.
    }
  }
}
