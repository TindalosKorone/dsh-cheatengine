# AGENTS.md — dsh-cheatengine 使用规范

本文件给 DSH Agent 阅读。人类安装/排障请看 [README.md](README.md)。

## 这是什么

一个 Cheat Engine 桥接插件：让你通过 `ce_*` 工具远程控制 Windows 上的 Cheat Engine，进行进程附加、内存扫描/读写、反汇编、断点、寄存器查看、Lua/AA 脚本等动态调试。

## 使用流程（必须遵守）

1. **先连接**：调用 `ce_status` 检查桥接；未连接时调用 `ce_connect`。
2. **按需解锁**：默认你只能看到 `ce_status`、`ce_connect`、`ce_tool_search`。需要其他能力时：
   - `ce_tool_search({"query": "scan"})` 搜索可用工具；
   - `ce_tool_search({"toolNames": ["ce_scan"]})` 解锁精确工具。
   - 解锁从**下一请求**开始生效，会话内保持。
3. **不要用 bash/pwsh 代替 CE 工具**：读写内存、扫描、断点必须走 `ce_*` 工具，不要试图用 shell 或第三方命令绕过。

## 可解锁工具

- 进程：`ce_list_processes`, `ce_attach`, `ce_process_info`, `ce_enum_modules`, `ce_detect_engine`
- 扫描：`ce_scan`, `ce_next_scan`, `ce_get_scan_results`, `ce_aob_scan`, `ce_search_string`, `ce_pointer_scan`, `ce_scan_many`
- 读取：`ce_read_memory`, `ce_read_integer`, `ce_read_string`, `ce_read_pointer_chain`, `ce_read_many`
- 反汇编：`ce_disassemble`, `ce_get_instruction_info`
- 断点/调试：`ce_set_breakpoint`, `ce_set_data_breakpoint`, `ce_list_breakpoints`, `ce_remove_breakpoint`, `ce_get_breakpoint_hits`, `ce_clear_breakpoints`, `ce_get_registers`, `ce_find_what_writes`
- 锁定/冻结：`ce_lock_address`, `ce_unlock_address`, `ce_write_many`
- 游戏调试增强：`ce_detect_protection`, `ce_dump_module`, `ce_aob_generate`, `ce_speedhack`, `ce_cheat_table_save`, `ce_cheat_table_load`
- 工程化：`ce_session_stats`, `ce_budget_status`, `ce_cache_status`, `ce_forget`, `ce_hypothesis`, `ce_evidence`, `ce_playbook`, `ce_audit_log`, `ce_undo_last`, `ce_snapshot_save`, `ce_snapshot_load`, `ce_risk_levels`
- 危险（解锁前三思）：`ce_write_integer`, `ce_write_memory`, `ce_write_string`, `ce_execute_lua`, `ce_auto_assemble`, `install_ce_bridge`

## 安全

- 危险工具会修改目标进程内存或执行脚本，**仅在用户明确要求且你有权限时使用**。
- 默认连接 `127.0.0.1:17171`；远程/非信任网络不要使用。
