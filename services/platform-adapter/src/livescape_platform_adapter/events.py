"""The normalized platform event: the only shape the mapping layer ever sees.

A platform source turns whatever its platform delivers into a
``PlatformEvent`` or a ``NormalizationError``. Everything after that point is
platform-independent.

The model is deliberately small. It carries what mapping, deduplication and
freshness need and nothing about the viewer: no name, handle, avatar,
biography, location or any other profile data. Deduplication keys on the
platform's event id, so not even an opaque viewer id is needed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, get_args

#: Event kinds the adapter understands. A platform may offer many more; a
#: source drops (or reports as malformed) anything it cannot express here.
PlatformEventKind = Literal["gift", "follow"]
EVENT_KINDS: tuple[str, ...] = get_args(PlatformEventKind)

#: Platform names and gift ids: short, printable, no whitespace or separators
#: that could be mistaken for a path or URL.
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
#: Platform event ids are opaque; bound them and keep them printable.
EVENT_ID_PATTERN = re.compile(r"^[\x21-\x7e]{1,128}$")

MIN_QUANTITY = 1
MAX_QUANTITY = 10_000


class NormalizationError(ValueError):
    """An external event that cannot be expressed as a ``PlatformEvent``.

    The message names the problem, never the offending viewer data.
    """

    def __init__(self, platform: str, reason: str) -> None:
        super().__init__(f"{platform}: {reason}")
        self.platform = platform
        self.reason = reason


@dataclass(frozen=True, slots=True)
class PlatformEvent:
    """One external event, normalized.

    ``event_id`` is the platform's own identifier when it supplies a stable
    one, and ``None`` otherwise; see the deduplication notes in ``dedup.py``.
    ``occurred_at`` is when the platform says the event happened (timezone
    aware), used only to refuse events that arrive long after the moment.
    """

    platform: str
    kind: PlatformEventKind
    event_id: str | None = None
    gift_id: str | None = None
    quantity: int = 1
    occurred_at: datetime | None = None

    def __post_init__(self) -> None:
        if not TOKEN_PATTERN.fullmatch(self.platform):
            raise ValueError("platform must be a short token")
        if self.kind not in EVENT_KINDS:
            raise ValueError(f"unsupported event kind {self.kind!r}")
        if self.event_id is not None and not EVENT_ID_PATTERN.fullmatch(self.event_id):
            raise ValueError("event_id must be 1 to 128 printable characters")
        if self.kind == "gift":
            if self.gift_id is None or not TOKEN_PATTERN.fullmatch(self.gift_id):
                raise ValueError("a gift event needs a gift_id token")
        elif self.gift_id is not None:
            raise ValueError(f"a {self.kind} event has no gift_id")
        if (
            isinstance(self.quantity, bool)
            or not isinstance(self.quantity, int)
            or not MIN_QUANTITY <= self.quantity <= MAX_QUANTITY
        ):
            raise ValueError(f"quantity must be an integer from {MIN_QUANTITY} to {MAX_QUANTITY}")
        if self.occurred_at is not None and self.occurred_at.tzinfo is None:
            raise ValueError("occurred_at must be timezone aware")

    def describe(self) -> str:
        """Short, viewer-free description for local status output."""
        if self.kind == "gift":
            suffix = f" x{self.quantity}" if self.quantity != 1 else ""
            return f"gift {self.gift_id}{suffix}"
        return self.kind
