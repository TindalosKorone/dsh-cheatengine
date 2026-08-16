export const searchDefs = [
    {
        name: 'ce_tool_search',
        description: [
            '搜索并按任务包解锁当前不可见的 ce_* / install_ce_bridge 工具。',
            '常驻工具：ce_status、ce_connect、ce_tool_search、ce_playbook、ce_mission。',
            '可用 packs 一次解锁一组（process/scan/memory/debug/lock/analyze/case/script/guide/all），也可用 toolNames 精确解锁。',
            '危险工具（写内存/断点/脚本）解锁后请谨慎使用。',
        ].join(' '),
        kind: 'search',
        method: 'ce_tool_search',
        parameters: {
            query: { type: 'string', description: '搜索关键词，如 "scan"、"read"、"breakpoint"' },
            packs: { type: 'array', items: { type: 'string' }, description: '任务包名数组，如 ["scan","memory"]；可用包：process/scan/memory/debug/lock/analyze/case/script/guide/all' },
            toolNames: { type: 'array', items: { type: 'string' }, description: '要解锁的精确工具名数组，如 ["ce_scan"]' },
        },
    },
];
//# sourceMappingURL=search.js.map