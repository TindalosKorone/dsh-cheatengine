import type { CEClient } from '../ce-client.js'
import type { ToolDef } from './types.js'

export function createResidentDefs(client: CEClient): ToolDef[] {
  return [
    {
      name: 'ce_status',
      description: '检查与 Cheat Engine 桥接的连接，返回版本与当前附加进程信息',
      method: 'ping',
    },
    {
      name: 'ce_connect',
      description: '连接/重连 Cheat Engine 桥接，可指定 host/port，返回 ping 结果',
      method: 'ping',
      parameters: {
        host: { type: 'string', description: 'CE 桥接主机，默认 127.0.0.1' },
        port: { type: 'integer', description: 'CE 桥接端口，默认 17171' },
      },
      mapParams: (args) => {
        if (args.host || args.port) {
          client.configure(String(args.host || '127.0.0.1'), Number(args.port || 17171))
        }
        return {}
      },
    },
  ]
}

export const playbookDefs: ToolDef[] = [
  {
    name: 'ce_playbook',
    description: '返回针对常见调试任务的推荐方法论（建议而非强制，Agent 可自行组合工具）',
    method: 'ce_playbook',
    parameters: {
      task: { type: 'string', description: 'overview|find_value|find_base|lock_value|verify_address，默认 overview' },
      engine: { type: 'string', description: '可选：unity|ue|godot|unknown，用于给引擎相关建议' },
    },
    async execute(args: any) {
      const task = args.task || 'overview'
      const engine = args.engine || ''
      const playbooks: Record<string, any> = {
        overview: {
          summary: '先确认环境，再根据目标选择路线。',
          phases: [
            { name: '环境确认', tools: ['ce_status', 'ce_connect', 'ce_process_info', 'ce_detect_engine'], note: '确认 CE 已附加目标进程' },
            { name: '选择路线', tools: ['ce_playbook'], note: '根据任务类型选择 find_value / find_base / lock_value' },
          ],
        },
        find_value: {
          summary: '定位一个会变化的内存数值。',
          phases: [
            { name: '初次扫描', tools: ['ce_scan'], decision: '如果候选过多，尝试 float/double/word/qword', stop_condition: '三种类型都为 0 → 停止，可能不是普通内存数值' },
            { name: '过滤变化', tools: ['ce_next_scan'], decision: '使用 exact / increased / decreased / changed', stop_condition: '候选为 1 → 进入验证' },
            { name: '验证', tools: ['ce_read_integer', 'ce_write_integer'], decision: '直接写入是否生效？不生效找写入者', stop_condition: '写入不生效 → ce_find_what_writes' },
            { name: '稳定化', tools: ['ce_pointer_scan', 'ce_lock_address'], note: '需要稳定地址再做指针扫描' },
          ],
        },
        find_base: {
          summary: '从动态地址向上找稳定基址/指针链。',
          phases: [
            { name: '定位当前地址', tools: ['ce_scan', 'ce_next_scan', 'ce_find_what_writes'], note: '先拿到一个可用的动态地址' },
            { name: '指针扫描', tools: ['ce_pointer_scan'], decision: '从目标地址向上找指针链', stop_condition: '5 层内无静态指针 → 大概率没有稳定基址' },
            { name: '验证链', tools: ['ce_read_pointer_chain', 'ce_write_integer'], note: '用链读取/写入验证' },
          ],
        },
        lock_value: {
          summary: '把某个地址锁定为指定值。',
          phases: [
            { name: '确认地址', tools: ['ce_read_integer'], note: '确认地址当前值' },
            { name: '锁定', tools: ['ce_lock_address'], note: '设置锁定值和间隔' },
            { name: '验证', tools: ['ce_read_integer', 'ce_session_stats'], note: '确认锁定后值不变' },
          ],
        },
        verify_address: {
          summary: '验证一个地址是否真实控制目标数值。',
          phases: [
            { name: '读取', tools: ['ce_read_integer'], note: '确认地址值' },
            { name: '写入测试', tools: ['ce_write_integer'], decision: '游戏显示是否变化？', stop_condition: '没变化 → 可能是显示副本，用 ce_find_what_writes' },
            { name: '写入断点', tools: ['ce_find_what_writes'], note: '找到真正写入者' },
          ],
        },
      }
      const pb = playbooks[task] || playbooks.overview
      if (engine) pb.engine_note = engine === 'unity' ? 'Unity/IL2CPP 优先尝试 float/double，注意 UI 显示副本。' : engine === 'ue' ? 'UE 通常需要指针链，动态堆较多。' : engine === 'godot' ? 'Godot 脚本值可能在 VM 堆中。' : ''
      return { success: true, task, playbook: pb }
    },
  },
]

