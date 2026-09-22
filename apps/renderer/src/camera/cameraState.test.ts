import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FRAMING,
  cameraReducer,
  initialCameraState,
  shouldDrawCamera,
  wantsStream,
} from './cameraState.js';
import type { CameraAction } from './cameraState.js';
import type { CameraState } from './types.js';

function fold(state: CameraState, ...actions: CameraAction[]): CameraState {
  return actions.reduce(cameraReducer, state);
}

const READY: CameraAction = {
  type: 'stream/ready',
  deviceId: 'cam-a',
  resolution: { width: 1280, height: 720 },
};

describe('camera state', () => {
  it('starts off, with no camera and no error', () => {
    expect(initialCameraState.mode).toBe('off');
    expect(initialCameraState.status).toBe('idle');
    expect(initialCameraState.activeDeviceId).toBeNull();
    expect(wantsStream(initialCameraState)).toBe(false);
  });

  it('only asks for a stream after an explicit mode change', () => {
    const state = fold(initialCameraState, { type: 'mode/set', mode: 'raw' });

    expect(state.status).toBe('starting');
    expect(wantsStream(state)).toBe(true);
  });

  it('records the resolution the device actually delivered', () => {
    const state = fold(initialCameraState, { type: 'mode/set', mode: 'raw' }, READY);

    expect(state.status).toBe('ready');
    expect(state.activeDeviceId).toBe('cam-a');
    expect(state.resolution).toEqual({ width: 1280, height: 720 });
  });

  it('keeps the same stream when switching between raw and segmented', () => {
    const ready = fold(initialCameraState, { type: 'mode/set', mode: 'raw' }, READY);

    const segmented = cameraReducer(ready, { type: 'mode/set', mode: 'segmented' });

    expect(segmented.mode).toBe('segmented');
    expect(segmented.status).toBe('ready');
    expect(segmented.activeDeviceId).toBe('cam-a');
  });

  it('re-acquires when the mode changes while the camera is not yet ready', () => {
    const starting = fold(initialCameraState, { type: 'mode/set', mode: 'raw' });

    const segmented = cameraReducer(starting, { type: 'mode/set', mode: 'segmented' });

    expect(segmented.status).toBe('starting');
  });

  it('drops back to idle and forgets the device when turned off', () => {
    const ready = fold(initialCameraState, { type: 'mode/set', mode: 'segmented' }, READY, {
      type: 'segmentation/status',
      status: 'ready',
    });

    const off = cameraReducer(ready, { type: 'mode/set', mode: 'off' });

    expect(off).toMatchObject({
      mode: 'off',
      status: 'idle',
      activeDeviceId: null,
      resolution: null,
      segmentation: 'idle',
      error: null,
    });
    expect(wantsStream(off)).toBe(false);
  });

  it.each([
    ['denied' as const, 'Camera access was blocked.'],
    ['unavailable' as const, 'No camera matched.'],
    ['busy' as const, 'Something else has it.'],
    ['failed' as const, 'Unknown failure.'],
  ])('surfaces a %s failure and stops asking', (status, message) => {
    const state = fold(initialCameraState, { type: 'mode/set', mode: 'raw' }, {
      type: 'stream/failed',
      status,
      message,
    });

    expect(state.status).toBe(status);
    expect(state.error).toBe(message);
    // The mode stays where the operator left it, but nothing retries on its own.
    expect(state.mode).toBe('raw');
    expect(wantsStream(state)).toBe(false);
  });

  it('retries the current device on request', () => {
    const denied = fold(initialCameraState, { type: 'mode/set', mode: 'raw' }, {
      type: 'stream/failed',
      status: 'denied',
      message: 'blocked',
    });

    const retrying = cameraReducer(denied, { type: 'stream/retry' });

    expect(retrying.status).toBe('starting');
    expect(retrying.error).toBeNull();
  });

  it('does not retry while the camera is off', () => {
    expect(cameraReducer(initialCameraState, { type: 'stream/retry' })).toBe(initialCameraState);
  });

  it('records enumerated devices', () => {
    const state = cameraReducer(initialCameraState, {
      type: 'devices/loaded',
      devices: [{ deviceId: 'cam-a', label: 'Front' }],
    });

    expect(state.devicesEnumerated).toBe(true);
    expect(state.devices).toHaveLength(1);
  });

  it('re-acquires when a different device is selected', () => {
    const ready = fold(initialCameraState, { type: 'mode/set', mode: 'raw' }, READY);

    const switched = cameraReducer(ready, { type: 'device/select', deviceId: 'cam-b' });

    expect(switched.selectedDeviceId).toBe('cam-b');
    expect(switched.status).toBe('starting');
    expect(switched.activeDeviceId).toBeNull();
  });

  it('ignores selecting the device that is already selected', () => {
    const ready = fold(initialCameraState, { type: 'mode/set', mode: 'raw' }, READY, {
      type: 'device/select',
      deviceId: 'cam-b',
    });

    expect(cameraReducer(ready, { type: 'device/select', deviceId: 'cam-b' })).toBe(ready);
  });

  it('does not start the camera when a device is picked while off', () => {
    const state = cameraReducer(initialCameraState, { type: 'device/select', deviceId: 'cam-b' });

    expect(state.status).toBe('idle');
    expect(wantsStream(state)).toBe(false);
  });

  it('reports a device that goes away mid-stream', () => {
    const ready = fold(initialCameraState, { type: 'mode/set', mode: 'raw' }, READY);

    const lost = cameraReducer(ready, { type: 'stream/lost' });

    expect(lost.status).toBe('unavailable');
    expect(lost.activeDeviceId).toBeNull();
    expect(lost.error).not.toBeNull();
  });

  it('clamps framing to usable bounds', () => {
    const state = cameraReducer(initialCameraState, {
      type: 'framing/set',
      patch: { scale: 99, offsetX: -12, offsetY: 7 },
    });

    expect(state.framing.scale).toBe(2.5);
    expect(state.framing.offsetX).toBe(-1);
    expect(state.framing.offsetY).toBe(1);
  });

  it('restores the default framing', () => {
    const moved = cameraReducer(initialCameraState, {
      type: 'framing/set',
      patch: { scale: 2, mirror: false, fit: 'contain' },
    });

    expect(cameraReducer(moved, { type: 'framing/reset' }).framing).toEqual(DEFAULT_FRAMING);
  });

  it('clamps mask shaping to usable bounds', () => {
    const state = cameraReducer(initialCameraState, {
      type: 'shaping/set',
      patch: { threshold: 5, softness: -1, smoothing: 4, featherPx: 900 },
    });

    expect(state.shaping).toEqual({
      threshold: 0.95,
      softness: 0,
      smoothing: 0.9,
      featherPx: 12,
      refineEdges: true,
    });
  });

  it('records a segmentation failure without touching the camera', () => {
    const ready = fold(initialCameraState, { type: 'mode/set', mode: 'segmented' }, READY, {
      type: 'segmentation/status',
      status: 'failed',
      error: 'no WebGL',
    });

    expect(ready.status).toBe('ready');
    expect(ready.segmentation).toBe('failed');
    expect(ready.segmentationError).toBe('no WebGL');
  });
});

describe('shouldDrawCamera', () => {
  const ready = fold(initialCameraState, { type: 'mode/set', mode: 'raw' }, READY);

  it('draws nothing while the camera is off', () => {
    expect(shouldDrawCamera(initialCameraState, true)).toBe(false);
  });

  it('draws nothing until the stream is ready', () => {
    const starting = cameraReducer(initialCameraState, { type: 'mode/set', mode: 'raw' });

    expect(shouldDrawCamera(starting, false)).toBe(false);
  });

  it('draws the raw feed with no mask', () => {
    expect(shouldDrawCamera(ready, false)).toBe(true);
  });

  it('withholds the frame in segmented mode until a mask exists', () => {
    const segmented = cameraReducer(ready, { type: 'mode/set', mode: 'segmented' });

    // Falling back to the raw feed here would broadcast the physical
    // background at exactly the moment it was asked to be removed.
    expect(shouldDrawCamera(segmented, false)).toBe(false);
    expect(shouldDrawCamera(segmented, true)).toBe(true);
  });
});
