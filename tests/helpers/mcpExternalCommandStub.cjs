const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

if (process.env.MCP_LOCAL_EXTERNAL_STUB_ENABLED === 'true') {
    const originalExecFile = childProcess.execFile;
    const originalExecFileSync = childProcess.execFileSync;
    const logPath = String(process.env.MCP_LOCAL_EXTERNAL_STUB_LOG || '').trim();
    const freecadCommand = String(
        process.env.MCP_LOCAL_FREECAD_STUB_COMMAND || 'mcp-local-freecad-stub'
    );
    const allowedRoot = path.resolve(String(
        process.env.MCP_LOCAL_EXTERNAL_STUB_ROOT || process.cwd()
    ));
    const failClosed = process.env.MCP_LOCAL_EXTERNAL_STUB_FAIL_CLOSED === 'true';

    function appendLog(entry) {
        if (!logPath) return;
        fs.appendFileSync(logPath, `${JSON.stringify({
            ...entry,
            at: new Date().toISOString(),
        })}\n`, 'utf8');
    }

    function writeStubPdf(workerScript, args) {
        assertAllowedPath(workerScript, 'FreeCAD worker');
        const passIndex = args.indexOf('--pass');
        const params = passIndex >= 0
            ? JSON.parse(String(args[passIndex + 1] || '{}'))
            : {};
        const jobId = String(params._jobId || '').trim();
        if (!jobId) throw new Error('MCP localhost FreeCAD stub 缺少 _jobId');
        const outputPath = assertAllowedPath(
            path.join(path.dirname(workerScript), `output_${jobId}.pdf`),
            'FreeCAD 输出'
        );
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(
            outputPath,
            Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
        );
        appendLog({ kind: 'freecad', jobId, outputPath });
        return jobId;
    }

    function stubProcess() {
        return {
            kill() {},
            killed: false,
            pid: 0,
        };
    }

    function assertAllowedPath(filePath, label) {
        const resolved = path.resolve(String(filePath || ''));
        if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
            throw new Error(`MCP localhost ${label} 路径越界: ${resolved}`);
        }
        return resolved;
    }

    function printerBackend(file) {
        const command = String(file || '');
        const base = path.win32.basename(command).toLocaleLowerCase('en-US');
        if (base === 'lp') return 'lp';
        if (base === 'sumatrapdf' || base === 'sumatrapdf.exe') return 'SumatraPDF';
        if (base === 'msedge.exe') return 'Edge';
        if (base === 'rundll32' || base === 'rundll32.exe') return 'rundll32';
        return null;
    }

    childProcess.execFile = function execFileWithMcpLocalStub(file, args, options, callback) {
        if (String(file) !== freecadCommand) {
            if (failClosed) {
                const error = new Error(`MCP localhost 拒绝未登记的异步外部命令: ${String(file)}`);
                const actualCallback = typeof options === 'function' ? options : callback;
                if (typeof actualCallback === 'function') {
                    queueMicrotask(() => actualCallback(error, '', error.message));
                    return stubProcess();
                }
                throw error;
            }
            return originalExecFile.apply(this, arguments);
        }
        const normalizedArgs = Array.isArray(args) ? args : [];
        const actualCallback = typeof options === 'function' ? options : callback;
        try {
            const jobId = writeStubPdf(String(normalizedArgs[0] || ''), normalizedArgs);
            queueMicrotask(() => actualCallback?.(null, `stubbed ${jobId}`, ''));
        } catch (error) {
            queueMicrotask(() => actualCallback?.(error, '', error.message));
        }
        return stubProcess();
    };

    childProcess.execFileSync = function execFileSyncWithMcpLocalStub(file, args) {
        const command = String(file || '');
        const base = path.win32.basename(command).toLocaleLowerCase('en-US');
        if (base === 'where' || base === 'where.exe') {
            if (String(args?.[0] || '').toLocaleLowerCase('en-US') !== 'sumatrapdf') {
                throw new Error(`MCP localhost 拒绝未登记的打印发现命令: ${String(args?.[0] || '')}`);
            }
            appendLog({ kind: 'printer-discovery', command: String(args?.[0] || '') });
            return Buffer.from('MCP_LOCAL_SUMATRA_STUB.exe\r\n');
        }
        const backend = printerBackend(command);
        if (backend) {
            const pdfPath = assertAllowedPath(String(args?.at(-1) || ''), '打印文件');
            const fileName = path.basename(pdfPath);
            appendLog({
                kind: 'printer',
                command: backend,
                pdfPath,
                jobId: /^output_(.+)\.pdf$/i.exec(fileName)?.[1] || null,
            });
            return Buffer.from('MCP localhost printer stub');
        }
        if (failClosed) {
            throw new Error(`MCP localhost 拒绝未登记的同步外部命令: ${command}`);
        }
        return originalExecFileSync.apply(this, arguments);
    };
}
