# @dsh-external/dsh-cheatengine

A DeepSeek Harness (DSH) plugin that lets agents drive Cheat Engine through `ce_*` tools: process attach, memory scan/read/write, disassembly, breakpoints, registers, pointer analysis, Lua/AA scripts, and more.

## Install

### CE side (Windows)

1. Get `ce_mcp_bridge.lua` and `ce_mcp_tcp_x64.dll` (use `x86` for 32-bit CE) from [cheatengine-mcp-tcp-bridge](https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge).
2. Put the DLL into your Cheat Engine directory.
3. Open CE and attach to the target process.
4. Run `ce_mcp_bridge.lua`; you should see `Bridge started on port 17171`.

You can also ask the DSH agent to call `install_ce_bridge` to automate steps 1–2.

### DSH side

```bash
git clone https://github.com/TindalosKorone/dsh-cheatengine.git
# then let the DSH agent call:
dev_inject_plugin {"dir": "/absolute/path/dsh-cheatengine"}
```

If you see `Cannot find package '@deepseek-ai/dsh-tools'`, run:

```bash
node scripts/link-deps.mjs
```

Default bridge endpoint is `127.0.0.1:17171`; override with `ce_connect`.

## Tool exposure

To avoid dumping 30+ tools into the context, only 3 tools are resident by default:

- `ce_status`, `ce_connect`, `ce_tool_search`
- Other `ce_*` tools are unlocked on demand via `ce_tool_search`.
- Dangerous tools (write/breakpoint/script) require explicit unlock.

See [AGENTS.md](AGENTS.md) for the full tool list and agent-facing conventions.

## What this is NOT

| This plugin is NOT | What it actually is |
|---|---|
| A full reverse-engineering framework | A Cheat Engine bridge: it gives agents CE operations, not a decompiler/analyzer |
| A game cheat by itself | A toolkit for authorized debugging and memory analysis |
| A server/database | A local TCP bridge to a running Cheat Engine instance |
| A security bypass | A tool that requires you to have permission to debug the target process |
| A static analysis suite | A dynamic debugging/memory tool, best combined with skills/playbooks for RE |

## FAQ

- **Bridge won't connect?** Make sure CE is running, the target process is attached, and you see `Bridge started on port 17171`.
- **`@deepseek-ai/dsh-tools` not found?** Run `node scripts/link-deps.mjs` first.
- **Too many tools?** Only 3 resident tools are exposed by default; unlock the rest via `ce_tool_search`.
- **Before pushing?** Run `node scripts/self-check.mjs`.

## Build & self-check

The repo ships a ready-to-run `lib/`, so cloning is enough. To build from source:

```bash
# Linux/macOS
DSH_CHECKOUT=/path/to/dsh-harness bash scripts/build.sh
# or cross-platform (Windows PowerShell works too)
npm run build
```

Before pushing, run:

```bash
node scripts/self-check.mjs
```

## Links

- [AGENTS.md](AGENTS.md) — agent-facing usage guide
- [HollyZoe/cheatengine-mcp-tcp-bridge](https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge) — CE-side bridge
