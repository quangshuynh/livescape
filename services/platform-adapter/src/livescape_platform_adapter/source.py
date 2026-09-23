"""The interface a platform integration implements.

```text
PlatformSource
    connect()      open whatever connection the platform needs
    events()       async stream of PlatformEvent | NormalizationError
    disconnect()   release it
    status         connection status, for local display
```

A source owns everything platform-specific: credentials (none for the
simulator), connection handling, and normalization of the platform's payloads.
It never sees mappings, LiveScape actions or the event server, and the adapter
never sees platform payloads. A new platform is a new source; the mapping
engine, the event server and the renderer do not change.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Literal, Protocol

from .events import NormalizationError, PlatformEvent

SourceStatus = Literal["idle", "connecting", "connected", "disconnected", "failed"]

#: The LiveScape protocol ``source`` values an adapter may send. Real
#: platforms will need a platform-neutral value added to the protocol registry
#: (never a platform name); until then only the simulator exists.
AdapterEventSource = Literal["simulation"]


class PlatformSource(Protocol):
    #: Short platform token, matched by mapping rules (``"simulation"``).
    platform: str
    #: The ``source`` field of the LiveScape events this source leads to.
    event_source: AdapterEventSource

    @property
    def status(self) -> SourceStatus: ...

    async def connect(self) -> None: ...

    def events(self) -> AsyncIterator[PlatformEvent | NormalizationError]: ...

    async def disconnect(self) -> None: ...
