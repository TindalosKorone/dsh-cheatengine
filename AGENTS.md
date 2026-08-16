# AGENTS.md — dsh-cheatengine 使用规范

本文件给 DSH Agent 阅读。人类安装/排障请看 [README.md](README.md)。

## 这是什么

一个 Cheat Engine 桥接插件：让你通过 `ce_*` 工具远程控制 Windows 上的 Cheat Engine，进行进程附加、内存扫描/读写、反汇编、断点、寄存器查看、Lua/AA 脚本等动态调试。

## 注意：Token 消耗

- 本插件会向模型目录注册大量 `ce_*` 工具，**增加每次请求的 token 消耗**。
- 默认只暴露 `ce_status`、`ce_connect`、`ce_tool_search`、`ce_playbook`、`ce_mission`；请按需解锁，不要一次性全开。
- 解锁越多工具，后续请求的上下文越大；长时间调试时留意预算。

## 使用流程（必须遵守）

1. **先连接**：调用 `ce_status` 检查桥接；未连接时调用 `ce_connect`。
2. **按需解锁**：默认常驻 `ce_status`、`ce_connect`、`ce_tool_search`、`ce_playbook`、`ce_mission`。需要其他能力时：
   - `ce_tool_search({"query": "scan"})` 搜索可用工具；
   - `ce_tool_search({"packs": ["scan", "memory"]})` 按任务包解锁一组工具；
   - `ce_tool_search({"toolNames": ["ce_scan"]})` 精确解锁单个工具。
   - 解锁从**下一请求**开始生效，会话内保持。
3. **不要用 bash/pwsh 代替 CE 工具**：读写内存、扫描、断点必须走 `ce_*` 工具，不要试图用 shell 或第三方命令绕过。

## 可解锁工具

**统一工具（推荐优先使用）**
- `ce_memory_read`：一个工具读 integer / memory / string / pointer_chain / many
- `ce_memory_write`：一个工具写 integer / memory / string / many（危险）
- `ce_session`：一个工具查看 stats / budget / report / analyst

旧版 `ce_read_*`、`ce_write_*`、`ce_session_stats` 等仍保留为兼容，可通过 `toolNames` 精确解锁，但默认搜索/任务包不再展示它们。

- 进程：`ce_list_processes`, `ce_attach`, `ce_process_info`, `ce_enum_modules`, `ce_detect_engine`
- 扫描：`ce_scan`, `ce_next_scan`, `ce_get_scan_results`, `ce_aob_scan`, `ce_search_string`, `ce_pointer_scan`, `ce_scan_many`
- 读取：`ce_read_memory`, `ce_read_integer`, `ce_read_string`, `ce_read_pointer_chain`, `ce_read_many`
- 反汇编：`ce_disassemble`, `ce_get_instruction_info`
- 断点/调试：`ce_set_breakpoint`, `ce_set_data_breakpoint`, `ce_list_breakpoints`, `ce_remove_breakpoint`, `ce_get_breakpoint_hits`, `ce_clear_breakpoints`, `ce_get_registers`, `ce_find_what_writes`
- 锁定/冻结：`ce_lock_address`, `ce_unlock_address`, `ce_write_many`
- 游戏调试增强：`ce_detect_protection`, `ce_dump_module`, `ce_aob_generate`, `ce_speedhack`, `ce_cheat_table_save`, `ce_cheat_table_load`
- 工程化：`ce_session_stats`, `ce_budget_status`, `ce_cache_status`, `ce_forget`, `ce_hypothesis`, `ce_evidence`, `ce_playbook`, `ce_audit_log`, `ce_undo_last`, `ce_snapshot_save`, `ce_snapshot_load`, `ce_risk_levels`
- 任务/解释/报告：`ce_mission`, `ce_explain_scan_result`, `ce_status_report`, `ce_analyst`
- 危险（解锁前三思）：`ce_write_integer`, `ce_write_memory`, `ce_write_string`, `ce_execute_lua`, `ce_auto_assemble`, `install_ce_bridge`


## 工具选择速查

| 目标 | 推荐工具 |
|---|---|
| 确认环境 | `ce_status`, `ce_connect`, `ce_process_info`, `ce_detect_engine` |
| 扫描数值 | `ce_scan`, `ce_next_scan`, `ce_get_scan_results` |
| 批量扫描 | `ce_scan_many` |
| 读取地址 | `ce_memory_read`（mode=integer/memory/string/many） |
| 写入/测试 | `ce_memory_write`（mode=integer/memory/string/many） |
| 找写入者 | `ce_find_what_writes` |
| 找稳定基址 | `ce_pointer_scan` |
| 锁定值 | `ce_lock_address` / `ce_unlock_address` |
| 保存/加载 CT | `ce_cheat_table_save` / `ce_cheat_table_load` |
| 检测保护 | `ce_detect_protection` |
| 转储/AOB | `ce_dump_module`, `ce_aob_generate` |
| 变速 | `ce_speedhack` |
| 记录假设/证据 | `ce_hypothesis`, `ce_evidence` |
| 查看会话/预算 | `ce_session`（action=stats/budget） |
| 撤销/审计 | `ce_undo_last`, `ce_audit_log` |

## 返回值与上限速查

| 工具 | 返回内容 | 上限 | 如何获取更多 |
|---|---|---|---|
| `ce_scan` | 只返回 `count`（匹配数量） | 无 | 用 `ce_get_scan_results` 拿地址 |
| `ce_get_scan_results` | 地址列表 + 当前值 | `limit` 默认 100，最大 1000 | 用 `offset` 翻页 |
| `ce_aob_scan` | 地址列表 + `count` | `limit` 默认 100，最大 1000 | `count > 返回数` 时需收紧 pattern 或后续支持 offset |
| `ce_search_string` | 地址列表 + `count` | `limit` 默认 100 | 同上 |
| `ce_pointer_scan` | 指针链数组 | `max_results` 默认 20，最大 100 | 调大 max_results 或换目标 |
| `ce_read_memory` | 原始字节文本 | `size` 默认 256，最大 4096 | 从 `address + size` 继续读 |
| `ce_disassemble` | 指令数组 | `count` 默认 20，最大 200 | 需要从下一条地址继续（后续补充 next_address） |
| `ce_get_breakpoint_hits` | 命中记录 | `limit` 默认 100 | 用 `offset` / `filter` |

**原则**：`ce_scan` 只给数量，不要等它返回地址；地址类工具都有分页或上限，不会一次性灌爆上下文。

- 任务入口：`ce_mission`
- 解释扫描结果：`ce_explain_scan_result`
- 人类可读报告：`ce_status_report`
- 调试总结：`ce_analyst`

## 安全

- 危险工具会修改目标进程内存或执行脚本，**仅在用户明确要求且你有权限时使用**。
- 默认连接 `127.0.0.1:17171`；远程/非信任网络不要使用。
