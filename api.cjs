/**
 * 水泵BOM成本查询API — 入口文件
 * 路由已按模块拆分到 api/routes/ 目录
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('./api/authMiddleware.cjs');

const app = express();
const PORT = 3002;

// 解决 Nginx 反向代理下 express-rate-limit 报错 (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR)
app.set('trust proxy', 1);

// ── 中间件 ──
app.use(cors({
  origin: true,           // 允许所有来源（开发环境）
  credentials: true,      // 允许携带 Cookie
}));
app.use(express.json());
app.use(cookieParser());

// 静态文件服务 — 转子出图 PDF 下载
const path = require('path');
app.use('/drawings', express.static(path.join(__dirname, 'public/drawings')));

// ── 登录接口限流（防暴力破解） ──
const loginLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,   // 1 分钟窗口
  max: 5,                     // 每个 IP 最多 5 次
  message: { success: false, error: '登录尝试过于频繁，请 1 分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ══════════════════════════════════════════════
// ✅ 公开路由（不需要认证）
// ══════════════════════════════════════════════

// 认证相关路由（login 接口附加限流中间件）
const authRouter = require('./api/routes/auth.cjs');
app.use('/api/auth', (req, res, next) => {
  if (req.path === '/login' && req.method === 'POST') {
    return loginLimiter(req, res, next);
  }
  next();
}, authRouter);

// 健康检查保持公开（方便监控）
const costRouter = require('./api/routes/cost.cjs');
app.get('/api/health', (req, res, next) => {
  // 直接转发到 cost 路由中的 health handler
  // 由于 cost 路由挂在 /api 上，先检查是否有 health 处理
  next();
});

// AI/Siri/Voice 路由 — 保持公开（使用独立的 SIRI_API_TOKEN 验证）
const aiRouter = require('./api/routes/ai.cjs');
app.use('/', aiRouter);

// 企业微信 Webhook 路由 — 保持公开（使用独立的配置验证）
const wecomRouter = require('./api/routes/wecom.cjs');
app.use('/api/wecom', wecomRouter);

// ══════════════════════════════════════════════
// 🔒 保护路由（需要认证）
// ══════════════════════════════════════════════

// 在此之后的所有 /api 路由都需要通过 JWT 验证
app.use('/api', (req, res, next) => {
  // 放行已经处理过的公开路径
  if (req.path.startsWith('/auth')) return next();
  if (req.path === '/health') return next();
  // 放行内部自己调用的网络请求
  if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) {
      return next();
  }
  // 其余所有接口需要认证
  authMiddleware(req, res, next);
});

// 注意：cost 路由包含 /api/health, /api/cost/*, /api/copper-price/*
// 所有路由自带 /api/ 前缀，故挂到根路径
app.use('/api', costRouter);
app.use('/api/parts', require('./api/routes/parts.cjs'));
app.use('/api/recipes', require('./api/routes/recipes.cjs'));
app.use('/api/templates', require('./api/routes/templates.cjs'));
app.use('/api/orders', require('./api/routes/orders.cjs'));
app.use('/api/coils', require('./api/routes/coils.cjs'));
app.use('/api/rotor', require('./api/routes/rotor.cjs'));
app.use('/api/settings', require('./api/routes/settings.cjs'));

// ── 生产模式：托管前端构建产物 ──
const distPath = path.join(__dirname, 'dist');
const fs = require('fs');
if (fs.existsSync(distPath)) {
  console.log('[启动] 检测到 dist/ 目录，启用静态文件托管');
  app.use(express.static(distPath));
  // SPA fallback: 所有非 API 路由返回 index.html
  app.get('{*path}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/drawings')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ── 启动 ──
app.listen(PORT, '0.0.0.0', () => {
    const isProd = process.env.NODE_ENV === 'production' || process.env.BEHIND_PROXY === 'true' || (process.platform !== 'win32' && process.env.NODE_ENV !== 'development');
    console.log(`========================================`);
    console.log(`水泵BOM成本查询API已启动`);
    console.log(`访问地址: http://localhost:${PORT}`);
    console.log(`运行平台: ${process.platform} | 环境模式: ${isProd ? '🚀 生产模式 (Secure Cookie)' : '🛠  开发模式 (Lax Cookie)'}`);
    console.log(`========================================`);
    console.log(`🔒 认证系统已启用`);
    console.log(`   登录接口: POST /api/auth/login`);
    console.log(`   登出接口: POST /api/auth/logout`);
    console.log(`   状态检查: GET  /api/auth/check`);
    console.log(`========================================`);
    console.log(`可用端点:（需认证）`);
    console.log(`  GET  /api/health                        - 健康检查（公开）`);
    console.log(`  POST /api/cost/calculate                - 计算成本（传parts数组）`);
    console.log(`  GET  /api/cost/recipe/:id               - 按配方ID查询成本`);
    console.log(`  GET  /api/cost/recipe/by-name?name=xxx  - 按配方名称查询成本`);
    console.log(`  POST /api/cost/dynamic-config           - 动态配置成本（浮球/电缆/包材）`);
    console.log(`  POST /api/cost/full-calculate           - 一站式成本计算（推荐N8N用）`);
    console.log(`  GET  /api/copper-price                  - 获取实时铜价`);
    console.log(`  POST /api/copper-price/update           - 手动触发铜价更新`);
    console.log(`  GET  /api/coils                         - 获取所有线圈数据`);
    console.log(`  POST /api/coils                         - 新增线圈记录`);
    console.log(`  PATCH /api/coils/:id                    - 更新线圈记录`);
    console.log(`  DELETE /api/coils/:id                   - 删除线圈记录`);
    console.log(`  POST /api/coils/calculate               - 线圈成本计算（支持插值）`);
    console.log(`  GET  /api/coils/specs                   - 获取可用规格列表`);
    console.log(`  POST /api/ai/chat                       - AI智能助手（SSE）`);
    console.log(`  GET  /api/ai/system-prompt              - 获取System Prompt`);
    console.log(`  PUT  /api/ai/system-prompt              - 修改System Prompt`);
    console.log(`  POST /api/voice/asr                     - 语音识别(阿里云ASR)`);
    console.log(`  POST /api/siri/chat                     - Siri快捷指令对话`);
    console.log(`  GET/POST /api/wecom/webhook             - 企微回调与消息接收（公开）`);
    console.log(`========================================`);

    // 启动时自动更新铜价
    console.log('[启动] 正在获取最新铜价...');
    costRouter.runCopperPriceUpdate();

    // 加载 AI System Prompt
    console.log('[启动] 正在加载 AI System Prompt...');
    aiRouter.loadSystemPromptFromDB();
});
