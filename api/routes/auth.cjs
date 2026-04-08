/**
 * 认证路由模块
 * POST /login  — 密码验证 + 签发 JWT (HttpOnly Cookie)
 * POST /logout — 清除 Cookie
 * GET  /check  — 检查登录状态
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const JWT_EXPIRES_IN = '15d'; // 15 天免重新登录

/**
 * POST /api/auth/login
 * Body: { password: string }
 */
router.post('/login', (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, error: '请输入密码' });
  }

  if (!ACCESS_PASSWORD) {
    return res.status(500).json({ success: false, error: '系统未配置访问密码，请联系管理员' });
  }

  if (password !== ACCESS_PASSWORD) {
    return res.status(401).json({ success: false, error: '密码错误' });
  }

  // 签发 JWT
  const token = jwt.sign(
    { role: 'admin', iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  // 设置 HttpOnly Cookie
  res.cookie('token', token, {
    httpOnly: true,       // 前端 JS 无法读取
    secure: false,        // 开发环境允许 HTTP；生产环境建议设为 true
    sameSite: 'lax',      // 防 CSRF
    maxAge: 15 * 24 * 60 * 60 * 1000, // 15 天（毫秒）
    path: '/',
  });

  return res.json({ success: true, message: '登录成功' });
});

/**
 * POST /api/auth/logout
 * 清除身份 Cookie
 */
router.post('/logout', (_req, res) => {
  res.clearCookie('token', { path: '/' });
  return res.json({ success: true, message: '已退出登录' });
});

/**
 * GET /api/auth/check
 * 检查当前是否已登录
 */
router.get('/check', (req, res) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ success: false, authenticated: false });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.json({ success: true, authenticated: true, role: decoded.role });
  } catch {
    return res.status(401).json({ success: false, authenticated: false });
  }
});

module.exports = router;
