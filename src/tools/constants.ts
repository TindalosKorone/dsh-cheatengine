/** Always-visible tools: connection status + on-demand discovery + guide. */
export const RESIDENT_TOOLS = new Set(['ce_status', 'ce_connect', 'ce_tool_search', 'ce_playbook', 'ce_mission'])
export const isOwnTool = (name: string) => name.startsWith('ce_') || name === 'install_ce_bridge'

/** Tools that have been merged into unified equivalents; kept for compat but hidden from packs/search. */
export const COMPAT_TOOLS = new Set([
  'ce_read_memory', 'ce_read_integer', 'ce_read_string', 'ce_read_pointer_chain', 'ce_read_many',
  'ce_write_integer', 'ce_write_memory', 'ce_write_string', 'ce_write_many',
  'ce_session_stats', 'ce_budget_status', 'ce_status_report', 'ce_analyst',
])

/** Task packs: unlock a coherent group of tools with one ce_tool_search call. */
export const TOOL_PACKS: Record<string, string[]> = {
  process: ['ce_list_processes', 'ce_attach', 'ce_process_info', 'ce_enum_modules', 'ce_detect_engine'],
  scan: ['ce_scan', 'ce_next_scan', 'ce_get_scan_results', 'ce_aob_scan', 'ce_search_string', 'ce_scan_many'],
  memory: ['ce_memory_read', 'ce_memory_write'],
  debug: ['ce_disassemble', 'ce_get_instruction_info', 'ce_set_breakpoint', 'ce_set_data_breakpoint', 'ce_list_breakpoints', 'ce_remove_breakpoint', 'ce_get_breakpoint_hits', 'ce_clear_breakpoints', 'ce_get_registers', 'ce_find_what_writes'],
  lock: ['ce_lock_address', 'ce_unlock_address'],
  analyze: ['ce_detect_protection', 'ce_dump_module', 'ce_aob_generate', 'ce_speedhack', 'ce_cheat_table_save', 'ce_cheat_table_load'],
  case: ['ce_session', 'ce_cache_status', 'ce_forget', 'ce_hypothesis', 'ce_evidence', 'ce_audit_log', 'ce_undo_last', 'ce_snapshot_save', 'ce_snapshot_load', 'ce_risk_levels'],
  script: ['ce_execute_lua', 'ce_auto_assemble', 'install_ce_bridge'],
  guide: ['ce_playbook', 'ce_mission', 'ce_explain_scan_result'],
  all: [
    'ce_list_processes', 'ce_attach', 'ce_process_info', 'ce_enum_modules', 'ce_detect_engine',
    'ce_scan', 'ce_next_scan', 'ce_get_scan_results', 'ce_aob_scan', 'ce_search_string', 'ce_scan_many',
    'ce_memory_read', 'ce_memory_write',
    'ce_disassemble', 'ce_get_instruction_info', 'ce_set_breakpoint', 'ce_set_data_breakpoint', 'ce_list_breakpoints',
    'ce_remove_breakpoint', 'ce_get_breakpoint_hits', 'ce_clear_breakpoints', 'ce_get_registers', 'ce_find_what_writes',
    'ce_lock_address', 'ce_unlock_address',
    'ce_detect_protection', 'ce_dump_module', 'ce_aob_generate', 'ce_speedhack', 'ce_cheat_table_save', 'ce_cheat_table_load',
    'ce_session', 'ce_cache_status', 'ce_forget', 'ce_hypothesis', 'ce_evidence',
    'ce_audit_log', 'ce_undo_last', 'ce_snapshot_save', 'ce_snapshot_load', 'ce_risk_levels',
    'ce_playbook', 'ce_mission', 'ce_explain_scan_result',
  ],
}
