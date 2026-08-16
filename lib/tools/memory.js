import { pushUndo } from '../session.js';
import { session } from '../state.js';
export const memoryReadDefs = [
    {
        name: 'ce_read_memory',
        description: '读取指定地址的原始字节',
        method: 'read_memory',
        parameters: {
            address: { type: 'string', required: true, description: '十六进制地址，如 0x00401000' },
            size: { type: 'integer', description: '读取字节数，默认 256' },
        },
        mapParams: (args) => ({ ...args, size: Math.min(Number(args.size) || 256, 4096) }),
    },
    {
        name: 'ce_read_integer',
        description: '读取数值：byte|word|dword|qword|float|double',
        method: 'read_integer',
        parameters: {
            address: { type: 'string', required: true, description: '十六进制地址' },
            type: { type: 'string', description: '类型，默认 dword' },
        },
    },
    {
        name: 'ce_read_string',
        description: '读取字符串，支持 ascii/utf8/utf16le/raw',
        method: 'read_string',
        parameters: {
            address: { type: 'string', required: true, description: '十六进制地址' },
            max_length: { type: 'integer', description: '最大长度，默认 256' },
            encoding: { type: 'string', description: 'ascii|utf8|utf16le|raw，默认 utf8' },
        },
        mapParams: (args) => ({ ...args, max_length: Math.min(Number(args.max_length) || 256, 4096) }),
    },
    {
        name: 'ce_read_pointer_chain',
        description: '按多级指针链读取最终地址与值',
        method: 'read_pointer_chain',
        parameters: {
            base: { type: 'string', required: true, description: '基址，如模块基址' },
            offsets: { type: 'array', items: { type: 'string' }, description: '每级偏移，如 ["0x10", "0x20"]' },
        },
        mapParams: (args) => ({
            ...args,
            offsets: Array.isArray(args.offsets)
                ? args.offsets.map((o) => typeof o === 'string' ? Number.parseInt(o.replace(/^0x/i, ''), 16) : Number(o))
                : args.offsets,
        }),
    },
];
export const memoryWriteDefs = [
    {
        name: 'ce_write_integer',
        description: '写入数值到指定地址',
        method: 'write_integer',
        dangerous: true,
        parameters: {
            address: { type: 'string', required: true, description: '十六进制地址' },
            value: { type: 'number', required: true, description: '要写入的数值' },
            type: { type: 'string', description: 'byte|word|dword|qword|float|double，默认 dword' },
        },
        async execute(args, client) {
            const address = String(args.address || '').trim();
            const type = args.type || 'dword';
            const beforeRes = await client.sendCommand('read_integer', { address, type });
            const before = beforeRes && beforeRes.success !== false ? beforeRes.value : null;
            const res = await client.sendCommand('write_integer', { address, value: Number(args.value), type });
            if (res && res.success !== false) {
                pushUndo(session, { kind: 'write', address, type, before, after: Number(args.value), ts: Date.now() });
            }
            return res;
        },
    },
    {
        name: 'ce_write_memory',
        description: '写入原始字节到指定地址',
        method: 'write_memory',
        dangerous: true,
        parameters: {
            address: { type: 'string', required: true, description: '十六进制地址' },
            bytes: { type: 'array', items: { type: 'integer' }, required: true, description: '字节数组，如 [0x90, 0x90]' },
        },
        async execute(args, client) {
            const address = String(args.address || '').trim();
            const bytes = Array.isArray(args.bytes) ? args.bytes.map(Number) : [];
            if (!address || bytes.length === 0)
                return { success: false, error: 'address and bytes are required', error_class: 'INVALID_ARGS' };
            const readRes = await client.sendCommand('read_memory', { address, size: bytes.length });
            const before = readRes && readRes.success !== false && Array.isArray(readRes.bytes) ? readRes.bytes : null;
            const res = await client.sendCommand('write_memory', { address, bytes });
            if (res && res.success !== false) {
                pushUndo(session, { kind: 'write_memory', address, before, after: bytes, ts: Date.now() });
            }
            return res;
        },
    },
    {
        name: 'ce_write_string',
        description: '写入字符串到指定地址',
        method: 'write_string',
        dangerous: true,
        parameters: {
            address: { type: 'string', required: true, description: '十六进制地址' },
            value: { type: 'string', required: true, description: '要写入的字符串' },
            wide: { type: 'boolean', description: '是否宽字符 UTF-16，默认 false' },
        },
        async execute(args, client) {
            const address = String(args.address || '').trim();
            const value = String(args.value ?? '');
            const wide = !!args.wide;
            if (!address)
                return { success: false, error: 'address is required', error_class: 'INVALID_ARGS' };
            const maxLen = wide ? value.length * 2 : value.length;
            const readRes = await client.sendCommand('read_string', { address, max_length: maxLen, encoding: wide ? 'utf16le' : 'utf8' });
            const before = readRes && readRes.success !== false ? readRes.value : null;
            const res = await client.sendCommand('write_string', { address, value, wide });
            if (res && res.success !== false) {
                pushUndo(session, { kind: 'write_string', address, before, after: value, wide, ts: Date.now() });
            }
            return res;
        },
    },
];
export const memoryManyDefs = [
    {
        name: 'ce_read_many',
        description: '批量读取多个地址的数值',
        method: 'ce_read_many',
        parameters: {
            addresses: { type: 'array', items: { type: 'string' }, required: true, description: '地址数组，如 ["0x1000","0x2000"]' },
            type: { type: 'string', description: 'byte|word|dword|qword|float|double，默认 dword' },
            max_results: { type: 'integer', description: '最多返回条数，默认 50，最大 200' },
        },
        async execute(args, client) {
            let addresses = Array.isArray(args.addresses) ? args.addresses.map(String) : [];
            if (addresses.length === 0)
                return { success: false, error: 'addresses is required', error_class: 'INVALID_ARGS' };
            const maxResults = Math.min(Number(args.max_results) || 50, 200);
            const truncated = addresses.length > maxResults;
            addresses = addresses.slice(0, maxResults);
            const type = args.type || 'dword';
            const results = [];
            for (const address of addresses) {
                const res = await client.sendCommand('read_integer', { address, type });
                results.push({ address, value: res?.value ?? null, success: !!(res && res.success !== false) });
            }
            return { success: true, type, results, truncated };
        },
    },
    {
        name: 'ce_write_many',
        description: '批量写入多个地址的数值（危险）',
        method: 'ce_write_many',
        dangerous: true,
        parameters: {
            addresses: { type: 'array', items: { type: 'string' }, required: true, description: '地址数组' },
            values: { type: 'array', items: { type: 'number' }, required: true, description: '值数组，与 addresses 一一对应' },
            type: { type: 'string', description: 'byte|word|dword|qword|float|double，默认 dword' },
            max_results: { type: 'integer', description: '最多处理/返回条数，默认 50，最大 200' },
        },
        async execute(args, client) {
            let addresses = Array.isArray(args.addresses) ? args.addresses.map(String) : [];
            const values = Array.isArray(args.values) ? args.values.map(Number) : [];
            if (addresses.length === 0 || addresses.length !== values.length) {
                return { success: false, error: 'addresses and values must be non-empty arrays of same length', error_class: 'INVALID_ARGS' };
            }
            const maxResults = Math.min(Number(args.max_results) || 50, 200);
            const truncated = addresses.length > maxResults;
            addresses = addresses.slice(0, maxResults);
            const type = args.type || 'dword';
            const results = [];
            for (let i = 0; i < addresses.length; i++) {
                const beforeRes = await client.sendCommand('read_integer', { address: addresses[i], type });
                const before = beforeRes && beforeRes.success !== false ? beforeRes.value : null;
                const res = await client.sendCommand('write_integer', { address: addresses[i], value: values[i], type });
                results.push({ address: addresses[i], value: values[i], success: !!(res && res.success !== false) });
                if (res && res.success !== false) {
                    pushUndo(session, { kind: 'write', address: addresses[i], type, before, after: values[i], ts: Date.now() });
                }
            }
            return { success: true, type, results, truncated };
        },
    },
];
export const memoryUnifiedDefs = [
    {
        name: 'ce_memory_read',
        description: '统一内存读取：用 mode 选择 integer/memory/string/pointer_chain/many',
        method: 'ce_memory_read',
        parameters: {
            mode: { type: 'string', description: 'integer|memory|string|pointer_chain|many，默认 integer' },
            address: { type: 'string', description: '地址（integer/memory/string 使用）' },
            type: { type: 'string', description: '整数类型（integer/many 使用，默认 dword）' },
            size: { type: 'integer', description: '字节数（memory 使用，默认 256，最大 4096）' },
            max_length: { type: 'integer', description: '最大长度（string 使用，默认 256，最大 4096）' },
            encoding: { type: 'string', description: 'ascii|utf8|utf16le|raw（string 使用，默认 utf8）' },
            base: { type: 'string', description: '基址（pointer_chain 使用）' },
            offsets: { type: 'array', items: { type: 'string' }, description: '偏移数组（pointer_chain 使用）' },
            addresses: { type: 'array', items: { type: 'string' }, description: '地址数组（many 使用）' },
            max_results: { type: 'integer', description: '最多返回条数（many 使用，默认 50，最大 200）' },
        },
        async execute(args, client) {
            const mode = args.mode || 'integer';
            if (mode === 'integer')
                return client.sendCommand('read_integer', { address: args.address, type: args.type || 'dword' });
            if (mode === 'memory')
                return client.sendCommand('read_memory', { address: args.address, size: Math.min(Number(args.size) || 256, 4096) });
            if (mode === 'string')
                return client.sendCommand('read_string', { address: args.address, max_length: Math.min(Number(args.max_length) || 256, 4096), encoding: args.encoding || 'utf8' });
            if (mode === 'pointer_chain') {
                const offsets = Array.isArray(args.offsets)
                    ? args.offsets.map((o) => typeof o === 'string' ? Number.parseInt(o.replace(/^0x/i, ''), 16) : Number(o))
                    : [];
                return client.sendCommand('read_pointer_chain', { base: args.base, offsets });
            }
            if (mode === 'many') {
                const addresses = Array.isArray(args.addresses) ? args.addresses.map(String) : [];
                if (addresses.length === 0)
                    return { success: false, error: 'addresses is required', error_class: 'INVALID_ARGS' };
                const maxResults = Math.min(Number(args.max_results) || 50, 200);
                const results = [];
                for (const address of addresses.slice(0, maxResults)) {
                    const res = await client.sendCommand('read_integer', { address, type: args.type || 'dword' });
                    results.push({ address, value: res?.value ?? null, success: !!(res && res.success !== false) });
                }
                return { success: true, type: args.type || 'dword', results, truncated: addresses.length > maxResults };
            }
            return { success: false, error: `unsupported mode: ${mode}`, error_class: 'INVALID_ARGS' };
        },
    },
    {
        name: 'ce_memory_write',
        description: '统一内存写入：用 mode 选择 integer/memory/string/many（危险）',
        method: 'ce_memory_write',
        dangerous: true,
        parameters: {
            mode: { type: 'string', description: 'integer|memory|string|many，默认 integer' },
            address: { type: 'string', description: '地址（integer/memory/string 使用）' },
            value: { type: 'number', description: '要写入的数值（integer 使用）' },
            type: { type: 'string', description: '整数类型（integer/many 使用，默认 dword）' },
            bytes: { type: 'array', items: { type: 'integer' }, description: '字节数组（memory 使用）' },
            text: { type: 'string', description: '要写入的字符串（string 使用）' },
            wide: { type: 'boolean', description: '是否宽字符 UTF-16（string 使用，默认 false）' },
            addresses: { type: 'array', items: { type: 'string' }, description: '地址数组（many 使用）' },
            values: { type: 'array', items: { type: 'number' }, description: '值数组（many 使用）' },
            max_results: { type: 'integer', description: '最多处理/返回条数（many 使用，默认 50，最大 200）' },
        },
        async execute(args, client) {
            const mode = args.mode || 'integer';
            if (mode === 'integer') {
                const address = String(args.address || '').trim();
                const type = args.type || 'dword';
                if (!address || !Number.isFinite(Number(args.value)))
                    return { success: false, error: 'address and value are required', error_class: 'INVALID_ARGS' };
                const beforeRes = await client.sendCommand('read_integer', { address, type });
                const before = beforeRes && beforeRes.success !== false ? beforeRes.value : null;
                const res = await client.sendCommand('write_integer', { address, value: Number(args.value), type });
                if (res && res.success !== false)
                    pushUndo(session, { kind: 'write', address, type, before, after: Number(args.value), ts: Date.now() });
                return res;
            }
            if (mode === 'memory') {
                const address = String(args.address || '').trim();
                const bytes = Array.isArray(args.bytes) ? args.bytes.map(Number) : [];
                if (!address || bytes.length === 0)
                    return { success: false, error: 'address and bytes are required', error_class: 'INVALID_ARGS' };
                const readRes = await client.sendCommand('read_memory', { address, size: bytes.length });
                const before = readRes && readRes.success !== false && Array.isArray(readRes.bytes) ? readRes.bytes : null;
                const res = await client.sendCommand('write_memory', { address, bytes });
                if (res && res.success !== false)
                    pushUndo(session, { kind: 'write_memory', address, before, after: bytes, ts: Date.now() });
                return res;
            }
            if (mode === 'string') {
                const address = String(args.address || '').trim();
                const text = String(args.text ?? '');
                const wide = !!args.wide;
                if (!address)
                    return { success: false, error: 'address is required', error_class: 'INVALID_ARGS' };
                const maxLen = wide ? text.length * 2 : text.length;
                const readRes = await client.sendCommand('read_string', { address, max_length: maxLen, encoding: wide ? 'utf16le' : 'utf8' });
                const before = readRes && readRes.success !== false ? readRes.value : null;
                const res = await client.sendCommand('write_string', { address, value: text, wide });
                if (res && res.success !== false)
                    pushUndo(session, { kind: 'write_string', address, before, after: text, wide, ts: Date.now() });
                return res;
            }
            if (mode === 'many') {
                let addresses = Array.isArray(args.addresses) ? args.addresses.map(String) : [];
                const values = Array.isArray(args.values) ? args.values.map(Number) : [];
                if (addresses.length === 0 || addresses.length !== values.length) {
                    return { success: false, error: 'addresses and values must be non-empty arrays of same length', error_class: 'INVALID_ARGS' };
                }
                const maxResults = Math.min(Number(args.max_results) || 50, 200);
                const truncated = addresses.length > maxResults;
                addresses = addresses.slice(0, maxResults);
                const type = args.type || 'dword';
                const results = [];
                for (let i = 0; i < addresses.length; i++) {
                    const beforeRes = await client.sendCommand('read_integer', { address: addresses[i], type });
                    const before = beforeRes && beforeRes.success !== false ? beforeRes.value : null;
                    const res = await client.sendCommand('write_integer', { address: addresses[i], value: values[i], type });
                    results.push({ address: addresses[i], value: values[i], success: !!(res && res.success !== false) });
                    if (res && res.success !== false)
                        pushUndo(session, { kind: 'write', address: addresses[i], type, before, after: values[i], ts: Date.now() });
                }
                return { success: true, type, results, truncated };
            }
            return { success: false, error: `unsupported mode: ${mode}`, error_class: 'INVALID_ARGS' };
        },
    },
];
//# sourceMappingURL=memory.js.map