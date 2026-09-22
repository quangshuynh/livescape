import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  REGISTRY,
  effectClearRequest,
  effectTriggerRequest,
  sceneChangeRequest,
  type EffectId,
  type EventRequest,
  type SceneId,
} from '@livescape/protocol';

import {
  EventServerError,
  resolveApiUrl,
  resolveWsUrl,
  sendEvent,
  type Health,
} from './api.js';
import {
  SIMULATED_ACTIONS,
  simulatedActionRequest,
  simulatedActionUsesQuantity,
  type SimulatedActionId,
} from './simulation.js';
import { useEventFeed } from './useEventFeed.js';
import { useServerHealth } from './useServerHealth.js';


export function App() {
  const apiUrl = useMemo(() => resolveApiUrl(), []);
  const wsUrl = useMemo(() => resolveWsUrl(), []);
  const feed = useEventFeed(wsUrl);

  const { health, refresh: refreshHealth } = useServerHealth(apiUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const send = useCallback(
    async (request: EventRequest) => {
      setPending(true);
      try {
        await sendEvent(apiUrl, request);
        setError(null);
        refreshHealth();
      } catch (caught) {
        setError(
          caught instanceof EventServerError
            ? caught.message
            : 'unexpected error talking to the event server',
        );
      } finally {
        setPending(false);
      }
    },
    [apiUrl, refreshHealth],
  );

  const serverOnline = health !== null;
  const activeEffects = health?.activeEffects ?? [];

  return (
    <div className="panel">
      <header className="panel__header">
        <div>
          <h1 className="panel__title">LiveScape Control Panel</h1>
          <p className="panel__subtitle">Local development controls for the scene renderer.</p>
        </div>
        <ConnectionBadge online={serverOnline} feedStatus={feed.status} health={health} />
      </header>

      {error ? (
        <p className="panel__error" role="alert">
          {error}
        </p>
      ) : null}

      <main className="panel__grid">
        <Card title="Scene" description="Switch the environment shown by the renderer.">
          <div className="button-row">
            {REGISTRY.scenes.map((scene) => (
              <button
                key={scene.id}
                type="button"
                className="control-button"
                aria-pressed={health?.currentScene === scene.id}
                disabled={pending}
                title={scene.description}
                onClick={() => void send(sceneChangeRequest(scene.id as SceneId))}
              >
                {scene.label}
              </button>
            ))}
          </div>
        </Card>

        <Card title="Effects" description="Trigger or clear a real-time overlay effect.">
          <div className="button-row">
            {REGISTRY.effects.map((effect) => (
              <button
                key={effect.id}
                type="button"
                className="control-button"
                aria-pressed={activeEffects.includes(effect.id)}
                disabled={pending}
                title={effect.description}
                onClick={() => void send(effectTriggerRequest(effect.id as EffectId))}
              >
                {effect.label}
              </button>
            ))}
            <button
              type="button"
              className="control-button control-button--ghost"
              disabled={pending}
              onClick={() => void send(effectClearRequest())}
            >
              Clear effects
            </button>
          </div>
        </Card>

        <SimulationCard pending={pending} onSend={send} />

        <Card title="Activity" description="Normalized events the event server broadcast.">
          <ActivityLog entries={feed.entries} />
        </Card>
      </main>

      <footer className="panel__footer">
        <span>event server: {apiUrl}</span>
        <span>socket: {wsUrl}</span>
      </footer>
    </div>
  );
}

interface ConnectionBadgeProps {
  readonly online: boolean;
  readonly feedStatus: string;
  readonly health: Health | null;
}

function ConnectionBadge({ online, feedStatus, health }: ConnectionBadgeProps) {
  const state = online ? 'online' : 'offline';
  return (
    <div className={`status status--${state}`} role="status" aria-live="polite">
      <span className="status__dot" />
      <span className="status__text">
        {online ? 'Connected to LiveScape server' : 'LiveScape server unreachable'}
      </span>
      <span className="status__meta">
        {online
          ? `${health?.connectedClients ?? 0} renderer client(s) · feed ${feedStatus}`
          : 'start the event server to regain control'}
      </span>
    </div>
  );
}

interface CardProps {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly variant?: 'default' | 'simulation';
}

function Card({ title, description, children, variant = 'default' }: CardProps) {
  return (
    <section className={`card${variant === 'simulation' ? ' card--simulation' : ''}`}>
      <h2 className="card__title">{title}</h2>
      <p className="card__description">{description}</p>
      {children}
    </section>
  );
}

interface SimulationCardProps {
  readonly pending: boolean;
  readonly onSend: (request: EventRequest) => Promise<void>;
}

function SimulationCard({ pending, onSend }: SimulationCardProps) {
  const [action, setAction] = useState<SimulatedActionId>('gift');
  const [effectId, setEffectId] = useState<EffectId>('fireworks');
  const [quantity, setQuantity] = useState(20);

  const usesQuantity = simulatedActionUsesQuantity(action);
  const request = simulatedActionRequest(action, effectId, quantity);
  const intensity = request.payload.intensity;

  return (
    <Card
      title="Simulated viewer event"
      description="Development simulation only — no livestream platform is connected."
      variant="simulation"
    >
      <p className="card__notice">
        LiveScape has no TikTok, YouTube or other platform integration. These controls generate
        local events with <code>source: &quot;simulation&quot;</code> so the event path can be
        exercised end to end.
      </p>

      <form
        className="form-grid"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          void onSend(request);
        }}
      >
        <label className="field">
          <span className="field__label">Simulated action</span>
          <select
            className="field__input"
            value={action}
            onChange={(changeEvent) => setAction(changeEvent.target.value as SimulatedActionId)}
          >
            {SIMULATED_ACTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Effect</span>
          <select
            className="field__input"
            value={effectId}
            onChange={(changeEvent) => setEffectId(changeEvent.target.value as EffectId)}
          >
            {REGISTRY.effects.map((effect) => (
              <option key={effect.id} value={effect.id}>
                {effect.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Quantity</span>
          <input
            className="field__input"
            type="number"
            min={1}
            max={100}
            value={quantity}
            disabled={!usesQuantity}
            onChange={(changeEvent) =>
              setQuantity(Number.parseInt(changeEvent.target.value, 10) || 1)
            }
          />
          <span className="field__hint">
            {usesQuantity
              ? `maps to intensity ${intensity.toFixed(2)}`
              : `not used by this action (intensity ${intensity.toFixed(2)})`}
          </span>
        </label>

        <button type="submit" className="control-button control-button--primary" disabled={pending}>
          Send simulated event
        </button>
      </form>

      <details className="preview">
        <summary className="preview__summary">Normalized event this will send</summary>
        <pre className="preview__body">{JSON.stringify(request, null, 2)}</pre>
      </details>
    </Card>
  );
}

interface ActivityLogProps {
  readonly entries: readonly { event: { id: string; type: string; source: string }; receivedAt: number }[];
}

function ActivityLog({ entries }: ActivityLogProps) {
  if (entries.length === 0) {
    return <p className="activity__empty">No events yet.</p>;
  }

  return (
    <ol className="activity">
      {entries.map((entry) => (
        <li key={entry.event.id} className="activity__row">
          <code className="activity__type">{entry.event.type}</code>
          <span className={`activity__source activity__source--${entry.event.source}`}>
            {entry.event.source}
          </span>
          <time className="activity__time">
            {new Date(entry.receivedAt).toLocaleTimeString()}
          </time>
        </li>
      ))}
    </ol>
  );
}
