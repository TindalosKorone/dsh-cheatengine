# @dsh-external/dsh-cheatengine

让 DSH Agent 通过 `ce_*` 工具调用 Cheat Engine 做动态调试（进程附加、内存扫描、读写、反汇编、断点、寄存器、Lua/AA 脚本）。

## 安装

### CE 端（Windows）

1. 从 [cheatengine-mcp-tcp-bridge](https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge) 获取 `ce_mcp_bridge.lua` 和 `ce_mcp_tcp_x64.dll`（32 位 CE 用 `x86`）。
2. 把 DLL 放入 CE 安装目录。
3. 打开 CE 并**附加目标进程**。
4. 执行 `ce_mcp_bridge.lua`，看到 `Bridge started on port 17171` 即成功。

### DSH 端

```bash
git clone https://github.com/TindalosKorone/dsh-cheatengine.git
# 然后让 DSH agent 调用：
dev_inject_plugin {"dir": "/绝对路径/dsh-cheatengine"}
```

默认连接 `127.0.0.1:17171`，可用 `ce_connect` 覆盖。

## 工具暴露策略（渐进披露）

为避免 30 个工具一次性进入上下文，默认只暴露 3 个常驻工具：

- `ce_status`、`ce_connect`、`ce_tool_search`
- 其他 `ce_*` 工具通过 `ce_tool_search` 按需解锁，解锁从下一请求生效，会话内保持。
- 危险工具（写内存/断点/脚本）必须显式解锁。

完整工具列表与 Agent 使用规范见 [AGENTS.md](AGENTS.md)。

## 安全

- `ce_write_*`、断点、`ce_execute_lua`、`ce_auto_assemble` 是危险操作，需显式解锁。
- CE bridge TCP 端口无认证/无加密，勿暴露到公网。
- 仅对你有权限调试的进程使用。

## 构建

插件核心是纯 Node，不依赖 bash/pwsh；仓库已包含可直接运行的 `lib/`，clone 后无需构建。

需要从源码编译时：

```bash
# Linux/macOS
DSH_CHECKOUT=/path/to/dsh-harness bash scripts/build.sh
# 或跨平台（Windows PowerShell 也可用）
npm run build
```

## 链接

- [AGENTS.md](AGENTS.md) — 给 DSH Agent 的使用规范
- [HollyZoe/cheatengine-mcp-tcp-bridge](https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge) — CE 端桥接
