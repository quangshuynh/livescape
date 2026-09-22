import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FakeMediaDevices, mediaError } from '../test/fakeMedia.js';
import { useCamera } from './useCamera.js';

const DEVICES = [
  { deviceId: 'cam-a', label: 'Integrated Camera' },
  { deviceId: 'cam-b', label: 'USB Camera', width: 640, height: 480 },
];

function mount(devices: FakeMediaDevices | null) {
  return renderHook(() => useCamera(devices));
}

afterEach(cleanup);

describe('useCamera lifecycle', () => {
  it('touches no media API until the camera is explicitly started', () => {
    const devices = new FakeMediaDevices(DEVICES);

    mount(devices);

    expect(devices.requests).toHaveLength(0);
    expect(devices.opened).toHaveLength(0);
  });

  it('acquires a stream when a mode is chosen', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    const { result } = mount(devices);

    act(() => result.current.setMode('raw'));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(result.current.stream).not.toBeNull();
    expect(result.current.state.resolution).toEqual({ width: 1280, height: 720 });
    expect(devices.liveStreams).toHaveLength(1);
  });

  it('rebuilds the device list once permission has produced labels', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    const { result } = mount(devices);

    act(() => result.current.setMode('raw'));

    await waitFor(() => expect(result.current.state.devices).toHaveLength(2));
    expect(result.current.state.devices[0]?.label).toBe('Integrated Camera');
  });

  it('enumerates devices on request without opening one', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    const { result } = mount(devices);

    await act(async () => {
      await result.current.refreshDevices();
    });

    expect(result.current.state.devicesEnumerated).toBe(true);
    expect(devices.opened).toHaveLength(0);
  });

  it('surfaces a denied permission and stops trying', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    devices.failWith = mediaError('NotAllowedError');
    const { result } = mount(devices);

    act(() => result.current.setMode('raw'));

    await waitFor(() => expect(result.current.state.status).toBe('denied'));
    expect(result.current.stream).toBeNull();
    const attempts = devices.requests.length;

    // No retry loop: the status only moves again when someone asks.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(devices.requests).toHaveLength(attempts);
  });

  it('surfaces an unavailable device', async () => {
    const devices = new FakeMediaDevices([]);
    const { result } = mount(devices);

    act(() => result.current.setMode('raw'));

    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
  });

  it('reports a busy device distinctly from a denied one', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    devices.failWith = mediaError('NotReadableError');
    const { result } = mount(devices);

    act(() => result.current.setMode('raw'));

    await waitFor(() => expect(result.current.state.status).toBe('busy'));
  });

  it('retries after a failure when asked', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    devices.failWith = mediaError('NotAllowedError');
    const { result } = mount(devices);

    act(() => result.current.setMode('raw'));
    await waitFor(() => expect(result.current.state.status).toBe('denied'));

    devices.failWith = null;
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
  });

  it('reports failure when the browser exposes no camera API', async () => {
    const { result } = mount(null);

    act(() => result.current.setMode('raw'));

    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
  });

  it('stops the old stream when switching devices', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    const { result } = mount(devices);

    act(() => result.current.setMode('raw'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    const first = devices.opened[0];

    act(() => result.current.selectDevice('cam-b'));
    await waitFor(() => expect(result.current.state.activeDeviceId).toBe('cam-b'));

    expect(first?.allStopped).toBe(true);
    expect(devices.liveStreams).toHaveLength(1);
    expect(result.current.state.resolution).toEqual({ width: 640, height: 480 });
  });

  it('keeps one stream when flipping between raw and segmented', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    const { result } = mount(devices);

    act(() => result.current.setMode('raw'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    const opened = devices.opened.length;

    act(() => result.current.setMode('segmented'));
    await waitFor(() => expect(result.current.state.mode).toBe('segmented'));

    expect(devices.opened).toHaveLength(opened);
    expect(devices.liveStreams).toHaveLength(1);
  });

  it('stops every track when the camera is turned off', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    const { result } = mount(devices);

    act(() => result.current.setMode('raw'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    act(() => result.current.setMode('off'));

    await waitFor(() => expect(result.current.stream).toBeNull());
    expect(devices.allStreamsStopped).toBe(true);
  });

  it('releases the camera on unmount', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    const { result, unmount } = mount(devices);

    act(() => result.current.setMode('raw'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    unmount();

    expect(devices.allStreamsStopped).toBe(true);
  });

  it('notices a device that disappears mid-stream', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    const { result } = mount(devices);

    act(() => result.current.setMode('raw'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    act(() => devices.opened[0]?.tracks[0]?.end());

    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
  });

  it('refreshes the device list when the OS reports a change', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    const { result } = mount(devices);

    devices.setDevices([{ deviceId: 'cam-c', label: 'New Camera' }]);
    await act(async () => {
      devices.emitDeviceChange();
    });

    await waitFor(() => expect(result.current.state.devices).toHaveLength(1));
    expect(result.current.state.devices[0]?.deviceId).toBe('cam-c');
  });

  it('does not leave a stream open when the camera is stopped mid-acquisition', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    const { result } = mount(devices);

    act(() => {
      result.current.setMode('raw');
      result.current.setMode('off');
    });

    await waitFor(() => expect(devices.allStreamsStopped).toBe(true));
    expect(result.current.stream).toBeNull();
  });
});
