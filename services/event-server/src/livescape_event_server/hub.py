"""Fan-out of normalized events to connected renderer clients.

The hub deliberately knows nothing about FastAPI: it talks to anything with an
async ``send_json``. That keeps broadcast behaviour (including the failure
handling) testable without a real socket.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger("livescape.hub")


@runtime_checkable
class EventClient(Protocol):
    async def send_json(self, data: Any) -> None: ...


class ConnectionHub:
    def __init__(self) -> None:
        self._clients: set[EventClient] = set()
        self._lock = asyncio.Lock()

    @property
    def client_count(self) -> int:
        return len(self._clients)

    async def register(self, client: EventClient) -> None:
        async with self._lock:
            self._clients.add(client)
        logger.info("renderer client connected (%d total)", self.client_count)

    async def unregister(self, client: EventClient) -> None:
        async with self._lock:
            self._clients.discard(client)
        logger.info("renderer client disconnected (%d total)", self.client_count)

    async def send_to(self, client: EventClient, message: dict[str, Any]) -> bool:
        """Send to a single client, dropping it if the send fails."""
        try:
            await client.send_json(message)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("dropping client after failed send", exc_info=True)
            await self.unregister(client)
            return False
        return True

    async def broadcast(self, message: dict[str, Any]) -> int:
        """Deliver ``message`` to every client; return how many received it.

        One wedged or half-closed client must never stop the others from being
        served, so sends run concurrently and failures only remove the client
        that failed.
        """
        async with self._lock:
            targets = list(self._clients)
        if not targets:
            return 0

        results = await asyncio.gather(
            *(client.send_json(message) for client in targets),
            return_exceptions=True,
        )

        failed: list[EventClient] = []
        for client, result in zip(targets, results, strict=True):
            if isinstance(result, BaseException):
                logger.warning("broadcast failed for a client: %r", result)
                failed.append(client)

        if failed:
            async with self._lock:
                for client in failed:
                    self._clients.discard(client)

        return len(targets) - len(failed)
