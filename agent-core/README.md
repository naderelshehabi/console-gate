# agent-core

Portable, dependency-free **C99** shared by the ConsoleGate **Wii** and **Xbox
360** agents. It holds all the platform-independent agent logic so the hardware
layers (libogc / XDK) stay thin, and so the logic can be **unit-tested on the
host** even though the consoles themselves can't be built/run here.

## Modules

| File | Responsibility |
|---|---|
| `cg_json.[ch]` | Small JSON reader (objects/arrays/strings/numbers/bools/null/nesting) for parsing Hub responses |
| `cg_http.[ch]` | Build HTTP/1.1 requests + split responses (status/body), so platform net layers only do socket I/O |
| `cg_proto.[ch]` | Build the `/agent/poll` request body; parse its response into a struct ([protocol §8.6](../docs/implement/08-protocol-api.md)) |
| `cg_agent.[ch]` | Decision logic: time-trust (high-water/rollback/default-clock), fail-closed grace window, Wii won't-finish launch guard, session accounting, command handling ([time & tamper](../docs/implement/09-time-and-tamper.md)) |
| `cg_enforce.[ch]` | In-game (360) enforcement: graduated-warning fire-once scheduler, soft/hard action selector (warn/grace/force-close/nag/lock), monotonic minute accounting ([360 agent](../docs/implement/04-console-xbox360.md)) |

No I/O, no platform calls — pure functions the platform layer drives.

## Test

```bash
cd agent-core
make test        # builds with the host C compiler and runs the suite
```

Current: **122 checks, 0 failed** (`test_json.c`, `test_http.c`, `test_proto.c`,
`test_agent.c`, `test_enforce.c`). Compiles clean under `-Wall -Wextra`.

## Cross-language contract check

The `tool` target builds `cg_parse_tool`, which parses a Hub `/agent/poll`
response from stdin and prints what the agent extracts — used to verify the C
parser against a **real** Hub response:

```bash
make tool
curl -s -XPOST .../api/v1/agent/poll -H "Authorization: Bearer <token>" -d '{}' \
  | build/cg_parse_tool
# ok=1 state=LOCKED reason=locked-by-parent ... commands=1
# command[0] type=LOCK_NOW id=...
# launch_guard=BLOCK
```

The Hub side locks this contract with `hub/src/api/agent-contract.test.ts`, so a
drift in the response shape fails CI before it can break the native agents.

## Consumers

- [`../agent-wii`](../agent-wii) — Wii gatekeeper (libogc/devkitPPC). **Glue written; hardware build pending.**
- [`../agent-360`](../agent-360) — Xbox 360 plugin (XDK). **Glue written + host-compiles against this core; XDK build pending.**
