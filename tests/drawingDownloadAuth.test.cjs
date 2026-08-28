const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../api/authMiddleware.cjs');

async function withDrawingServer(run) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-drawing-auth-'));
    fs.writeFileSync(path.join(directory, 'drawing.pdf'), Buffer.from('%PDF-protected'));
    const app = express();
    app.use(cookieParser());
    app.use('/drawings', authMiddleware, express.static(directory));
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
        const address = server.address();
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise((resolve, reject) => server.close(error => (
            error ? reject(error) : resolve()
        )));
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('转子图纸静态下载拒绝未认证和错误凭据', async () => {
    await withDrawingServer(async baseUrl => {
        const anonymous = await fetch(`${baseUrl}/drawings/drawing.pdf`);
        assert.equal(anonymous.status, 401);

        const invalid = await fetch(`${baseUrl}/drawings/drawing.pdf`, {
            headers: { cookie: 'token=invalid-token' },
        });
        assert.equal(invalid.status, 401);
    });
});

test('转子图纸静态下载只向有效登录开放并保留目录边界', async () => {
    await withDrawingServer(async baseUrl => {
        const token = jwt.sign({ id: 1, username: 'tester' }, 'dev_jwt_secret', {
            expiresIn: '5m',
        });
        const authenticated = await fetch(`${baseUrl}/drawings/drawing.pdf`, {
            headers: { cookie: `token=${token}` },
        });
        assert.equal(authenticated.status, 200);
        assert.equal(await authenticated.text(), '%PDF-protected');

        const traversal = await fetch(`${baseUrl}/drawings/%2e%2e/package.json`, {
            headers: { cookie: `token=${token}` },
        });
        assert.equal(traversal.status, 404);
    });
});
