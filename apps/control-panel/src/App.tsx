import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  REGISTRY,
  actionsForScene,
  effectClearRequest,
  effectTriggerRequest,
  isSceneId,
  sceneActionEntry,
  sceneActionRequest,
  sceneChangeRequest,
  sceneEntry,
  type EffectId,
  type EventRequest,
  type SceneActionId,
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
  acceptedFeedback,
  cooldownRemaining,
  mergeCooldowns,
  rejectedFeedback,
  type ActionFeedback,
  type CooldownDeadlines,
} from './sceneActions.js';
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

        <SceneActionsCard apiUrl={apiUrl} health={health} onSent={refreshHealth} />

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

/** How often cooldown countdowns repaint while any action is cooling down. */
const COOLDOWN_TICK_MS = 200;

interface SceneActionsCardProps {
  readonly apiUrl: string;
  readonly health: Health | null;
  readonly onSent: () => void;
}

/**
 * Manual scene actions: the operator's way to exercise exactly the request a
 * platform adapter would send. Only the current scene's actions are offered;
 * the event server and the renderer still check ownership and cooldowns
 * themselves, so these buttons are a convenience, not the safeguard.
 */
function SceneActionsCard({ apiUrl, health, onSent }: SceneActionsCardProps) {
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [deadlines, setDeadlines] = useState<CooldownDeadlines>({});
  const [now, setNow] = useState(() => Date.now());

  const sceneId = health && isSceneId(health.currentScene) ? health.currentScene : null;
  const actions = sceneId ? actionsForScene(sceneId) : [];
  // Cooldowns this panel started, plus any the server reports (another
  // operator, or an adapter, may have triggered the action).
  const known = health
    ? mergeCooldowns(deadlines, health.actionCooldowns, health.receivedAt ?? now)
    : deadlines;

  const cooling = actions.some((action) => cooldownRemaining(known, action.id, now) > 0);
  useEffect(() => {
    if (!cooling) return;
    const timer = setInterval(() => setNow(Date.now()), COOLDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, [cooling]);

  const trigger = useCallback(
    async (actionId: SceneActionId) => {
      try {
        const accepted = await sendEvent(apiUrl, sceneActionRequest(actionId));
        const sentAt = Date.now();
        setDeadlines((current) => ({ ...current, [actionId]: sentAt + sceneActionEntry(actionId).cooldownMs }));
        setNow(sentAt);
        setFeedback(acceptedFeedback(actionId, accepted.deliveredTo));
        onSent();
      } catch (caught) {
        const failedAt = Date.now();
        if (caught instanceof EventServerError && caught.retryAfterMs !== null) {
          const until = failedAt + caught.retryAfterMs;
          setDeadlines((current) => ({ ...current, [actionId]: until }));
        }
        setNow(failedAt);
        setFeedback(rejectedFeedback(actionId, caught));
        // A scene mismatch means this panel's view of the current scene is stale.
        if (caught instanceof EventServerError && caught.status === 409) onSent();
      }
    },
    [apiUrl, onSent],
  );

  return (
    <Card
      title="Scene actions"
      description={
        sceneId
          ? `One-off actions for ${sceneEntry(sceneId).label}. Other scenes show their own.`
          : 'Actions for the current scene appear once the event server is reachable.'
      }
    >
      {sceneId && actions.length === 0 ? (
        <p className="activity__empty">{sceneEntry(sceneId).label} has no scene actions.</p>
      ) : null}
      {actions.length > 0 ? (
        <div className="button-row" role="group" aria-label="Scene actions">
          {actions.map((action) => {
            const remaining = cooldownRemaining(known, action.id, now);
            return (
              <button
                key={action.id}
                type="button"
                className={`control-button${remaining > 0 ? ' control-button--cooling' : ''}`}
                aria-label={action.label}
                aria-describedby="scene-action-feedback"
                title={action.description}
                data-action={action.id}
                onClick={() => void trigger(action.id)}
              >
                {action.label}
                {remaining > 0 ? (
                  <span className="control-button__timer" aria-hidden="true">
                    {(remaining / 1000).toFixed(1)} s
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <p
        id="scene-action-feedback"
        className={`action-feedback${feedback ? ` action-feedback--${feedback.tone}` : ''}`}
        role="status"
        aria-live="polite"
      >
        {feedback?.text ?? ''}
      </p>
    </Card>
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
