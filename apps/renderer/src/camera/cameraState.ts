import { DEFAULT_MASK_SHAPING, clamp, type MaskShaping } from '../segmentation/mask.js';
import { DEFAULT_QUALITY } from '../segmentation/quality.js';
import type { SegmentationQuality } from '../segmentation/types.js';
import {
  OFFSET_RANGE,
  SCALE_RANGE,
  type CameraDevice,
  type CameraMode,
  type CameraState,
  type CameraStatus,
  type FramingState,
  type Resolution,
  type SegmentationStatus,
} from './types.js';

export const DEFAULT_FRAMING: FramingState = {
  mirror: true,
  fit: 'cover',
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

/**
 * The camera starts off and stays off until someone asks for it. Reloading the
 * renderer therefore never reopens the camera on its own, which is what an OBS
 * source refresh must not do.
 */
export const initialCameraState: CameraState = {
  mode: 'off',
  status: 'idle',
  devices: [],
  devicesEnumerated: false,
  selectedDeviceId: null,
  activeDeviceId: null,
  resolution: null,
  error: null,
  framing: DEFAULT_FRAMING,
  quality: DEFAULT_QUALITY,
  shaping: DEFAULT_MASK_SHAPING,
  segmentation: 'idle',
  segmentationError: null,
};

export type CameraAction =
  | { readonly type: 'mode/set'; readonly mode: CameraMode }
  | { readonly type: 'devices/loaded'; readonly devices: readonly CameraDevice[] }
  | { readonly type: 'device/select'; readonly deviceId: string | null }
  | { readonly type: 'stream/retry' }
  | {
      readonly type: 'stream/ready';
      readonly deviceId: string | null;
      readonly resolution: Resolution;
    }
  | { readonly type: 'stream/failed'; readonly status: CameraStatus; readonly message: string }
  | { readonly type: 'stream/lost' }
  | { readonly type: 'framing/set'; readonly patch: Partial<FramingState> }
  | { readonly type: 'framing/reset' }
  | { readonly type: 'quality/set'; readonly quality: SegmentationQuality }
  | { readonly type: 'shaping/set'; readonly patch: Partial<MaskShaping> }
  | {
      readonly type: 'segmentation/status';
      readonly status: SegmentationStatus;
      readonly error?: string;
    };

function normalizeFraming(framing: FramingState, patch: Partial<FramingState>): FramingState {
  const merged = { ...framing, ...patch };
  return {
    ...merged,
    scale: clamp(merged.scale, SCALE_RANGE.min, SCALE_RANGE.max),
    offsetX: clamp(merged.offsetX, OFFSET_RANGE.min, OFFSET_RANGE.max),
    offsetY: clamp(merged.offsetY, OFFSET_RANGE.min, OFFSET_RANGE.max),
  };
}

function normalizeShaping(shaping: MaskShaping, patch: Partial<MaskShaping>): MaskShaping {
  const merged = { ...shaping, ...patch };
  return {
    threshold: clamp(merged.threshold, 0.05, 0.95),
    softness: clamp(merged.softness, 0, 0.45),
    smoothing: clamp(merged.smoothing, 0, 0.9),
    featherPx: clamp(merged.featherPx, 0, 12),
  };
}

/** State the renderer drops whenever the camera stops being open. */
const CLOSED = {
  activeDeviceId: null,
  resolution: null,
  segmentation: 'idle',
  segmentationError: null,
} as const satisfies Partial<CameraState>;

/**
 * Pure fold of camera intent onto camera state.
 *
 * It owns no MediaStream and touches no browser API, so every lifecycle rule
 * here is testable without a camera: that is the point of splitting it out.
 */
export function cameraReducer(state: CameraState, action: CameraAction): CameraState {
  switch (action.type) {
    case 'mode/set': {
      if (action.mode === state.mode) return state;
      if (action.mode === 'off') {
        return { ...state, ...CLOSED, mode: 'off', status: 'idle', error: null };
      }
      // Raw and Segmented share one stream, so flipping between them while the
      // camera is open must not re-acquire it.
      const reuseStream = state.mode !== 'off' && state.status === 'ready';
      return {
        ...state,
        mode: action.mode,
        status: reuseStream ? 'ready' : 'starting',
        error: reuseStream ? state.error : null,
      };
    }

    case 'devices/loaded':
      return { ...state, devices: action.devices, devicesEnumerated: true };

    case 'device/select': {
      if (action.deviceId === state.selectedDeviceId) return state;
      return {
        ...state,
        ...CLOSED,
        selectedDeviceId: action.deviceId,
        status: state.mode === 'off' ? state.status : 'starting',
        error: null,
      };
    }

    case 'stream/retry':
      if (state.mode === 'off') return state;
      return { ...state, ...CLOSED, status: 'starting', error: null };

    case 'stream/ready':
      return {
        ...state,
        status: 'ready',
        activeDeviceId: action.deviceId,
        resolution: action.resolution,
        error: null,
      };

    case 'stream/failed':
      return { ...state, ...CLOSED, status: action.status, error: action.message };

    case 'stream/lost':
      if (state.mode === 'off') return state;
      return {
        ...state,
        ...CLOSED,
        status: 'unavailable',
        error: 'The camera stopped sending video.',
      };

    case 'framing/set':
      return { ...state, framing: normalizeFraming(state.framing, action.patch) };

    case 'framing/reset':
      return { ...state, framing: DEFAULT_FRAMING };

    case 'quality/set':
      return state.quality === action.quality ? state : { ...state, quality: action.quality };

    case 'shaping/set':
      return { ...state, shaping: normalizeShaping(state.shaping, action.patch) };

    case 'segmentation/status':
      return {
        ...state,
        segmentation: action.status,
        segmentationError: action.error ?? null,
      };

    default:
      return state;
  }
}

/** True while the hook should hold a MediaStream open. */
export function wantsStream(state: CameraState): boolean {
  return state.mode !== 'off' && (state.status === 'starting' || state.status === 'ready');
}

/**
 * True when the compositor should draw the camera.
 *
 * Segmented mode deliberately draws nothing until a mask exists. Falling back
 * to the raw feed would put the operator's real room on stream at exactly the
 * moment they asked for it to be removed.
 */
export function shouldDrawCamera(state: CameraState, hasMask: boolean): boolean {
  if (state.mode === 'off' || state.status !== 'ready') return false;
  return state.mode === 'raw' ? true : hasMask;
}
