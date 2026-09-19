'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const { issueOwnerToken, verifyAuthentication, isAuthenticatedOwner } = require('./ownerAuthentication.cjs');

// Additive authentication only. This module cannot route an AI/business request.
function createOwnerAuthenticationGateway({ readConfig, legacyPort = 3002 }) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1); // Established loopback Cloudflare connector topology.
    app.use((req, res, next) => {
        const id = req.headers['x-request-id'];
        res.set('X-Request-ID', typeof id === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(id) ? id : randomUUID());
        res.set('Cache-Control', 'no-store'); next();
    });
    app.use(cookieParser());
    const loginLimiter = rateLimit({ windowMs: 60000, max: 5, standardHeaders: true, legacyHeaders: false,
        message: { success: false, error: '登录尝试过于频繁，请 1 分钟后再试' } });
    const json = express.json({ limit: '32kb', strict: true });
    function config() { try { return readConfig(); } catch { return {}; } }
    function proxy(req, res, decorate) {
        const body = req.method === 'POST' ? JSON.stringify(req.body) : null;
        const headers = { accept: 'application/json' };
        if (req.headers.cookie) headers.cookie = req.headers.cookie;
        if (body) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(body); }
        // Retain the existing per-IP limiter at Legacy; never forward identity headers.
        headers['x-forwarded-for'] = req.ip;
        const upstream = http.request({ host: '127.0.0.1', port: legacyPort, method: req.method,
            path: req.method === 'POST' ? '/api/auth/login' : '/api/auth/check', headers }, reply => {
            let chunks = [], size = 0;
            reply.on('data', chunk => {
                size += chunk.length;
                if (size > 32768) { reply.destroy(); upstream.destroy(); fail(); }
                else chunks.push(chunk);
            });
            reply.on('error', fail);
            reply.on('end', () => {
                if (res.headersSent) return;
                try {
                    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (reply.headers['set-cookie']) res.setHeader('Set-Cookie', reply.headers['set-cookie']);
                    for (const key of ['ratelimit', 'ratelimit-policy', 'retry-after']) {
                        if (reply.headers[key]) res.setHeader(key, reply.headers[key]);
                    }
                    res.status(reply.statusCode).json(decorate ? decorate(value, reply.statusCode) : value);
                } catch { fail(); }
            });
        });
        function fail() { if (!res.headersSent) res.status(503).json({ success: false, error: 'AUTH_UPSTREAM_UNAVAILABLE' }); }
        upstream.setTimeout(5000, () => { upstream.destroy(); fail(); });
        upstream.on('error', fail);
        upstream.end(body);
    }
    app.post('/api/auth/login', loginLimiter, json, (req, res) => {
        if (typeof req.body?.password !== 'string' || !req.body.password) {
            return res.status(400).json({ success: false, error: '请输入密码' });
        }
        const token = issueOwnerToken(req.body.password, config());
        if (!token) return proxy(req, res);
        res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'strict',
            maxAge: 15 * 24 * 60 * 60 * 1000, path: '/' });
        return res.json({ success: true, message: '登录成功' });
    });
    app.get('/api/auth/check', (req, res) => {
        proxy(req, res, (value, status) => {
            const env = config();
            const owner = status === 200 && value.authenticated === true
                && isAuthenticatedOwner(verifyAuthentication(req.cookies?.token, env), env);
            return { ...value, owner };
        });
    });
    app.use((_req, res) => res.status(404).json({ success: false, error: 'AUTH_ROUTE_NOT_FOUND' }));
    app.use((_error, _req, res, _next) => res.status(400).json({ success: false, error: 'AUTH_REQUEST_INVALID' }));
    return http.createServer(app);
}
module.exports = { createOwnerAuthenticationGateway };
