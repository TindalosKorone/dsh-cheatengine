# AGENTS.md — dsh-cheatengine 使用规范

本文件给 DSH Agent 阅读。人类安装/排障请看 [README.md](README.md)。详细工具表与上限见 [docs/agent-tool-reference.md](docs/agent-tool-reference.md)。

## 这是什么

一个 Cheat Engine 桥接插件：让你通过 `ce_*` 工具远程控制 Windows 上的 Cheat Engine，进行进程附加、内存扫描/读写、反汇编、断点、寄存器查看、Lua/AA 脚本等动态调试。

> 适用场景：**单用户 / 低并发**本地调试。多会话并发时，状态与悬浮面板以最近活动会话为准；高并发调试请勿依赖本插件。

## 注意：Token 消耗

- 本插件会注册大量 `ce_*` 工具，**增加每次请求的 token 消耗**。
- 默认只暴露 `ce_status`、`ce_connect`、`ce_tool_search`、`ce_playbook`、`ce_mission`；请按需解锁，不要一次性全开。
- 解锁越多工具，上下文越大；长时间调试时留意预算。

## 使用流程（必须遵守）

1. **先连接**：调用 `ce_status` 检查桥接；未连接时调用 `ce_connect`。
2. **按需解锁**：
   - `ce_tool_search({"query": "scan"})` 搜索可用工具；
   - `ce_tool_search({"packs": ["scan", "memory"]})` 按任务包解锁；
   - `ce_tool_search({"toolNames": ["ce_scan"]})` 精确解锁。
   - 解锁从**下一请求**开始生效，会话内保持。
3. **不要用 bash/pwsh 代替 CE 工具**：读写内存、扫描、断点必须走 `ce_*` 工具。

## 推荐入口

- 内存读写优先用 `ce_memory_read` / `ce_memory_write`
- 会话/报告优先用 `ce_session`
- 任务引导用 `ce_playbook` / `ce_mission`

详细工具列表、速查表、上限见 [docs/agent-tool-reference.md](docs/agent-tool-reference.md)。

## 安全

- 危险工具会修改目标进程内存或执行脚本，**仅在用户明确要求且你有权限时使用**。
- 默认连接 `127.0.0.1:17171`；远程/非信任网络不要使用。
