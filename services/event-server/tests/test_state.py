from __future__ import annotations

from livescape_event_server.models import (
    EffectClearRequest,
    EffectTriggerRequest,
    SceneChangeRequest,
    envelope_from_request,
)
from livescape_event_server.state import SceneState


def scene_envelope(scene_id: str) -> object:
    return envelope_from_request(
        SceneChangeRequest.model_validate(
            {"version": 1, "type": "scene.change", "payload": {"sceneId": scene_id}}
        )
    )


def trigger_envelope(effect_id: str, duration_ms: int | None) -> object:
    return envelope_from_request(
        EffectTriggerRequest.model_validate(
            {
                "version": 1,
                "type": "effect.trigger",
                "payload": {"effectId": effect_id, "intensity": 1, "durationMs": duration_ms},
            }
        )
    )


def clear_envelope(effect_id: str | None) -> object:
    return envelope_from_request(
        EffectClearRequest.model_validate(
            {"version": 1, "type": "effect.clear", "payload": {"effectId": effect_id}}
        )
    )


def test_defaults_to_the_configured_scene() -> None:
    assert SceneState(default_scene="space").snapshot().scene_id == "space"


def test_scene_change_replaces_the_current_scene() -> None:
    state = SceneState()
    state.apply(scene_envelope("forest"))  # type: ignore[arg-type]
    state.apply(scene_envelope("space"))  # type: ignore[arg-type]

    assert state.snapshot().scene_id == "space"


def test_triggering_the_same_effect_twice_does_not_duplicate_it() -> None:
    state = SceneState()
    state.apply(trigger_envelope("rain", None))  # type: ignore[arg-type]
    state.apply(trigger_envelope("rain", None))  # type: ignore[arg-type]

    assert [effect.effect_id for effect in state.snapshot().effects] == ["rain"]


def test_clearing_one_effect_leaves_the_others_running() -> None:
    state = SceneState()
    state.apply(trigger_envelope("rain", None))  # type: ignore[arg-type]
    state.apply(trigger_envelope("snow", None))  # type: ignore[arg-type]
    state.apply(clear_envelope("rain"))  # type: ignore[arg-type]

    assert [effect.effect_id for effect in state.snapshot().effects] == ["snow"]


def test_clearing_without_an_id_clears_everything() -> None:
    state = SceneState()
    state.apply(trigger_envelope("rain", None))  # type: ignore[arg-type]
    state.apply(trigger_envelope("snow", None))  # type: ignore[arg-type]
    state.apply(clear_envelope(None))  # type: ignore[arg-type]

    assert state.snapshot().effects == ()


def test_snapshot_reports_the_remaining_time_of_a_timed_effect() -> None:
    state = SceneState()
    state.apply(trigger_envelope("fireworks", 8000), now=100.0)  # type: ignore[arg-type]

    effects = state.snapshot(now=103.0).effects
    assert len(effects) == 1
    assert 4900 <= (effects[0].duration_ms or 0) <= 5000


def test_snapshot_drops_effects_that_have_already_finished() -> None:
    state = SceneState()
    state.apply(trigger_envelope("fireworks", 8000), now=100.0)  # type: ignore[arg-type]

    assert state.snapshot(now=200.0).effects == ()


def test_effects_without_a_duration_run_until_cleared() -> None:
    state = SceneState()
    state.apply(trigger_envelope("rain", None), now=100.0)  # type: ignore[arg-type]

    assert state.snapshot(now=10_000.0).effects[0].duration_ms is None