export const missionDefs: ToolDef[] = [
  {
    name: 'ce_mission',
    description: '任务入口：根据目标返回推荐工具序列、当前阶段与停止条件（建议而非强制）',
    method: 'ce_mission',
    parameters: {
      goal: { type: 'string', required: true, description: 'detect_environment|find_value|find_base|lock_value|verify_address' },
      current_value: { type: 'integer', description: '当前数值（可选）' },
      engine: { type: 'string', description: 'unity|ue|godot|unknown（可选）' },
      phase: { type: 'string', description: 'idle|scanning|filtering|verifying|tracing|locked（可选）' },
    },
    async execute(args: any) {
      const goal = args.goal || 'detect_environment'
      const phase = args.phase || 'idle'
      const missions: Record<string, any> = {
        detect_environment: {
          phases: ['ce_connect', 'ce_process_info', 'ce_detect_engine', 'ce_detect_protection'],
          next_action: '确认 CE 已附加目标进程后进入 find_value 或 find_base',
          stop_condition: '无法连接或未附加进程时停止',
        },
        find_value: {
          phases: ['ce_scan', 'ce_next_scan', 'ce_get_scan_results', 'ce_read_integer', 'ce_write_integer', 'ce_find_what_writes'],
          next_action: phase === 'idle' ? '先用 ce_scan 扫描当前值' : phase === 'scanning' ? '让用户改变数值后 ce_next_scan' : phase === 'filtering' ? '候选少时 ce_get_scan_results 并验证' : '继续验证或找写入者',
          stop_condition: '多种类型均为 0 → 停止；写入不生效 → 找写入者',
        },
        find_base: {
          phases: ['ce_scan', 'ce_find_what_writes', 'ce_pointer_scan', 'ce_read_pointer_chain'],
          next_action: '先拿到一个动态地址，再 ce_pointer_scan',
          stop_condition: '5 层内无静态指针 → 报告无稳定基址',
        },
        lock_value: {
          phases: ['ce_read_integer', 'ce_lock_address', 'ce_read_integer', 'ce_session_stats'],
          next_action: '确认地址后 ce_lock_address',
          stop_condition: '锁定后值仍变化 → 可能锁的是显示副本',
        },
        verify_address: {
          phases: ['ce_read_integer', 'ce_write_integer', 'ce_find_what_writes'],
          next_action: '先读，再写测试',
          stop_condition: '写入不生效 → 显示副本',
        },
      }
      const mission = missions[goal] || missions.detect_environment
      if (args.engine === 'unity') mission.engine_note = 'Unity/IL2CPP 优先尝试 float/double，注意 UI 显示副本。'
      return { success: true, goal, phase, mission }
    },
  },
  {
    name: 'ce_explain_scan_result',
    description: '解释一次扫描结果（count/type），给出下一步建议',
    method: 'ce_explain_scan_result',
    parameters: {
      count: { type: 'integer', required: true, description: '扫描返回的匹配数量' },
      type: { type: 'string', description: '扫描类型，如 dword/float/double' },
    },
    async execute(args: any) {
      const count = Number(args.count) || 0
      const type = args.type || 'dword'
      let interpretation: string
      let suggestion: string
      if (count === 0) {
        interpretation = '没有找到匹配。'
        suggestion = '尝试其他类型（float/double/word/qword），或改用 ce_find_what_writes。'
      } else if (count <= 10) {
        interpretation = '候选很少，非常适合逐个验证。'
        suggestion = '使用 ce_get_scan_results 读取候选并逐个写入测试。'
      } else if (count <= 1000) {
        interpretation = '候选较多，需要继续过滤。'
        suggestion = '让用户改变数值后用 ce_next_scan 精确过滤，或使用分页读取前若干。'
      } else {
        interpretation = '候选非常多，当前扫描太宽。'
        suggestion = '尝试更精确的扫描类型/保护范围，或改用 unknown initial value + changed。'
      }
      return { success: true, count, type, interpretation, suggestion }
    },
  },
]
