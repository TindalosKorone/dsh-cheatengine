# @dsh-external/dsh-cheatengine

[English](README.en.md) | **简体中文**

让 DSH Agent 通过 `ce_*` 工具调用 Cheat Engine 做动态调试（进程附加、内存扫描、读写、反汇编、断点、寄存器、指针分析、Lua/AA 脚本等）。

## 功能

- CE 动态调试：进程附加、内存扫描/读写、反汇编、断点、寄存器、AOB
- 游戏调试增强：反作弊检测、模块转储、AOB 生成、变速齿轮、CT 表保存/加载
- 工程化：会话统计、假设追踪、证据记录、审计/撤销、快照、风险分级

## 安装

### CE 端（Windows）

1. 从 [cheatengine-mcp-tcp-bridge](https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge) 获取 `ce_mcp_bridge.lua` 和 `ce_mcp_tcp_x64.dll`（32 位 CE 用 `x86`）。
2. 把 DLL 放入 CE 安装目录。
3. 打开 CE 并**附加目标进程**。
4. 执行 `ce_mcp_bridge.lua`，看到 `Bridge started on port 17171` 即成功。

也可以让 DSH Agent 调用 `install_ce_bridge` 自动完成第 1-2 步。

### DSH 端

```bash
git clone https://github.com/TindalosKorone/dsh-cheatengine.git
# 然后让 DSH agent 调用：
dev_inject_plugin {"dir": "/绝对路径/dsh-cheatengine"}
```

如果从外部路径注入时提示找不到 `@deepseek-ai/dsh-tools`，先执行：

```bash
node scripts/link-deps.mjs
```

默认连接 `127.0.0.1:17171`，可用 `ce_connect` 覆盖。

## 工具暴露策略（渐进披露）

为避免 30 个工具一次性进入上下文，默认只暴露 3 个常驻工具：

- `ce_status`、`ce_connect`、`ce_tool_search`
- 其他 `ce_*` 工具通过 `ce_tool_search` 按需解锁，解锁从下一请求生效，会话内保持。
- 危险工具（写内存/断点/脚本）必须显式解锁。

完整工具列表与 Agent 使用规范见 [AGENTS.md](AGENTS.md)。

## 本插件不是什么

| 本插件不是 | 实际是什么 |
|---|---|
| 完整的逆向工程框架 | 一个 Cheat Engine 桥接：给 Agent 提供 CE 操作，而不是反编译器/分析器 |
| 游戏作弊器本身 | 一个用于**授权调试**和内存分析的工具包 |
| 服务端/数据库 | 一个连接本机 Cheat Engine 的本地 TCP 桥 |
| 安全绕过 | 一个要求你对目标进程拥有调试权限的工具 |
| 静态分析套件 | 一个动态调试/内存工具，最好配合 skills/playbook 做逆向 |

## 常见问题

- **桥接连不上？** 确认 CE 已启动、已附加进程，并看到 `Bridge started on port 17171`。
- **提示找不到 `@deepseek-ai/dsh-tools`？** 先运行 `node scripts/link-deps.mjs`。
- **工具太多？** 默认只暴露 3 个常驻工具，其余通过 `ce_tool_search` 按需解锁。
- **推送前检查？** 运行 `node scripts/self-check.mjs`。

## 构建与自检

插件核心是纯 Node，不依赖 bash/pwsh；仓库已包含可直接运行的 `lib/`，clone 后无需构建。

需要从源码编译时：

```bash
# Linux/macOS
DSH_CHECKOUT=/path/to/dsh-harness bash scripts/build.sh
# 或跨平台（Windows PowerShell 也可用）
npm run build
```

推送前可运行 `node scripts/self-check.mjs` 做本地自检。

## 链接

- [AGENTS.md](AGENTS.md) — 给 DSH Agent 的使用规范
- [HollyZoe/cheatengine-mcp-tcp-bridge](https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge) — CE 端桥接
