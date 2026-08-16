# Agent Tool Reference — dsh-cheatengine

详细工具列表、速查表与上限。需要时再读取，避免常驻上下文膨胀。

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
| `ce_aob_scan` | 地址列表 + `count` | `limit` 默认 100，最大 1000 | `count > 返回数` 时需收紧 pattern |
| `ce_search_string` | 地址列表 + `count` | `limit` 默认 100，最大 1000 | 同上 |
| `ce_pointer_scan` | 指针链数组 | `max_results` 默认 20，最大 100 | 调大 max_results 或换目标 |
| `ce_read_memory` | 原始字节文本 | `size` 默认 256，最大 4096 | 从 `address + size` 继续读 |
| `ce_disassemble` | 指令数组 | `count` 默认 20，最大 200 | 从下一条地址继续 |
| `ce_get_breakpoint_hits` | 命中记录 | `limit` 默认 100，最大 1000 | 用 `offset` / `filter` |
| `ce_memory_read(many)` | 批量读取 | `max_results` 默认 50，最大 200 | 分批读取 |
| `ce_memory_write(many)` | 批量写入 | `max_results` 默认 50，最大 200 | 分批写入 |

**原则**：`ce_scan` 只给数量，不要等它返回地址；地址类工具都有分页或上限，不会一次性灌爆上下文。

- 任务入口：`ce_mission`
- 解释扫描结果：`ce_explain_scan_result`
- 人类可读报告：`ce_status_report`
- 调试总结：`ce_analyst`
