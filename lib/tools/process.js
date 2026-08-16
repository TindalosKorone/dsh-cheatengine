export const processDefs = [
    {
        name: 'ce_list_processes',
        description: '列出系统进程（PID+名称），供附加选择',
        method: 'get_process_list',
        parameters: {
            limit: { type: 'integer', description: '返回数量，默认 100' },
        },
        mapResult: (result, args) => {
            if (!result || !Array.isArray(result.processes))
                return result;
            const limit = Math.min(Number(args.limit) || 100, 1000);
            const processes = result.processes.slice(0, limit);
            return { ...result, processes, total: result.processes.length, returned: processes.length };
        },
    },
    {
        name: 'ce_attach',
        description: '附加到指定进程（进程名或 PID），后续读写/扫描作用于该进程',
        method: 'open_process',
        parameters: {
            process_id_or_name: {
                type: 'string',
                required: true,
                description: '进程名（如 game.exe）或十进制 PID',
            },
        },
    },
    {
        name: 'ce_process_info',
        description: '获取当前已附加进程的 PID、名称、模块数与架构',
        method: 'get_process_info',
    },
    {
        name: 'ce_enum_modules',
        description: '列出已附加进程加载的模块（DLL/EXE 基址和大小）',
        method: 'enum_modules',
        parameters: {
            offset: { type: 'integer', description: '分页偏移，默认 0' },
            limit: { type: 'integer', description: '返回数量，默认 100' },
        },
        mapParams: (args) => ({
            ...args,
            offset: Math.max(0, Number(args.offset) || 0),
            limit: Math.min(Number(args.limit) || 100, 1000),
        }),
    },
];
export const processExtraDefs = [
    {
        name: 'ce_detect_engine',
        description: '识别当前附加进程的常见游戏引擎（Unity/Unreal/Godot/Source 等）',
        method: 'ce_detect_engine',
        async execute(args, client) {
            const info = await client.sendCommand('get_process_info', {});
            if (!info || info.success === false)
                return info || { success: false, error: 'get_process_info failed' };
            const mods = Array.isArray(info.modules) ? info.modules.map((m) => String(m.name || '').toLowerCase()) : [];
            const detect = (names) => names.some((n) => mods.some((m) => m.includes(n)));
            let engine = 'unknown';
            if (detect(['unityplayer.dll', 'gameassembly.dll', 'mono-2.0-bdwgc.dll']))
                engine = 'Unity';
            else if (detect(['unrealengine', 'ue4-', 'ue5-', 'unreal']))
                engine = 'Unreal Engine';
            else if (detect(['godot']))
                engine = 'Godot';
            else if (detect(['engine.dll', 'source2', 'vphysics']))
                engine = 'Source/Source2';
            return { success: true, process_name: info.process_name, process_id: info.process_id, engine, modules: info.modules };
        },
    },
];
//# sourceMappingURL=process.js.map