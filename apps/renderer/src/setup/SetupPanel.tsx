import { useEffect, useId } from 'react';

import type { CameraController } from '../camera/useCamera.js';
import type { CameraMode, CameraState } from '../camera/types.js';
import type { CompositorStats } from '../compositor/stats.js';
import { QUALITY_ORDER, QUALITY_PRESETS } from '../segmentation/quality.js';

const MODES: readonly { readonly id: CameraMode; readonly label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'raw', label: 'Raw' },
  { id: 'segmented', label: 'Segmented' },
];

const STATUS_TEXT: Record<CameraState['status'], string> = {
  idle: 'Camera off',
  starting: 'Requesting the camera...',
  ready: 'Camera running',
  denied: 'Permission blocked',
  unavailable: 'No camera available',
  busy: 'Camera in use elsewhere',
  failed: 'Camera failed',
};

const SEGMENTATION_TEXT: Record<CameraState['segmentation'], string> = {
  idle: 'not running',
  loading: 'loading model...',
  ready: 'running',
  failed: 'failed',
};

function round(value: number, places = 0): string {
  return value.toFixed(places);
}

interface SliderProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly display: string;
  readonly onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, display, onChange }: SliderProps) {
  const id = useId();
  return (
    <div className="setup__slider">
      <label htmlFor={id}>
        {label}
        <span className="setup__value">{display}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export interface SetupPanelProps {
  readonly camera: CameraController;
  readonly stats: CompositorStats;
  readonly connection: string;
  readonly sceneId: string;
  readonly effects: readonly string[];
}

/**
 * Local configuration surface, mounted only for `?setup=1`.
 *
 * It drives the camera in this tab and nothing else: no camera data, and no
 * camera state, is sent to the event server or the control panel.
 */
export function SetupPanel({ camera, stats, connection, sceneId, effects }: SetupPanelProps) {
  const { state, refreshDevices } = camera;
  const deviceSelectId = useId();
  const qualityId = useId();

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const running = state.status === 'ready';
  const { segmentation: segmentationStats } = stats;

  return (
    <aside className="setup" aria-label="LiveScape camera setup">
      <header className="setup__header">
        <h1 className="setup__title">Camera setup</h1>
        <p className={`setup__status setup__status--${state.status}`}>{STATUS_TEXT[state.status]}</p>
      </header>

      <section className="setup__section">
        <h2 className="setup__heading">Mode</h2>
        <div className="setup__modes" role="group" aria-label="Camera mode">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className="setup__mode"
              aria-pressed={state.mode === mode.id}
              onClick={() => camera.setMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        {state.mode === 'off' ? (
          <p className="setup__hint">
            The camera is never opened until you ask for it, including after a reload.
          </p>
        ) : null}
        {state.error ? (
          <p className="setup__error" role="status">
            {state.error}{' '}
            <button type="button" className="setup__link" onClick={() => camera.retry()}>
              Try again
            </button>
          </p>
        ) : null}
        {state.mode === 'segmented' ? (
          <p className="setup__hint">
            Segmentation: {SEGMENTATION_TEXT[state.segmentation]}
            {state.segmentationError ? ` - ${state.segmentationError}` : ''}
            {state.segmentation === 'failed'
              ? ' Switch to Raw if you want the camera on screen without background removal.'
              : ''}
          </p>
        ) : null}
      </section>

      <section className="setup__section">
        <h2 className="setup__heading">Device</h2>
        <label className="setup__field" htmlFor={deviceSelectId}>
          Camera
        </label>
        <select
          id={deviceSelectId}
          value={state.selectedDeviceId ?? ''}
          onChange={(event) => camera.selectDevice(event.target.value || null)}
        >
          <option value="">Default camera</option>
          {state.devices.map((device, index) => (
            <option key={device.deviceId || index} value={device.deviceId}>
              {device.label || `Camera ${index + 1}`}
            </option>
          ))}
        </select>
        <button type="button" className="setup__link" onClick={() => void refreshDevices()}>
          Refresh list
        </button>
        {state.devicesEnumerated && state.devices.length === 0 ? (
          <p className="setup__hint">No cameras were found on this machine.</p>
        ) : null}
        {state.devices.some((device) => device.label === '') ? (
          <p className="setup__hint">
            Device names appear once the camera has been allowed at least once.
          </p>
        ) : null}
      </section>

      <section className="setup__section">
        <h2 className="setup__heading">Framing</h2>
        <div className="setup__toggles">
          <button
            type="button"
            className="setup__mode"
            aria-pressed={state.framing.mirror}
            onClick={() => camera.setFraming({ mirror: !state.framing.mirror })}
          >
            Mirror
          </button>
          <button
            type="button"
            className="setup__mode"
            aria-pressed={state.framing.fit === 'cover'}
            onClick={() =>
              camera.setFraming({ fit: state.framing.fit === 'cover' ? 'contain' : 'cover' })
            }
          >
            Cover
          </button>
        </div>
        <Slider
          label="Subject scale"
          value={state.framing.scale}
          min={0.25}
          max={2.5}
          step={0.01}
          display={`${round(state.framing.scale * 100)}%`}
          onChange={(scale) => camera.setFraming({ scale })}
        />
        <Slider
          label="Horizontal position"
          value={state.framing.offsetX}
          min={-1}
          max={1}
          step={0.01}
          display={round(state.framing.offsetX * 100)}
          onChange={(offsetX) => camera.setFraming({ offsetX })}
        />
        <Slider
          label="Vertical position"
          value={state.framing.offsetY}
          min={-1}
          max={1}
          step={0.01}
          display={round(state.framing.offsetY * 100)}
          onChange={(offsetY) => camera.setFraming({ offsetY })}
        />
        <button type="button" className="setup__link" onClick={() => camera.resetFraming()}>
          Reset framing
        </button>
      </section>

      <section className="setup__section">
        <h2 className="setup__heading">Segmentation</h2>
        <label className="setup__field" htmlFor={qualityId}>
          Quality
        </label>
        <select
          id={qualityId}
          value={state.quality}
          onChange={(event) =>
            camera.setQuality(event.target.value as CameraState['quality'])
          }
        >
          {QUALITY_ORDER.map((id) => (
            <option key={id} value={id}>
              {QUALITY_PRESETS[id].label}
            </option>
          ))}
        </select>
        <Slider
          label="Edge threshold"
          value={state.shaping.threshold}
          min={0.05}
          max={0.95}
          step={0.01}
          display={round(state.shaping.threshold, 2)}
          onChange={(threshold) => camera.setShaping({ threshold })}
        />
        <Slider
          label="Edge softness"
          value={state.shaping.softness}
          min={0}
          max={0.45}
          step={0.01}
          display={round(state.shaping.softness, 2)}
          onChange={(softness) => camera.setShaping({ softness })}
        />
        <Slider
          label="Edge feather"
          value={state.shaping.featherPx}
          min={0}
          max={12}
          step={0.5}
          display={`${round(state.shaping.featherPx, 1)} px`}
          onChange={(featherPx) => camera.setShaping({ featherPx })}
        />
        <Slider
          label="Temporal smoothing"
          value={state.shaping.smoothing}
          min={0}
          max={0.9}
          step={0.01}
          display={round(state.shaping.smoothing, 2)}
          onChange={(smoothing) => camera.setShaping({ smoothing })}
        />
        <p className="setup__hint">
          Smoothing steadies the edge but trails behind a moving arm. Keep it low unless the
          mask flickers.
        </p>
      </section>

      <section className="setup__section">
        <h2 className="setup__heading">Diagnostics</h2>
        <dl className="setup__stats">
          <dt>Camera</dt>
          <dd>
            {state.resolution && state.resolution.width > 0
              ? `${state.resolution.width}x${state.resolution.height}`
              : '-'}
          </dd>
          <dt>Render</dt>
          <dd>{running ? `${round(stats.renderFps)} FPS` : '-'}</dd>
          <dt>Segmentation input</dt>
          <dd>
            {stats.segmentationInput
              ? `${stats.segmentationInput.width}x${stats.segmentationInput.height}`
              : '-'}
          </dd>
          <dt>Backend</dt>
          <dd>{stats.segmentationBackend ?? '-'}</dd>
          <dt>Segmentation</dt>
          <dd>{round(segmentationStats.segmentationFps)} FPS</dd>
          <dt>Inference</dt>
          <dd>{round(segmentationStats.inferenceMs, 1)} ms</dd>
          <dt>Masks</dt>
          <dd>{segmentationStats.completed}</dd>
          <dt>Skipped</dt>
          <dd>{segmentationStats.skipped}</dd>
          <dt>Throttled</dt>
          <dd>{segmentationStats.throttled}</dd>
          <dt>Errors</dt>
          <dd>{segmentationStats.errors}</dd>
          <dt>Server</dt>
          <dd>{connection}</dd>
          <dt>Scene</dt>
          <dd>{sceneId}</dd>
          <dt>Effects</dt>
          <dd>{effects.length > 0 ? effects.join(', ') : 'none'}</dd>
        </dl>
        <p className="setup__hint">
          Camera frames stay in this tab. They are never sent to the event server, the control
          panel or any network service.
        </p>
      </section>
    </aside>
  );
}
