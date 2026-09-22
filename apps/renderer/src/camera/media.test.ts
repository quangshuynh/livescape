import { describe, expect, it } from 'vitest';

import { FakeMediaDevices, mediaError } from '../test/fakeMedia.js';
import type { FakeMediaStream } from '../test/fakeMedia.js';
import {
  CameraError,
  cameraConstraints,
  classifyMediaError,
  listCameras,
  openCamera,
  stopStream,
} from './media.js';

const DEVICES = [
  { deviceId: 'cam-a', label: 'Integrated Camera' },
  { deviceId: 'cam-b', label: 'USB Camera' },
];

describe('classifyMediaError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['NotFoundError', 'unavailable'],
    ['OverconstrainedError', 'unavailable'],
    ['DevicesNotFoundError', 'unavailable'],
    ['NotReadableError', 'busy'],
    ['TrackStartError', 'busy'],
    ['AbortError', 'busy'],
  ])('maps %s onto %s', (name, expected) => {
    expect(classifyMediaError(mediaError(name)).status).toBe(expected);
  });

  it('falls back to a generic failure for anything unrecognised', () => {
    const failure = classifyMediaError(new Error('something odd'));

    expect(failure.status).toBe('failed');
    expect(failure.message).toBe('something odd');
  });

  it('handles a rejection that is not an Error at all', () => {
    expect(classifyMediaError('nope').status).toBe('failed');
  });

  it('explains a busy device in terms an operator can act on', () => {
    // This is the everyday failure: an OBS Video Capture Device source already
    // holds the webcam.
    expect(classifyMediaError(mediaError('NotReadableError')).message).toContain(
      'another application',
    );
  });
});

describe('cameraConstraints', () => {
  it('never asks for a microphone', () => {
    expect(cameraConstraints(null).audio).toBe(false);
    expect(cameraConstraints('cam-a').audio).toBe(false);
  });

  it('leaves the device open when none is selected', () => {
    const video = cameraConstraints(null).video as MediaTrackConstraints;

    expect(video.deviceId).toBeUndefined();
  });

  it('pins an exact device once one is selected', () => {
    const video = cameraConstraints('cam-b').video as MediaTrackConstraints;

    expect(video.deviceId).toEqual({ exact: 'cam-b' });
  });
});

describe('listCameras', () => {
  it('returns only video inputs', async () => {
    const devices = new FakeMediaDevices(DEVICES);

    expect(await listCameras(devices)).toEqual([
      { deviceId: 'cam-a', label: 'Integrated Camera' },
      { deviceId: 'cam-b', label: 'USB Camera' },
    ]);
  });

  it('reports empty labels before permission has been granted', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    devices.hideLabels = true;

    expect((await listCameras(devices)).map((device) => device.label)).toEqual(['', '']);
  });

  it('treats an enumeration failure as an empty list rather than an error', async () => {
    const broken = {
      getUserMedia: () => Promise.reject(new Error('no')),
      enumerateDevices: () => Promise.reject(new Error('blocked')),
    };

    expect(await listCameras(broken)).toEqual([]);
  });
});

describe('openCamera', () => {
  it('reports the device and resolution the browser actually chose', async () => {
    const devices = new FakeMediaDevices([
      { deviceId: 'cam-a', label: 'Integrated Camera', width: 640, height: 480 },
    ]);

    const opened = await openCamera(devices, null);

    expect(opened.deviceId).toBe('cam-a');
    expect(opened.resolution).toEqual({ width: 640, height: 480 });
  });

  it('opens the requested device when one is selected', async () => {
    const devices = new FakeMediaDevices(DEVICES);

    expect((await openCamera(devices, 'cam-b')).deviceId).toBe('cam-b');
  });

  it('raises a classified error when permission is refused', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    devices.failWith = mediaError('NotAllowedError');

    await expect(openCamera(devices, null)).rejects.toMatchObject({
      name: 'CameraError',
      status: 'denied',
    });
  });

  it('raises unavailable when the selected device has gone', async () => {
    const devices = new FakeMediaDevices(DEVICES);

    await expect(openCamera(devices, 'cam-missing')).rejects.toBeInstanceOf(CameraError);
  });
});

describe('stopStream', () => {
  it('stops every track so the camera light goes out', () => {
    const devices = new FakeMediaDevices(DEVICES);

    return openCamera(devices, null).then((opened) => {
      stopStream(opened.stream);

      expect((opened.stream as unknown as FakeMediaStream).allStopped).toBe(true);
    });
  });

  it('does nothing when given no stream', () => {
    expect(() => stopStream(null)).not.toThrow();
  });

  it('survives a track that throws on stop', () => {
    const stream = {
      getTracks: () => [
        {
          stop() {
            throw new Error('already ended');
          },
        },
      ],
    } as unknown as MediaStream;

    expect(() => stopStream(stream)).not.toThrow();
  });
});
