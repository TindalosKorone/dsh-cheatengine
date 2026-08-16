# @tindalosko/dsh-cheatengine

[English](README.en.md) | **简体中文**

让 DSH Agent 直接操作 Cheat Engine，做单机游戏动态调试：找数值、找基址、锁定资源、分析写入者等。

> ⚠️ **Token 提示**：本插件会注册大量 `ce_*` 工具，**增加每次请求的 token 消耗**。默认只暴露 `ce_status`、`ce_connect`、`ce_tool_search`、`ce_playbook`、`ce_mission`，请按需解锁，不要一次性全开。

## 适用场景

本插件面向**单用户 / 低并发**的本地单机调试：一次主要附加一个目标进程，一个 DSH 会话进行调试。多会话同时调试时，状态与悬浮面板以**最近活动会话**为准；需要高并发 / 多 agent 同时调试 CE 的场景不建议使用本插件。

## 功能

- 内存扫描 / 过滤 / 读取 / 写入
- 反汇编、断点、寄存器、找写入者
- 指针扫描与基址验证
- 锁定地址（无限资源）
- AOB 搜索 / 生成、模块转储、变速、CT 表
- 反作弊 / 保护模块检测
- 会话统计、假设 / 证据、审计 / 撤销、快照、风险分级
- 统一内存读写 / 会话工具（`ce_memory_read`、`ce_memory_write`、`ce_session`），旧工具名保留兼容
- 可选悬浮状态面板（右下角，可关闭 / 重新打开）

## 快速开始

### 1. CE 端（Windows）

1. 从 [cheatengine-mcp-tcp-bridge](https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge) 获取 `ce_mcp_bridge.lua` 和 `ce_mcp_tcp_x64.dll`（32 位 CE 用 `x86`）。
2. 把 DLL 放入 CE 安装目录。
3. 打开 CE 并**附加目标进程**。
4. 执行 `ce_mcp_bridge.lua`，看到 `Bridge started on port 17171` 即成功。

也可以让 Agent 调用 `install_ce_bridge` 自动完成。

### 2. DSH 端

推荐从 npm 安装：

```bash
dsh plugin add @tindalosko/dsh-cheatengine
```

或从 GitHub 安装：

```bash
dsh plugin add github:TindalosKorone/dsh-cheatengine
```

或本地注入：

```
dev_inject_plugin {"dir": "/绝对路径/dsh-cheatengine"}
```

默认连接 `127.0.0.1:17171`，可用 `ce_connect` 修改。

## 怎么用

1. 先 `ce_status` / `ce_connect` 确认连接。
2. 用 `ce_tool_search` 搜索并按任务包解锁需要的工具，例如 `ce_tool_search({"packs": ["scan", "memory"]})`；内存读写优先使用 `ce_memory_read` / `ce_memory_write`。
3. 常见调试流程可让 Agent 调用 `ce_playbook` / `ce_mission` 获取建议。

完整工具列表与 Agent 使用规范见 [AGENTS.md](AGENTS.md)。

## 悬浮面板

- 默认开启，右下角显示阶段、调用数、扫描数、锁定数、总结。
- 点 **×** 关闭；关闭后会变成小按钮 **🧊 CE**，点击可重新打开。
- 面板只读取本地 `/ce-status/api`，本身不消耗 LLM token；但插件工具会。

## 构建与自检

仓库自带 `lib/`，clone 后不构建也能直接注入。需要从源码编译时：

```bash
npm run build:all   # 编译 host + client
npm run typecheck
node scripts/self-check.mjs
node --test test/tools.test.mjs
```

## 安全

- 只用于你有权限的单机 / 调试环境。
- 危险工具会修改内存或执行脚本，解锁前三思。
- 默认仅连接本机 `127.0.0.1:17171`，不要用于远程 / 不信任网络。

## 链接

- [AGENTS.md](AGENTS.md) — 给 DSH Agent 的使用规范
- [HollyZoe/cheatengine-mcp-tcp-bridge](https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge) — CE 端桥接
