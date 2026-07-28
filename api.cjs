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
const http = require('http');
const https = require('https');

const app = express();
const PORT = Number(process.env.PORT || 3002);
if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  throw new Error('PORT 必须是有效端口号');
}

// 解决 Nginx 反向代理下 express-rate-limit 报错 (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR)
app.set('trust proxy', 1);

// ── 中间件 ──
const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' ||
  (process.platform !== 'win32' && process.env.BEHIND_PROXY === 'true') ||
  (process.platform !== 'win32' && process.env.NODE_ENV !== 'development');
const IS_DEV = !IS_PRODUCTION;
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean)
  : [];

function requireProductionEnv(name) {
  if (!process.env[name]) {
    throw new Error(`生产环境必须配置 ${name}`);
  }
}

if (IS_PRODUCTION) {
  ['ACCESS_PASSWORD', 'JWT_SECRET', 'INTERNAL_SECRET', 'CORS_ORIGIN', 'SIRI_API_TOKEN'].forEach(requireProductionEnv);
}

if (IS_PRODUCTION && corsOrigins.length === 0) {
  throw new Error('生产环境必须配置 CORS_ORIGIN');
}

if (IS_PRODUCTION) {
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    if (forwardedProto && forwardedProto !== 'https' && req.headers.host) {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}

app.use(cors({
  origin: IS_DEV ? true : corsOrigins,
  credentials: true,
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

// AI 路由内部按端点鉴权；Siri 使用独立的 SIRI_API_TOKEN 验证
const aiRouter = require('./api/routes/ai.cjs');
const { requestFullAutoKnowledgeSync } = require('./api/services/knowledgeAutoSync.cjs');
app.use('/', aiRouter);

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
app.use('/api/model-variants', require('./api/routes/modelVariants.cjs'));
app.use('/api/orders', require('./api/routes/orders.cjs'));
app.use('/api/coils', require('./api/routes/coils.cjs'));
app.use('/api/rotor', require('./api/routes/rotor.cjs'));
app.use('/api/settings', require('./api/routes/settings.cjs'));
app.use('/api/customers', require('./api/routes/customers.cjs'));
app.use('/api/quotations', require('./api/routes/quotations.cjs'));
app.use('/api/workbench', require('./api/routes/workbench.cjs'));
app.use('/api/quality', require('./api/routes/quality.cjs'));
app.use('/api/knowledge', require('./api/routes/knowledge.cjs'));

// ── 生产模式：Cloudflare Tunnel 仍指向 API 端口时，将页面请求转发到 Next 前端 ──
const NEXT_ORIGIN = process.env.NEXT_ORIGIN || (IS_PRODUCTION ? 'http://127.0.0.1:3000' : '');
if (NEXT_ORIGIN) {
  const nextOriginUrl = new URL(NEXT_ORIGIN);
  const nextClient = nextOriginUrl.protocol === 'https:' ? https : http;
  console.log(`[启动] 页面请求将优先转发到 Next 前端: ${NEXT_ORIGIN}`);

  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/drawings')) {
      return next();
    }

    const proxyReq = nextClient.request({
      protocol: nextOriginUrl.protocol,
      hostname: nextOriginUrl.hostname,
      port: nextOriginUrl.port,
      method: req.method,
      path: req.originalUrl,
      headers: {
        ...req.headers,
        host: nextOriginUrl.host,
      },
      timeout: 5000,
    }, proxyRes => {
      res.statusCode = proxyRes.statusCode || 502;
      Object.entries(proxyRes.headers).forEach(([key, value]) => {
        if (value !== undefined) res.setHeader(key, value);
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('timeout', () => proxyReq.destroy(new Error('Next frontend proxy timeout')));
    proxyReq.on('error', () => next());
    req.pipe(proxyReq);
  });
}

// ── 启动 ──
app.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`水泵BOM成本查询API已启动`);
    console.log(`访问地址: http://localhost:${PORT}`);
    console.log(`运行平台: ${process.platform} | 环境模式: ${IS_PRODUCTION ? '🚀 生产模式 (Secure Cookie)' : '🛠  开发模式 (Lax Cookie)'}`);
    console.log(`========================================`);
    console.log(`🔒 认证系统已启用`);
    console.log(`   登录接口: POST /api/auth/login`);
    console.log(`   登出接口: POST /api/auth/logout`);
    console.log(`   状态检查: GET  /api/auth/check`);
    console.log(`========================================`);
    console.log(`核心端点:`);
    console.log(`  GET  /api/health                        - 健康检查（公开）`);
    console.log(`  POST /api/ai/chat                       - AI 工作台（SSE）`);
    console.log(`  GET  /api/ai/conversations              - AI 会话历史`);
    console.log(`  GET  /api/knowledge                     - 工厂知识库搜索`);
    console.log(`  POST /api/knowledge/sync                - 增量同步工厂知识库`);
    console.log(`========================================`);

    // 启动时自动更新铜价
    console.log('[启动] 正在获取最新铜价...');
    costRouter.runCopperPriceUpdate();

    // 加载 AI System Prompt
    console.log('[启动] 正在加载 AI System Prompt...');
    aiRouter.loadSystemPromptFromDB();

    // 启动后自动核对派生知识；内容哈希确保只写入真实变化。
    requestFullAutoKnowledgeSync('api_startup');
});
