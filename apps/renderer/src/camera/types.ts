import type { MaskShaping } from '../segmentation/mask.js';
import type { SegmentationQuality } from '../segmentation/types.js';

/**
 * `off` does no camera work at all. `raw` shows the camera as the device sends
 * it. `segmented` shows only the locally extracted subject, over the scene.
 */
export type CameraMode = 'off' | 'raw' | 'segmented';

/**
 * Acquisition state. This, not `mode`, is what drives the lifecycle: the hook
 * only calls `getUserMedia` while the status is `starting`, so a failure never
 * turns into a retry loop.
 */
export type CameraStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  /** The browser or the OS refused permission. */
  | 'denied'
  /** No camera matched, or the selected one has gone away. */
  | 'unavailable'
  /** The device exists but something else holds it open. */
  | 'busy'
  | 'failed';

export type SegmentationStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface CameraDevice {
  readonly deviceId: string;
  /** Empty until the user has granted permission at least once. */
  readonly label: string;
}

export interface Resolution {
  readonly width: number;
  readonly height: number;
}

export type FramingFit = 'cover' | 'contain';

export interface FramingState {
  readonly mirror: boolean;
  readonly fit: FramingFit;
  /** Multiplier on the fitted size. */
  readonly scale: number;
  /** Fraction of the stage width, -1 to 1. */
  readonly offsetX: number;
  /** Fraction of the stage height, -1 to 1. */
  readonly offsetY: number;
}

export interface CameraState {
  readonly mode: CameraMode;
  readonly status: CameraStatus;
  readonly devices: readonly CameraDevice[];
  /** False until `enumerateDevices` has answered once. */
  readonly devicesEnumerated: boolean;
  /** What the operator asked for; `null` means "whatever the browser picks". */
  readonly selectedDeviceId: string | null;
  /** What is actually open right now. */
  readonly activeDeviceId: string | null;
  readonly resolution: Resolution | null;
  readonly error: string | null;
  readonly framing: FramingState;
  readonly quality: SegmentationQuality;
  readonly shaping: MaskShaping;
  readonly segmentation: SegmentationStatus;
  readonly segmentationError: string | null;
}

export const SCALE_RANGE = { min: 0.25, max: 2.5 } as const;
export const OFFSET_RANGE = { min: -1, max: 1 } as const;
