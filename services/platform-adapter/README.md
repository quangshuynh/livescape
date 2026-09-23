# LiveScape platform adapter

A separate local process that turns external platform events into existing
LiveScape scene actions and submits them to the event server's normal
`POST /api/events` endpoint. The only platform source today is a
deterministic simulator; no real livestream platform is connected.

```bash
python -m livescape_platform_adapter --check          # validate the mappings
python -m livescape_platform_adapter bus leaves burst # run scenarios, print status
python -m livescape_platform_adapter                  # interactive commands
```

See the [platform adapter documentation](../../docs/platform-adapters.md) for
the event model, mapping file, deduplication, burst and failure behaviour.
