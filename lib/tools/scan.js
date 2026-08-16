export const scanDefs = [
    {
        name: 'ce_scan',
        description: '首次扫描内存：只返回匹配数量 count，具体地址用 ce_get_scan_results 分页读取',
        method: 'scan_all',
        parameters: {
            value: { type: 'string', required: true, description: '要搜索的值，如 "100"、"hello" 或 "48 89 5C"' },
            type: { type: 'string', description: 'byte|word|dword|qword|float|double|string，默认 dword（兼容旧值 exact→dword）' },
            protection: { type: 'string', description: '内存保护，默认 +W-C' },
        },
        mapParams: (args) => {
            const type = args.type || 'dword';
            const normalized = type === 'exact' ? 'dword' : type;
            return { ...args, type: normalized };
        },
    },
    {
        name: 'ce_next_scan',
        description: '在现有结果上继续扫描过滤（increased/decreased/changed/unchanged 等）',
        method: 'next_scan',
        parameters: {
            value: { type: 'string', required: true, description: '下一轮值' },
            scan_type: { type: 'string', description: 'exact|increased|decreased|changed|unchanged|bigger|smaller，默认 exact' },
        },
    },
    {
        name: 'ce_get_scan_results',
        description: '读取最近一次扫描的地址结果，支持分页',
        method: 'get_scan_results',
        parameters: {
            offset: { type: 'integer', description: '偏移，默认 0' },
            limit: { type: 'integer', description: '数量，默认 100' },
        },
        mapParams: (args) => ({ ...args, limit: Math.min(Number(args.limit) || 100, 1000) }),
    },
    {
        name: 'ce_aob_scan',
        description: 'AOB 特征码扫描，如 "48 89 5C 24 ?? 57"',
        method: 'aob_scan',
        parameters: {
            pattern: { type: 'string', required: true, description: '字节模式，支持 ?? 通配' },
            protection: { type: 'string', description: '内存保护，默认 +X' },
            limit: { type: 'integer', description: '最大返回数，默认 100' },
        },
        mapParams: (args) => ({ ...args, limit: Math.min(Number(args.limit) || 100, 1000) }),
    },
    {
        name: 'ce_search_string',
        description: '在内存中搜索文本字符串',
        method: 'search_string',
        parameters: {
            string: { type: 'string', required: true, description: '要搜索的字符串' },
            wide: { type: 'boolean', description: '是否宽字符 UTF-16，默认 false' },
            limit: { type: 'integer', description: '最大返回数，默认 100' },
        },
        mapParams: (args) => ({ ...args, limit: Math.min(Number(args.limit) || 100, 1000) }),
    },
];
export const scanExtraDefs = [
    {
        name: 'ce_scan_many',
        description: '批量扫描多个值，返回每个值的候选数（最后一次扫描会保留为当前扫描状态）',
        method: 'ce_scan_many',
        parameters: {
            values: { type: 'array', items: { type: 'string' }, required: true, description: '要扫描的值数组，如 ["100","200"]' },
            type: { type: 'string', description: 'byte|word|dword|qword|float|double|string，默认 dword' },
            protection: { type: 'string', description: '内存保护，默认 +W-C' },
        },
        async execute(args, client) {
            const values = Array.isArray(args.values) ? args.values.map(String) : [];
            if (values.length === 0)
                return { success: false, error: 'values is required', error_class: 'INVALID_ARGS' };
            const type = args.type || 'dword';
            const protection = args.protection || '+W-C';
            const results = [];
            for (const value of values) {
                const res = await client.sendCommand('scan_all', { value, type, protection });
                results.push({ value, count: res?.count ?? null, success: !!(res && res.success !== false) });
            }
            return { success: true, type, results };
        },
    },
];
//# sourceMappingURL=scan.js.map