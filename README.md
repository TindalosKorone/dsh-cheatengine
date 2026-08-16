# @dsh-external/dsh-cheatengine

Cheat Engine bridge toolkit：让 DSH Agent 通过 `ce_*` 工具调用 Cheat Engine 进行动态调试（附加进程、内存扫描、读写/冻结、反汇编、断点、寄存器、Lua 脚本等）。

## 架构

```
┌─────────────────────────────┐      TCP 长度前缀帧 (JSON-RPC 2.0)      ┌────────────────────────────┐
│ Cheat Engine (Windows)      │ ◄──────────────────────────────────────► │ DSH (Node.js 插件)          │
│  ce_mcp_bridge.lua          │       uint32 LE len + JSON body          │  CEClient + ce_* 工具        │
│  + ce_mcp_tcp_x64.dll       │      默认 127.0.0.1:17171               │  ctx.tools.register          │
└─────────────────────────────┘                                          └────────────────────────────┘
```

- CE 端桥接基于 [HollyZoe/cheatengine-mcp-tcp-bridge](https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge)（`ce_mcp_bridge.lua` + 原生 TCP DLL）。
- DSH 端插件是纯 Node.js TCP client，不依赖 Python MCP Server，直接说 CE bridge 的 JSON-RPC 协议。

## 工具列表（30 个，默认常驻 3 个）

| 类别 | 工具 |
|---|---|
| 连接/状态（常驻） | `ce_status`, `ce_connect` |
| 按需解锁（常驻） | `ce_tool_search` |
| 进程/模块 | `ce_list_processes`, `ce_attach`, `ce_process_info`, `ce_enum_modules` |
| 扫描/搜索 | `ce_scan`, `ce_next_scan`, `ce_get_scan_results`, `ce_aob_scan`, `ce_search_string` |
| 内存读取 | `ce_read_memory`, `ce_read_integer`, `ce_read_string`, `ce_read_pointer_chain` |
| 内存写入（危险） | `ce_write_integer`, `ce_write_memory`, `ce_write_string` |
| 反汇编/分析 | `ce_disassemble`, `ce_get_instruction_info` |
| 断点/调试（危险） | `ce_set_breakpoint`, `ce_set_data_breakpoint`, `ce_list_breakpoints`, `ce_remove_breakpoint`, `ce_get_breakpoint_hits`, `ce_clear_breakpoints`, `ce_get_registers` |
| 高级脚本（危险） | `ce_execute_lua`, `ce_auto_assemble` |

## 工具暴露策略（渐进披露）

为避免 30 个工具一次性进入模型上下文导致 token 开销和注意力分散，插件采用 DSH 官方 `anchored-standard` 推荐的**按需解锁**模式：

- 默认模型只看到 `ce_status`、`ce_connect`、`ce_tool_search` 三个常驻工具。
- Agent 需要其他能力时，先调用 `ce_tool_search({"query": "scan"})` 搜索完整目录，再调用 `ce_tool_search({"toolNames": ["ce_scan"]})` 解锁。
- 解锁记录来自持久化的 `tool/call` 事件，**从下一个请求开始生效**，并在会话内保持。
- 危险工具（写内存/断点/脚本）默认不可见，必须显式解锁，降低误操作风险。

## 部署

### 1. CE 端（Windows）

1. 下载/克隆 [cheatengine-mcp-tcp-bridge](https://github.com/HollyZoe/cheatengine-mcp-tcp-bridge)。
2. 把 `MCP_Server/ce_mcp_tcp_x64.dll`（64 位 CE）或 `ce_mcp_tcp_x86.dll`（32 位 CE）复制到 Cheat Engine 安装目录。
3. 打开 Cheat Engine，**先附加到目标进程**。
4. `File → Execute Script`，打开并执行 `MCP_Server/ce_mcp_bridge.lua`。
5. 看到 `Bridge started on port 17171` 即成功。

> 也可通过 Lua 控制台执行：`dofile([[C:\path\to\ce_mcp_bridge.lua]])`。

### 2. DSH 端

已注入当前环境后，插件会注册全部 `ce_*` 工具，但默认只向 Agent 暴露 `ce_status`、`ce_connect`、`ce_tool_search`。默认连接 `127.0.0.1:17171`，可通过插件配置或 `ce_connect` 覆盖。

## 安全提示

- `ce_write_*`、`ce_set_*breakpoint`、`ce_execute_lua`、`ce_auto_assemble` 属于**危险操作**，工具描述已标注。
- CE bridge 的 TCP 端口默认**无认证/无加密**，请勿暴露到公网或不可信网络。
- 仅在你有权限调试的目标进程上使用。

## 开发与构建

插件核心（`lib/`、`src/`）是纯 Node.js 实现，**不依赖 bash/pwsh**，在 Linux/macOS/Windows 上运行一致。只有“构建/链接依赖”环节涉及平台差异，见下方说明。

当前 `lib/` 是可直接运行的 JS 产物，仓库已包含它，PC 端 clone 后无需构建即可注入。

### 有 DSH checkout 的环境（容器/Linux）

```bash
DSH_CHECKOUT=/path/to/dsh-harness bash scripts/build.sh
# 注入器环境内
dev_build_plugin {"dir": "/root/dsh-cheatengine"}
dev_inject_plugin {"dir": "/root/dsh-cheatengine"}
```

### Windows / PowerShell 环境

如果 PC 上没有 bash（只有 PowerShell），用跨平台 Node 构建脚本代替 `build.sh`：

```powershell
$env:DSH_CHECKOUT="C:\path\to\dsh-harness"
npm run build
# 或直接：
node scripts/build.mjs
```

没有 DSH checkout 时，`build.mjs` 会检测到 `lib/` 已存在并跳过编译；`npm run build` 仍可完成打包：

```powershell
npm run build
# 产物：dsh-external-dsh-cheatengine-<version>.tgz
```

> `dev_build_plugin` 内部固定调用 `bash scripts/build.sh`，所以在无 bash 的 Windows 上请直接使用 `npm run build`，然后手动 `dev_inject_plugin` 指向本目录。

### 手动链接 `@deepseek-ai/dsh-tools`（仅在无 checkout 且运行时缺依赖时需要）

Linux/macOS：

```bash
mkdir -p node_modules/@deepseek-ai
ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools node_modules/@deepseek-ai/dsh-tools
```

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force -Path node_modules\@deepseek-ai | Out-Null
New-Item -ItemType Junction -Path node_modules\@deepseek-ai\dsh-tools -Target C:\path\to\dsh\installation\node_modules\@deepseek-ai\dsh-tools
```

（把 `C:\path\to\dsh\installation` 换成你机器上 DSH 的实际安装路径。）
