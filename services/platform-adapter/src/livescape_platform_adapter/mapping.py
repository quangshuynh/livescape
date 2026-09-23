"""Declarative mapping from normalized platform events to scene actions.

A mapping file is TOML and says exactly one kind of thing: *this event selects
that allowlisted action*.

```toml
version = 1

[[mapping]]
platform = "simulation"
kind = "gift"
gift = "demo.bus"
action = "roadside.send-bus"

[[mapping]]
platform = "simulation"
kind = "gift"
gift = "demo.rush"
action = "roadside.rush-hour"
min_quantity = 5
```

That is the whole language. There are no expressions, conditions, templates,
commands, URLs, paths or actor definitions, and any key outside the list below
is an error rather than something silently ignored. Every action must be in
the scene-action registry. The file is validated completely at startup and a
bad file stops the adapter with every problem listed.
"""

from __future__ import annotations

import tomllib
from collections.abc import Mapping
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any

from .events import EVENT_KINDS, MAX_QUANTITY, TOKEN_PATTERN, PlatformEvent
from .registry import scene_action_owners

MAPPING_FILE_VERSION = 1
MAX_RULES = 256
_RULE_KEYS = frozenset({"platform", "kind", "gift", "action", "min_quantity"})
_TOP_LEVEL_KEYS = frozenset({"version", "mapping"})

MatchKey = tuple[str, str, str | None]


class MappingError(ValueError):
    """The mapping file is invalid. ``problems`` lists every issue found."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("invalid mapping file:\n  " + "\n  ".join(problems))
        self.problems = problems


@dataclass(frozen=True, slots=True)
class MappingRule:
    platform: str
    kind: str
    gift: str | None
    action_id: str
    min_quantity: int = 1

    @property
    def key(self) -> MatchKey:
        return (self.platform, self.kind, self.gift)


@dataclass(frozen=True, slots=True)
class MappingDecision:
    """``action_id`` is set when the event selects an action."""

    action_id: str | None
    rule: MappingRule | None = None
    #: ``"unmapped"`` or ``"below-minimum"`` when ``action_id`` is ``None``.
    reason: str | None = None


class MappingTable:
    def __init__(self, rules: list[MappingRule]) -> None:
        self._rules: dict[MatchKey, MappingRule] = {rule.key: rule for rule in rules}

    @property
    def rules(self) -> tuple[MappingRule, ...]:
        return tuple(self._rules.values())

    @property
    def action_ids(self) -> frozenset[str]:
        return frozenset(rule.action_id for rule in self._rules.values())

    def resolve(self, event: PlatformEvent) -> MappingDecision:
        rule = self._rules.get((event.platform, event.kind, event.gift_id))
        if rule is None:
            return MappingDecision(None, reason="unmapped")
        if event.quantity < rule.min_quantity:
            return MappingDecision(None, rule, reason="below-minimum")
        return MappingDecision(rule.action_id, rule)


def parse_mappings(document: Mapping[str, Any]) -> MappingTable:
    """Validate a parsed mapping document. Raises ``MappingError``."""
    problems: list[str] = []
    for key in sorted(set(document) - _TOP_LEVEL_KEYS):
        problems.append(f"unsupported top-level key {key!r}")
    if document.get("version") != MAPPING_FILE_VERSION:
        problems.append(f"version must be {MAPPING_FILE_VERSION}")

    raw_rules = document.get("mapping", [])
    if not isinstance(raw_rules, list) or not all(isinstance(r, dict) for r in raw_rules):
        problems.append("mapping must be a list of [[mapping]] tables")
        raise MappingError(problems)
    if len(raw_rules) > MAX_RULES:
        problems.append(f"at most {MAX_RULES} mappings are allowed")

    owners = scene_action_owners()
    rules: list[MappingRule] = []
    seen: dict[MatchKey, int] = {}
    for index, raw in enumerate(raw_rules, start=1):
        where = f"mapping {index}"
        rule_problems = _check_rule(raw, owners)
        if rule_problems:
            problems.extend(f"{where}: {problem}" for problem in rule_problems)
            continue
        rule = MappingRule(
            platform=raw["platform"],
            kind=raw["kind"],
            gift=raw.get("gift"),
            action_id=raw["action"],
            min_quantity=raw.get("min_quantity", 1),
        )
        if rule.key in seen:
            problems.append(f"{where}: duplicates mapping {seen[rule.key]} for the same event")
            continue
        seen[rule.key] = index
        rules.append(rule)

    if problems:
        raise MappingError(problems)
    return MappingTable(rules)


def _check_rule(raw: dict[str, Any], owners: Mapping[str, str]) -> list[str]:
    problems = [f"unsupported key {key!r}" for key in sorted(set(raw) - _RULE_KEYS)]

    platform = raw.get("platform")
    if not isinstance(platform, str) or not TOKEN_PATTERN.fullmatch(platform):
        problems.append("platform must be a short token")

    kind = raw.get("kind")
    if kind not in EVENT_KINDS:
        problems.append(f"kind must be one of {', '.join(EVENT_KINDS)}")

    gift = raw.get("gift")
    if kind == "gift":
        if not isinstance(gift, str) or not TOKEN_PATTERN.fullmatch(gift):
            problems.append("a gift mapping needs a gift id token")
    elif gift is not None:
        problems.append("only gift mappings take a gift id")

    action = raw.get("action")
    if not isinstance(action, str) or action not in owners:
        problems.append(f"action {action!r} is not an allowlisted scene action")

    minimum = raw.get("min_quantity", 1)
    if isinstance(minimum, bool) or not isinstance(minimum, int):
        problems.append("min_quantity must be an integer")
    elif not 1 <= minimum <= MAX_QUANTITY:
        problems.append(f"min_quantity must be from 1 to {MAX_QUANTITY}")
    elif minimum != 1 and kind != "gift":
        problems.append("min_quantity applies to gift mappings only")
    return problems


def load_mappings(path: Path | None = None) -> MappingTable:
    """Load a mapping file, or the bundled demonstration mappings."""
    try:
        if path is None:
            text = resources.files(__package__).joinpath("default-mappings.toml").read_text("utf-8")
        else:
            text = path.read_text(encoding="utf-8")
        document = tomllib.loads(text)
    except OSError as exc:
        raise MappingError([f"cannot read mapping file: {exc.strerror or exc}"]) from None
    except tomllib.TOMLDecodeError as exc:
        raise MappingError([f"not valid TOML: {exc}"]) from None
    return parse_mappings(document)
