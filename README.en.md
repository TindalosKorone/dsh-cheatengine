# @tindalosko/dsh-cheatengine

**English** | [简体中文](README.md)

A DeepSeek Harness (DSH) plugin that lets agents drive Cheat Engine for single-player game debugging: find values, find base addresses, lock resources, analyze writers, and more.

> ⚠️ **Token warning**: this plugin registers many `ce_*` tools, which **increases token usage per request**. Only `ce_status`, `ce_connect`, `ce_tool_search`, `ce_playbook`, and `ce_mission` are exposed by default; unlock tools on demand.

## Scope

This plugin targets **single-user / low-concurrency** local single-player debugging: attach one target process at a time and debug from one DSH session. When multiple sessions debug concurrently, state and the floating panel follow the **most recently active session**; this plugin is not recommended for high-concurrency or multi-agent CE debugging.

## Features

- Memory scan / filter / read / write
- Disassembly, breakpoints, registers, find-what-writes
- Pointer scan and base-address verification
- Address locking (infinite resources)
- AOB search / generation, module dump, speedhack, cheat table save/load
- Anti-cheat / protection module detection
- Session stats, hypothesis / evidence, audit / undo, snapshot, risk levels
- Unified memory / session tools (`ce_memory_read`, `ce_memory_write`, `ce_session`); old tool names remain for compatibility
- Optional floating status panel (bottom-right, closable / reopenable)

## Quick start

### 1. CE side (Windows)

1. Get `ce_mcp_bridge.lua` and `ce_mcp_tcp_x64.dll` (use `x86` for 32-bit CE) from [cheatengine-mcp-tcp-bridge](https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge).
2. Put the DLL into your Cheat Engine directory.
3. Open CE and attach to the target process.
4. Run `ce_mcp_bridge.lua`; you should see `Bridge started on port 17171`.

You can also ask the DSH agent to call `install_ce_bridge` to automate steps 1–2.

### 2. DSH side

Install from npm (recommended):

```bash
dsh plugin add @tindalosko/dsh-cheatengine
```

Or install from GitHub:

```bash
dsh plugin add github:TindalosKorone/dsh-cheatengine
```

Or inject locally:

```
dev_inject_plugin {"dir": "/absolute/path/dsh-cheatengine"}
```

Default bridge endpoint is `127.0.0.1:17171`; override with `ce_connect`.

## Usage

1. Run `ce_status` / `ce_connect` to verify the connection.
2. Use `ce_tool_search` to find and unlock tools by task pack, e.g. `ce_tool_search({"packs": ["scan", "memory"]})`; prefer `ce_memory_read` / `ce_memory_write` for memory access.
3. For common debugging flows, ask the agent to call `ce_playbook` / `ce_mission`.

See [AGENTS.md](AGENTS.md) for the full tool list and agent-facing conventions.

## Floating panel

- Enabled by default; shows phase, calls, scan count, locks, and summary at the bottom-right.
- Click **×** to close; it becomes a small **🧊 CE** button that reopens the panel.
- The panel only reads the local `/ce-status/api`; it does not consume LLM tokens by itself (the plugin tools do).

## Build & self-check

The repo ships a ready-to-run `lib/`, so cloning is enough. To build from source:

```bash
npm run build:all   # build host + client
npm run typecheck
node scripts/self-check.mjs
node --test test/tools.test.mjs
```

## Safety

- Use only in environments where you have permission to debug the target.
- Dangerous tools modify memory or run scripts; think before unlocking.
- The bridge binds to local `127.0.0.1:17171` by default; do not use over untrusted networks.

## Links

- [AGENTS.md](AGENTS.md) — agent-facing usage guide
- [HollyZoe/cheatengine-mcp-tcp-bridge](https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge) — CE-side bridge
