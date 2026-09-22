/** Minimal stand-in for the browser WebSocket used by the activity feed. */
export class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = [];

  static reset(): void {
    FakeWebSocket.instances.length = 0;
  }

  static get latest(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error('no FakeWebSocket has been constructed');
    return socket;
  }

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.onopen?.({});
  }

  emit(payload: unknown): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  close(): void {}
}

export function installFakeWebSocket(): void {
  FakeWebSocket.reset();
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
}
