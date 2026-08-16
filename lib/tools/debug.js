export const debugDefs = [
    {
        name: 'ce_disassemble',
        description: '从指定地址反汇编 N 条指令',
        method: 'disassemble',
        parameters: {
            address: { type: 'string', required: true, description: '起始地址或符号' },
            count: { type: 'integer', description: '生成指令数，默认 20' },
            limit: { type: 'integer', description: '返回条数，默认 100' },
        },
        mapParams: (args) => ({ ...args, count: Math.min(Number(args.count) || 20, 200), limit: Math.min(Number(args.limit) || 100, 200) }),
    },
    {
        name: 'ce_get_instruction_info',
        description: '获取单条指令的详细信息（大小、字节、助记符）',
        method: 'get_instruction_info',
        parameters: {
            address: { type: 'string', required: true, description: '指令地址' },
        },
    },
    {
        name: 'ce_set_breakpoint',
        description: '设置执行断点（硬件），捕获寄存器/栈，不中断仅记录',
        method: 'set_breakpoint',
        dangerous: true,
        parameters: {
            address: { type: 'string', required: true, description: '断点地址' },
            id: { type: 'string', description: '自定义断点 ID' },
            capture_registers: { type: 'boolean', description: '是否捕获寄存器，默认 true' },
            capture_stack: { type: 'boolean', description: '是否捕获调用栈，默认 false' },
        },
    },
    {
        name: 'ce_set_data_breakpoint',
        description: '设置数据断点（读/写/访问），监控某地址被访问',
        method: 'set_data_breakpoint',
        dangerous: true,
        parameters: {
            address: { type: 'string', required: true, description: '监控地址' },
            access_type: { type: 'string', description: 'r|w|rw，默认 w' },
            size: { type: 'integer', description: '监控字节数，默认 4' },
            id: { type: 'string', description: '自定义断点 ID' },
        },
    },
    {
        name: 'ce_list_breakpoints',
        description: '列出所有活动断点',
        method: 'list_breakpoints',
        parameters: {
            limit: { type: 'integer', description: '返回数量，默认 100' },
        },
        mapResult: (result, args) => {
            if (!result || !Array.isArray(result.breakpoints))
                return result;
            const limit = Math.min(Number(args.limit) || 100, 1000);
            const breakpoints = result.breakpoints.slice(0, limit);
            return { ...result, breakpoints, total: result.breakpoints.length, returned: breakpoints.length };
        },
    },
    {
        name: 'ce_remove_breakpoint',
        description: '按 ID 移除断点',
        method: 'remove_breakpoint',
        dangerous: true,
        parameters: {
            id: { type: 'string', required: true, description: '断点 ID' },
        },
    },
    {
        name: 'ce_get_breakpoint_hits',
        description: '读取断点命中记录（含寄存器），可清空缓冲区',
        method: 'get_breakpoint_hits',
        parameters: {
            id: { type: 'string', description: '指定断点 ID，缺省全部' },
            clear: { type: 'boolean', description: '读取后是否清空，默认 false' },
            limit: { type: 'integer', description: '返回条数，默认 100' },
            offset: { type: 'integer', description: '跳过前 N 条，默认 0' },
            filter: { type: 'string', description: '寄存器过滤，如 RDI=1B5AD10F640（十六进制不带 0x）' },
        },
        mapParams: (args) => {
            const limit = Math.min(Number(args.limit) || 100, 1000);
            if (args.filter) {
                return { ...args, offset: 0, limit: Math.max(limit, 1000) };
            }
            return { ...args, limit };
        },
        mapResult: (result, args) => {
            if (!result || !Array.isArray(result.hits))
                return result;
            let hits = result.hits;
            let filteredCount = hits.length;
            if (args.filter) {
                const m = /^([A-Za-z0-9_]+)=([0-9A-Fa-f]+)$/.exec(args.filter);
                if (m) {
                    const reg = m[1].toUpperCase();
                    const val = m[2].toUpperCase();
                    hits = hits.filter((hit) => {
                        const r = hit && hit.registers ? hit.registers[reg] : undefined;
                        return r && r.toUpperCase().replace(/^0X/, '') === val;
                    });
                    filteredCount = hits.length;
                }
                const offset = Number(args.offset) || 0;
                const limit = Number(args.limit) || 100;
                hits = hits.slice(offset, offset + limit);
                return { ...result, hits, offset, limit, returned: hits.length, total: filteredCount };
            }
            return result;
        },
    },
    {
        name: 'ce_clear_breakpoints',
        description: '清除全部断点',
        method: 'clear_all_breakpoints',
        dangerous: true,
    },
    {
        name: 'ce_get_registers',
        description: '获取当前线程寄存器（RAX/RBX/... 或 EAX/EBX/...），含 XMM0-XMM15',
        method: 'evaluate_lua',
        mapParams: () => ({
            code: [
                'local parts = {}',
                'local function h(v) if v == nil then return "nil" end return string.format("%X", v) end',
                'if targetIs64Bit() then',
                '  parts[#parts+1] = string.format("RAX=%s RBX=%s RCX=%s RDX=%s RSI=%s RDI=%s RBP=%s RSP=%s RIP=%s R8=%s R9=%s R10=%s R11=%s R12=%s R13=%s R14=%s R15=%s EFLAGS=%s", h(RAX), h(RBX), h(RCX), h(RDX), h(RSI), h(RDI), h(RBP), h(RSP), h(RIP), h(R8), h(R9), h(R10), h(R11), h(R12), h(R13), h(R14), h(R15), h(EFLAGS))',
                'else',
                '  parts[#parts+1] = string.format("EAX=%s EBX=%s ECX=%s EDX=%s ESI=%s EDI=%s EBP=%s ESP=%s EIP=%s EFLAGS=%s", h(EAX), h(EBX), h(ECX), h(EDX), h(ESI), h(EDI), h(EBP), h(ESP), h(EIP), h(EFLAGS))',
                'end',
                'for i=0,15 do',
                '  local ok, ptr = pcall(debug_getXMMPointer, i)',
                '  if ok and ptr then',
                '    local b = readBytes(ptr, 16, true)',
                '    if b then',
                '      local hex = {}',
                '      for j=1,16 do hex[j] = string.format("%02X", b[j]) end',
                '      parts[#parts+1] = string.format("XMM%d=%s", i, table.concat(hex, " "))',
                '    end',
                '  end',
                'end',
                'return table.concat(parts, " ")',
            ].join('\n'),
        }),
    },
];
export const debugExtraDefs = [
    {
        name: 'ce_find_what_writes',
        description: '一键查找谁改写了指定地址：自动设写入断点、等待触发、返回 RIP/反汇编/寄存器',
        method: 'ce_find_what_writes',
        dangerous: true,
        parameters: {
            address: { type: 'string', required: true, description: '要监控的地址' },
            access_type: { type: 'string', description: 'r|w|rw，默认 w' },
            size: { type: 'integer', description: '监控字节数，默认 4' },
            timeout_ms: { type: 'integer', description: '等待超时毫秒，默认 15000' },
        },
        async execute(args, client) {
            const address = String(args.address || '').trim();
            if (!address)
                return { success: false, error: 'address is required' };
            const accessType = args.access_type || 'w';
            const size = Number(args.size) || 4;
            const timeoutMs = Number(args.timeout_ms) || 15000;
            const bpId = `find_${Date.now()}`;
            const setRes = await client.sendCommand('set_data_breakpoint', { address, access_type: accessType, size, id: bpId });
            if (!setRes || setRes.success === false)
                return setRes || { success: false, error: 'set_data_breakpoint failed' };
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                const hitsRes = await client.sendCommand('get_breakpoint_hits', { id: bpId, clear: false, limit: 10, offset: 0 });
                if (hitsRes && hitsRes.success !== false && Array.isArray(hitsRes.hits) && hitsRes.hits.length > 0) {
                    const hit = hitsRes.hits[0];
                    let disasm = [];
                    if (hit.registers && hit.registers.RIP) {
                        const disRes = await client.sendCommand('disassemble', { address: hit.registers.RIP, count: 20, limit: 20 });
                        if (disRes && Array.isArray(disRes.instructions))
                            disasm = disRes.instructions;
                    }
                    await client.sendCommand('remove_breakpoint', { id: bpId }).catch(() => { });
                    return { success: true, breakpoint_id: bpId, hit, disassembly: disasm };
                }
            }
            await client.sendCommand('remove_breakpoint', { id: bpId }).catch(() => { });
            return { success: false, error: `No write to ${address} within ${timeoutMs}ms`, breakpoint_id: bpId };
        },
    },
];
//# sourceMappingURL=debug.js.map