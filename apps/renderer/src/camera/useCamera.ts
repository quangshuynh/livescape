import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import type { MaskShaping } from '../segmentation/mask.js';
import type { SegmentationQuality } from '../segmentation/types.js';
import { cameraReducer, initialCameraState } from './cameraState.js';
import {
  CameraError,
  classifyMediaError,
  getMediaDevices,
  listCameras,
  openCamera,
  stopStream,
  type MediaDevicesLike,
} from './media.js';
import type { CameraMode, CameraState, FramingState, SegmentationStatus } from './types.js';

export interface CameraController {
  readonly state: CameraState;
  /** The live stream, or `null` whenever the camera is not open. */
  readonly stream: MediaStream | null;
  setMode(mode: CameraMode): void;
  selectDevice(deviceId: string | null): void;
  /** Tries the current device again after a failure. */
  retry(): void;
  refreshDevices(): Promise<void>;
  setFraming(patch: Partial<FramingState>): void;
  resetFraming(): void;
  setQuality(quality: SegmentationQuality): void;
  setShaping(patch: Partial<MaskShaping>): void;
  reportSegmentation(status: SegmentationStatus, error?: string): void;
}

/**
 * Owns the camera for the renderer: one MediaStream, acquired only on an
 * explicit request and released on every path out, including a device switch,
 * a failure and unmount.
 */
export function useCamera(mediaDevices?: MediaDevicesLike | null): CameraController {
  const [state, dispatch] = useReducer(cameraReducer, initialCameraState);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const devices = useMemo(
    () => (mediaDevices === undefined ? getMediaDevices() : mediaDevices),
    [mediaDevices],
  );

  const releaseStream = useCallback(() => {
    if (!streamRef.current) return;
    stopStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!devices) return;
    dispatch({ type: 'devices/loaded', devices: await listCameras(devices) });
  }, [devices]);

  useEffect(() => {
    if (state.status === 'ready') return;
    if (state.status !== 'starting') {
      releaseStream();
      return;
    }

    if (!devices) {
      dispatch({
        type: 'stream/failed',
        status: 'unavailable',
        message: 'This browser exposes no camera API.',
      });
      return;
    }

    // Whatever is open belongs to the previous request. Let it go before asking
    // for another device, or two streams end up live at once.
    releaseStream();

    let cancelled = false;
    void (async () => {
      try {
        const opened = await openCamera(devices, state.selectedDeviceId);
        if (cancelled) {
          stopStream(opened.stream);
          return;
        }

        streamRef.current = opened.stream;
        setStream(opened.stream);
        dispatch({
          type: 'stream/ready',
          deviceId: opened.deviceId,
          resolution: opened.resolution,
        });

        const track = opened.stream.getVideoTracks()[0];
        track?.addEventListener('ended', () => {
          if (streamRef.current === opened.stream) dispatch({ type: 'stream/lost' });
        });

        // Labels only exist once permission has been granted, so the list is
        // worth rebuilding as soon as a camera has actually opened.
        void listCameras(devices).then((found) => {
          if (!cancelled) dispatch({ type: 'devices/loaded', devices: found });
        });
      } catch (error) {
        if (cancelled) return;
        const failure = error instanceof CameraError ? error : classifyMediaError(error);
        dispatch({ type: 'stream/failed', status: failure.status, message: failure.message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.status, state.selectedDeviceId, devices, releaseStream]);

  useEffect(() => {
    const target = devices;
    if (!target?.addEventListener || !target.removeEventListener) return;
    const onChange = () => void refreshDevices();
    target.addEventListener('devicechange', onChange);
    return () => target.removeEventListener?.('devicechange', onChange);
  }, [devices, refreshDevices]);

  // Unmounting the renderer must not leave the camera light on.
  useEffect(() => () => releaseStream(), [releaseStream]);

  return useMemo<CameraController>(
    () => ({
      state,
      stream,
      setMode: (mode) => dispatch({ type: 'mode/set', mode }),
      selectDevice: (deviceId) => dispatch({ type: 'device/select', deviceId }),
      retry: () => dispatch({ type: 'stream/retry' }),
      refreshDevices,
      setFraming: (patch) => dispatch({ type: 'framing/set', patch }),
      resetFraming: () => dispatch({ type: 'framing/reset' }),
      setQuality: (quality) => dispatch({ type: 'quality/set', quality }),
      setShaping: (patch) => dispatch({ type: 'shaping/set', patch }),
      reportSegmentation: (status, error) =>
        dispatch(
          error === undefined
            ? { type: 'segmentation/status', status }
            : { type: 'segmentation/status', status, error },
        ),
    }),
    [state, stream, refreshDevices],
  );
}
