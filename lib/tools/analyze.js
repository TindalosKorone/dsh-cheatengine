export const analyzePointerDefs = [
    {
        name: 'ce_pointer_scan',
        description: '基础版指针扫描：从目标地址向上查找指向它的指针链（最多 max_depth 层）',
        method: 'ce_pointer_scan',
        dangerous: true,
        parameters: {
            address: { type: 'string', required: true, description: '目标地址' },
            max_depth: { type: 'integer', description: '最大层数，默认 3，最高 6' },
            max_results: { type: 'integer', description: '最多返回链数，默认 20' },
        },
        async execute(args, client) {
            const address = String(args.address || '').trim();
            const maxDepth = Math.min(Number(args.max_depth) || 3, 6);
            const maxResults = Math.min(Number(args.max_results) || 20, 100);
            if (!address)
                return { success: false, error: 'address is required' };
            const target = Number.parseInt(address.replace(/^0x/i, ''), 16);
            if (!Number.isFinite(target))
                return { success: false, error: 'invalid address' };
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const scanPointersTo = async (addr) => {
                const lua = [
                    `local target = ${addr}`,
                    `local ms = createMemScan()`,
                    `ms.firstScan(soExactValue, vtQword, rtRounded, string.format("%d", target), nil, 0, 0x7FFFFFFFFFFFFFFF, "+R", fsmNotAligned, "1", false, false, false, false)`,
                    `ms.waitTillDone()`,
                    `local fl = createFoundList(ms)`,
                    `fl.initialize()`,
                    `local out = {}`,
                    `for i=0, fl.Count-1 do`,
                    `  local a = tonumber(fl.getAddress(i), 16)`,
                    `  if a then out[#out+1] = string.format("%X", a) end`,
                    `end`,
                    `fl.destroy()`,
                    `ms.destroy()`,
                    `return table.concat(out, ",")`,
                ].join('\n');
                const res = await client.sendCommand('evaluate_lua', { code: lua });
                const text = res && typeof res.result === 'string' ? res.result : '';
                if (!text)
                    return [];
                return text.split(',').filter(Boolean).map((s) => Number.parseInt(s, 16)).filter((n) => Number.isFinite(n));
            };
            let chains = [[target]];
            for (let depth = 1; depth <= maxDepth; depth++) {
                const newChains = [];
                for (const chain of chains) {
                    const head = chain[0];
                    const ptrs = await scanPointersTo(head);
                    for (const ptr of ptrs) {
                        newChains.push([ptr, ...chain]);
                        if (newChains.length >= maxResults)
                            break;
                    }
                    if (newChains.length >= maxResults)
                        break;
                }
                chains = newChains;
                if (chains.length === 0)
                    break;
                await sleep(100);
            }
            const formatted = chains.slice(0, maxResults).map((chain) => chain.map((a) => '0x' + a.toString(16).toUpperCase()));
            return { success: true, target: address, max_depth: maxDepth, count: formatted.length, chains: formatted };
        },
    },
];
export const analyzeDefs = [
    {
        name: 'ce_cheat_table_save',
        description: '保存当前 Cheat Table 到 .CT 文件',
        method: 'save_table',
        parameters: {
            filename: { type: 'string', required: true, description: '保存路径，如 D:\\tables\\my.ct' },
            protect: { type: 'boolean', description: '是否加密/保护，默认 false' },
        },
    },
    {
        name: 'ce_cheat_table_load',
        description: '加载 .CT Cheat Table 文件',
        method: 'load_table',
        parameters: {
            filename: { type: 'string', required: true, description: '要加载的 .CT 文件路径' },
            merge: { type: 'boolean', description: '是否合并到当前表，默认 false' },
        },
    },
    {
        name: 'ce_speedhack',
        description: '设置 CE 变速齿轮速度（需要先在 CE 中启用 Speedhack）',
        method: 'ce_speedhack',
        dangerous: true,
        parameters: {
            speed: { type: 'number', required: true, description: '速度倍率，如 0.5、1.0、2.0' },
        },
        async execute(args, client) {
            const speed = Number(args.speed);
            if (!Number.isFinite(speed) || speed <= 0)
                return { success: false, error: 'speed must be a positive number', error_class: 'INVALID_ARGS' };
            const lua = [
                `if getAddressSafe("speedhack_wantedspeed") == nil then`,
                `  return "NOT_READY"`,
                `end`,
                `writeFloat("speedhack_wantedspeed", ${speed})`,
                `return "OK"`,
            ].join('\n');
            const res = await client.sendCommand('evaluate_lua', { code: lua });
            if (!res || res.success === false) {
                return { success: false, error: (res && res.error) || 'speedhack failed', error_class: 'BRIDGE_UNAVAILABLE' };
            }
            const status = String(res.result || '').trim();
            if (status === 'NOT_READY') {
                return { success: false, error: 'Speedhack is not ready (enable it in CE first)', error_class: 'NOT_READY' };
            }
            if (status !== 'OK') {
                return { success: false, error: `speedhack failed: ${status || 'unknown'}`, error_class: 'SPEEDHACK_FAILED' };
            }
            return { success: true, speed, status };
        },
    },
    {
        name: 'ce_dump_module',
        description: '把指定模块的内存转储到文件（用于离线分析/脱壳辅助）',
        method: 'ce_dump_module',
        dangerous: true,
        parameters: {
            module: { type: 'string', required: true, description: '模块名，如 GameAssembly.dll' },
            output: { type: 'string', required: true, description: '输出文件路径，如 D:\\dumps\\GameAssembly.bin' },
        },
        async execute(args, client) {
            const moduleName = String(args.module || '').trim();
            const output = String(args.output || '').trim();
            if (!moduleName || !output)
                return { success: false, error: 'module and output are required', error_class: 'INVALID_ARGS' };
            const info = await client.sendCommand('get_process_info', {});
            const mods = Array.isArray(info && info.modules) ? info.modules : [];
            const mod = mods.find((m) => String(m.name || '').toLowerCase() === moduleName.toLowerCase() || String(m.name || '').toLowerCase().includes(moduleName.toLowerCase()));
            if (!mod)
                return { success: false, error: `module ${moduleName} not found`, error_class: 'MODULE_NOT_FOUND' };
            const base = Number.parseInt(String(mod.address).replace(/^0x/i, ''), 16);
            const size = Number(mod.size);
            const lua = [
                `local base = ${base}`,
                `local size = ${size}`,
                `local f = io.open("${output.replace(/\\/g, '\\\\')}", "wb")`,
                `if not f then return "OPEN_FAILED" end`,
                `local chunk = 0x1000`,
                `for off = 0, size - 1, chunk do`,
                `  local len = math.min(chunk, size - off)`,
                `  local bytes = readBytes(base + off, len, true)`,
                `  if not bytes then f:close(); return "READ_FAILED" end`,
                `  f:write(string.char(table.unpack(bytes)))`,
                `end`,
                `f:close()`,
                `return "DUMPED"`,
            ].join('\n');
            const res = await client.sendCommand('evaluate_lua', { code: lua });
            if (!res || res.success === false) {
                return { success: false, error: (res && res.error) || 'dump failed', error_class: 'BRIDGE_UNAVAILABLE' };
            }
            const status = String(res.result || '').trim();
            if (status !== 'DUMPED') {
                return { success: false, error: `dump failed: ${status || 'unknown'}`, error_class: 'DUMP_FAILED', status };
            }
            return { success: true, module: mod.name, base: mod.address, size, output, status };
        },
    },
    {
        name: 'ce_aob_generate',
        description: '从指定地址读取字节并生成 AOB 特征码',
        method: 'ce_aob_generate',
        parameters: {
            address: { type: 'string', required: true, description: '起始地址，如 0x7FFEA2110000' },
            size: { type: 'integer', description: '读取字节数，默认 32' },
        },
        async execute(args, client) {
            const address = String(args.address || '').trim();
            const size = Math.min(Number(args.size) || 32, 256);
            if (!address)
                return { success: false, error: 'address is required', error_class: 'INVALID_ARGS' };
            const lua = [
                `local addr = getAddressSafe("${address}")`,
                `if not addr then return "INVALID_ADDRESS" end`,
                `local bytes = readBytes(addr, ${size}, true)`,
                `if not bytes then return "READ_FAILED" end`,
                `local parts = {}`,
                `for i = 1, #bytes do parts[i] = string.format("%02X", bytes[i]) end`,
                `return table.concat(parts, " ")`,
            ].join('\n');
            const res = await client.sendCommand('evaluate_lua', { code: lua });
            if (!res || res.success === false) {
                return { success: false, error: (res && res.error) || 'aob generate failed', error_class: 'BRIDGE_UNAVAILABLE' };
            }
            const raw = res && typeof res.result === 'string' ? res.result : '';
            const pattern = raw.trim();
            if (pattern === 'INVALID_ADDRESS' || pattern === 'READ_FAILED' || pattern === '') {
                return { success: false, error: `aob generate failed: ${pattern || 'empty result'}`, error_class: pattern === 'INVALID_ADDRESS' ? 'INVALID_ADDRESS' : 'READ_FAILED' };
            }
            return { success: true, address, size, pattern };
        },
    },
    {
        name: 'ce_detect_protection',
        description: '检测已加载的反作弊/保护模块（EasyAntiCheat/BattlEye/Denuvo/VMProtect/Themida 等）',
        method: 'ce_detect_protection',
        async execute(args, client) {
            const info = await client.sendCommand('get_process_info', {});
            if (!info || info.success === false)
                return info || { success: false, error: 'get_process_info failed', error_class: 'NO_PROCESS' };
            const mods = Array.isArray(info.modules) ? info.modules : [];
            const names = mods.map((m) => String(m.name || '').toLowerCase());
            const protections = [
                { name: 'EasyAntiCheat', patterns: ['easyanticheat', 'easyanticheat_eos'] },
                { name: 'BattlEye', patterns: ['battleye', 'beds.dll'] },
                { name: 'Vanguard', patterns: ['vgk.sys', 'vanguard'] },
                { name: 'Denuvo', patterns: ['denuvo'] },
                { name: 'VMProtect', patterns: ['vmprotect'] },
                { name: 'Themida', patterns: ['themida', 'winlicense'] },
                { name: 'XIGNCODE', patterns: ['xigncode'] },
            ];
            const detected = protections.filter((p) => p.patterns.some((pat) => names.some((n) => n.includes(pat))));
            return {
                success: true,
                process_name: info.process_name,
                process_id: info.process_id,
                risk: detected.length > 0 ? 'protected' : 'none',
                detected,
                module_count: mods.length,
            };
        },
    },
];
//# sourceMappingURL=analyze.js.map