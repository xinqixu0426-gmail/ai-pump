const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('MCP localhost 外部命令替身覆盖 macOS/Windows 打印后端并对未知命令 fail-closed', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-mcp-stub-test-'));
    try {
        const stubPath = path.join(tempDir, 'mcp-external-command-stub.cjs');
        const logPath = path.join(tempDir, 'stub.jsonl');
        const pdfPath = path.join(tempDir, 'output_test-job.pdf');
        fs.copyFileSync(
            path.join(__dirname, 'helpers', 'mcpExternalCommandStub.cjs'),
            stubPath
        );
        fs.writeFileSync(pdfPath, '%PDF-1.4\n%%EOF\n', 'utf8');

        const childScript = `
            const childProcess = require('node:child_process');
            const pdfPath = process.env.MCP_STUB_TEST_PDF;
            childProcess.execFileSync('lp', [pdfPath]);
            childProcess.execFileSync('SumatraPDF', ['-print-to-default', '-silent', pdfPath]);
            childProcess.execFileSync('C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe', ['--print-to-default-printer', pdfPath]);
            childProcess.execFileSync('rundll32.exe', ['mshtml.dll,PrintHTML', pdfPath]);
            let rejected = false;
            try {
                childProcess.execFileSync('mcp-unknown-external-command', []);
            } catch (error) {
                rejected = /拒绝未登记的同步外部命令/.test(error.message);
            }
            if (!rejected) throw new Error('未知同步外部命令未 fail-closed');
        `;
        const child = spawnSync(process.execPath, ['-e', childScript], {
            cwd: tempDir,
            env: {
                ...process.env,
                MCP_LOCAL_EXTERNAL_STUB_ENABLED: 'true',
                MCP_LOCAL_EXTERNAL_STUB_FAIL_CLOSED: 'true',
                MCP_LOCAL_EXTERNAL_STUB_ROOT: tempDir,
                MCP_LOCAL_EXTERNAL_STUB_LOG: logPath,
                MCP_STUB_TEST_PDF: pdfPath,
                NODE_OPTIONS: `--require=${stubPath}`,
            },
            encoding: 'utf8',
            windowsHide: true,
        });
        assert.equal(child.status, 0, child.stderr || child.stdout);

        const events = fs.readFileSync(logPath, 'utf8')
            .trim()
            .split(/\r?\n/)
            .map(line => JSON.parse(line));
        assert.deepEqual(
            events.filter(event => event.kind === 'printer').map(event => event.command),
            ['lp', 'SumatraPDF', 'Edge', 'rundll32']
        );
        assert.equal(events.every(event => event.pdfPath === path.resolve(pdfPath)), true);
        assert.equal(events.every(event => event.jobId === 'test-job'), true);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
