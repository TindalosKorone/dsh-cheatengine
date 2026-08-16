import { promises as fs } from 'node:fs';
import path from 'node:path';
export const scriptDefs = [
    {
        name: 'ce_execute_lua',
        description: '在 Cheat Engine 中执行任意 Lua 代码（高级/危险）',
        method: 'evaluate_lua',
        dangerous: true,
        parameters: {
            code: { type: 'string', required: true, description: 'Lua 代码，返回字符串结果' },
        },
    },
    {
        name: 'ce_auto_assemble',
        description: '执行 Auto Assembler 脚本（注入/代码洞穴等，危险）',
        method: 'auto_assemble',
        dangerous: true,
        parameters: {
            script: { type: 'string', required: true, description: 'AA 脚本' },
        },
    },
];
export const scriptInstallDefs = [
    {
        name: 'install_ce_bridge',
        description: '一键安装 CE 桥接：自动探测或指定 CE 目录，复制 ce_mcp_bridge.lua 和 ce_mcp_tcp_x64/x86.dll，并写入 autorun 自动启动脚本',
        method: 'install_ce_bridge',
        dangerous: true,
        parameters: {
            ce_dir: { type: 'string', description: 'Cheat Engine 安装目录，如 D:\\Game\\Cheat Engine 7.6；缺省自动探测常见路径' },
            source_dir: { type: 'string', required: true, description: '桥接文件所在目录（含 ce_mcp_bridge.lua 和 ce_mcp_tcp_*.dll）' },
            write_autorun: { type: 'boolean', description: '是否写入 autorun 自动启动脚本，默认 true' },
        },
        async execute(args) {
            const sourceDir = String(args.source_dir || '').trim();
            if (!sourceDir)
                return { success: false, error: 'source_dir is required', error_class: 'INVALID_ARGS' };
            const writeAutorun = args.write_autorun !== false;
            let ceDir = String(args.ce_dir || '').trim();
            if (!ceDir) {
                const candidates = [
                    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Cheat Engine') : '',
                    process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Cheat Engine') : '',
                    'D:\\Game\\Cheat Engine 7.6',
                    'D:\\Cheat Engine',
                    'C:\\Cheat Engine',
                ].filter(Boolean);
                for (const c of candidates) {
                    try {
                        await fs.access(c);
                        ceDir = c;
                        break;
                    }
                    catch { /* keep looking */ }
                }
            }
            if (!ceDir)
                return { success: false, error: 'ce_dir is required (auto-detect failed)', error_class: 'CE_DIR_NOT_FOUND' };
            // P1 hardening: only install into a directory that looks like Cheat Engine.
            const ceEntries = await fs.readdir(ceDir).catch(() => []);
            const hasCeExe = ceEntries.some((name) => /^cheatengine.*\.exe$/i.test(name));
            if (!hasCeExe) {
                return { success: false, error: `ce_dir does not look like a Cheat Engine directory (no cheatengine*.exe): ${ceDir}`, error_class: 'CE_DIR_NOT_FOUND' };
            }
            const files = ['ce_mcp_bridge.lua', 'ce_mcp_tcp_x64.dll', 'ce_mcp_tcp_x86.dll'];
            const copied = [];
            for (const f of files) {
                const src = path.join(sourceDir, f);
                const dst = path.join(ceDir, f);
                try {
                    await fs.access(src);
                }
                catch {
                    return { success: false, error: `source file not found: ${src}`, copied, error_class: 'SOURCE_FILE_NOT_FOUND' };
                }
                try {
                    await fs.copyFile(src, dst);
                    copied.push(dst);
                }
                catch (err) {
                    const code = (err && err.code) || '';
                    const hint = code === 'EACCES' || code === 'EPERM'
                        ? 'permission denied — try running DSH/CE as administrator'
                        : String((err && err.message) || err);
                    return { success: false, error: `copy ${f} failed: ${hint}`, copied, error_class: code === 'EACCES' || code === 'EPERM' ? 'PERMISSION_DENIED' : 'COPY_FAILED' };
                }
            }
            if (writeAutorun) {
                const autorunDir = path.join(ceDir, 'autorun');
                await fs.mkdir(autorunDir, { recursive: true });
                const autorunScript = `loadfile("${ceDir.replace(/\\/g, '\\\\')}\\\\ce_mcp_bridge.lua")()` + '\n';
                const autorunPath = path.join(autorunDir, 'start_mcp_bridge.lua');
                await fs.writeFile(autorunPath, autorunScript, 'utf8');
                copied.push(autorunPath);
            }
            return { success: true, copied, ce_dir: ceDir, write_autorun: writeAutorun };
        },
    },
];
//# sourceMappingURL=script.js.map