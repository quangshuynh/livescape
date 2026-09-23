"""Command line: ``python -m livescape_platform_adapter``.

Runs the adapter with the simulated platform source. Three modes:

* ``--check`` validates the mapping file and prints it.
* With scenario names (``bus leaves burst``), emits those simulated events,
  waits for the adapter to finish, prints its status as JSON and exits.
* With no scenario, reads commands from standard input, one per line: a
  scenario name, ``gift <id> [count]``, ``follow``, ``status``, ``help`` or
  ``quit``.

Every line of output is local. Nothing is persisted.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
import sys
import threading
from pathlib import Path

from .adapter import Adapter
from .client import DEFAULT_SERVER_URL, EventServerClient, UrllibTransport
from .mapping import MappingError, MappingTable, load_mappings
from .simulation import SCENARIO_NAMES, SimulationScript, SimulationSource

EXIT_CONFIG_ERROR = 2
HELP = (
    "commands: " + ", ".join(SCENARIO_NAMES) + ", gift <id> [count], status, help, quit\n"
    "Simulated events only: no platform is connected and no real viewer is observed."
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="livescape-platform-adapter",
        description="Map simulated platform events onto LiveScape scene actions.",
    )
    parser.add_argument(
        "scenarios",
        nargs="*",
        metavar="SCENARIO",
        help=f"simulated scenarios to run, then exit: {', '.join(SCENARIO_NAMES)}",
    )
    parser.add_argument(
        "--server",
        default=os.environ.get("LIVESCAPE_EVENT_SERVER_URL", DEFAULT_SERVER_URL),
        help="event server base URL, loopback only (default: %(default)s)",
    )
    parser.add_argument(
        "--mappings",
        type=Path,
        default=os.environ.get("LIVESCAPE_ADAPTER_MAPPINGS") or None,
        help="mapping file (default: the bundled demonstration mappings)",
    )
    parser.add_argument(
        "--interval-ms",
        type=int,
        default=0,
        help="delay between simulated events in scenario mode (default: 0, a true burst)",
    )
    parser.add_argument("--check", action="store_true", help="validate the mappings and exit")
    parser.add_argument("--quiet", action="store_true", help="print only the final status")
    return parser


def _print_mappings(table: MappingTable) -> None:
    for rule in table.rules:
        match = f"{rule.platform} {rule.kind}"
        if rule.gift is not None:
            match += f" {rule.gift}"
        if rule.min_quantity > 1:
            match += f" (x{rule.min_quantity} or more)"
        print(f"  {match} -> {rule.action_id}")


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        mappings = load_mappings(args.mappings)
        transport = UrllibTransport(args.server)
    except (MappingError, ValueError) as exc:
        print(f"livescape-platform-adapter: {exc}", file=sys.stderr)
        return EXIT_CONFIG_ERROR
    unknown = [name for name in args.scenarios if name not in SCENARIO_NAMES]
    if unknown:
        print(f"unknown scenario(s): {', '.join(unknown)}\n{HELP}", file=sys.stderr)
        return EXIT_CONFIG_ERROR

    if args.check:
        print(f"{len(mappings.rules)} mapping(s) valid:")
        _print_mappings(mappings)
        return 0

    try:
        return asyncio.run(_run(args, mappings, transport))
    except KeyboardInterrupt:
        return 130


async def _run(args: argparse.Namespace, mappings: MappingTable, transport: UrllibTransport) -> int:
    source = SimulationSource()
    report = (lambda line: None) if args.quiet else (lambda line: print(line, flush=True))
    adapter = Adapter(mappings, EventServerClient(transport, source.event_source), report=report)
    script = SimulationScript()

    await source.connect()
    report(f"simulation source connected; event server {transport.base_url}")
    worker = asyncio.create_task(adapter.run())
    consumer = asyncio.create_task(adapter.consume(source))
    try:
        if args.scenarios:
            for name in args.scenarios:
                await _emit(source, script.scenario(name), args.interval_ms, report)
            await _settle(source, adapter)
            print(json.dumps(adapter.snapshot(source), indent=2))
        else:
            await _interactive(source, adapter, script, report)
    finally:
        await source.disconnect()
        worker.cancel()
        consumer.cancel()
        for task in (worker, consumer):
            with contextlib.suppress(asyncio.CancelledError):
                await task
    return 0


async def _emit(source: SimulationSource, events: list[object], interval_ms: int, report) -> None:
    for raw in events:
        if not source.emit(raw):
            report("simulation inbox full, event dropped")
        await asyncio.sleep(interval_ms / 1000)


async def _settle(source: SimulationSource, adapter: Adapter) -> None:
    while source.pending():
        await asyncio.sleep(0.01)
    await asyncio.sleep(0)
    await adapter.wait_idle()


async def _interactive(
    source: SimulationSource, adapter: Adapter, script: SimulationScript, report
) -> None:
    lines = _stdin_lines()
    report(HELP)
    while True:
        line = await lines.get()
        if line is None:
            return
        words = line.split()
        if not words:
            continue
        command = words[0]
        if command in ("quit", "exit"):
            return
        if command == "help":
            print(HELP, flush=True)
        elif command == "status":
            await _settle(source, adapter)
            print(json.dumps(adapter.snapshot(source), indent=2), flush=True)
        elif command == "gift" and len(words) in (2, 3):
            count = words[2] if len(words) == 3 else "1"
            if not count.isdigit():
                print("count must be a whole number", flush=True)
                continue
            await _emit(source, [script.gift(words[1], int(count))], 0, report)
        elif command in SCENARIO_NAMES:
            await _emit(source, script.scenario(command), 0, report)
        else:
            print(f"unknown command {command!r}; {HELP}", flush=True)


def _stdin_lines() -> asyncio.Queue[str | None]:
    """Standard input as a bounded queue of lines; ``None`` at end of input.

    A daemon thread does the blocking reads so Ctrl-C and ``quit`` never wait
    on the terminal.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=64)

    def offer(item: str | None) -> None:
        with contextlib.suppress(asyncio.QueueFull):
            queue.put_nowait(item)

    def read() -> None:
        for line in sys.stdin:
            loop.call_soon_threadsafe(offer, line.strip())
        loop.call_soon_threadsafe(offer, None)

    threading.Thread(target=read, name="stdin", daemon=True).start()
    return queue


if __name__ == "__main__":
    sys.exit(main())
