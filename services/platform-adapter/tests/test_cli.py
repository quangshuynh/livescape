"""The command line fails clearly on bad configuration and never crashes offline."""

from __future__ import annotations

import json
import socket
from pathlib import Path

import pytest

from livescape_platform_adapter.__main__ import EXIT_CONFIG_ERROR, main


def test_check_lists_the_validated_mappings(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--check"]) == 0

    out = capsys.readouterr().out
    assert "6 mapping(s) valid" in out
    assert "simulation gift demo.bus -> roadside.send-bus" in out


def test_an_invalid_mapping_file_stops_startup(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    bad = tmp_path / "mappings.toml"
    bad.write_text(
        'version = 1\n[[mapping]]\nplatform = "simulation"\nkind = "gift"\ngift = "x"\n'
        'action = "roadside.send-tank"\ncommand = "rm -rf /"\n',
        encoding="utf-8",
    )

    assert main(["--check", "--mappings", str(bad)]) == EXIT_CONFIG_ERROR

    err = capsys.readouterr().err
    assert "unsupported key 'command'" in err
    assert "'roadside.send-tank' is not an allowlisted scene action" in err


def test_a_non_loopback_server_is_refused(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--server", "http://192.168.1.20:8765", "bus"]) == EXIT_CONFIG_ERROR
    assert "must be loopback" in capsys.readouterr().err


def test_an_unknown_scenario_is_refused(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["tiktok-gift"]) == EXIT_CONFIG_ERROR
    assert "unknown scenario" in capsys.readouterr().err


def test_scenarios_run_to_completion_with_no_server(capsys: pytest.CaptureFixture[str]) -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    assert main(["--quiet", "--server", f"http://127.0.0.1:{port}", "bus", "burst"]) == 0

    status = json.loads(capsys.readouterr().out)
    assert status["server"] == "unavailable"
    assert status["counters"]["received"] == 51
    assert status["counters"]["serverUnreachable"] == 1
    assert status["pending"] == []
