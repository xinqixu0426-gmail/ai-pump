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
const { createLogger } = require('./api/logger.cjs');
const { createRequestObservability } = require('./api/services/requestObservability.cjs');
const {
  assertProductionEnvironment,
  getServerPort,
  isProductionEnvironment,
  parseCorsOrigins,
} = require('./api/services/environment.cjs');

const app = express();
const appLogger = createLogger('api');
const PORT = getServerPort();

// 解决 Nginx 反向代理下 express-rate-limit 报错 (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR)
app.set('trust proxy', 1);
app.use(createRequestObservability());

// ── 中间件 ──
const IS_PRODUCTION = isProductionEnvironment();
const IS_DEV = !IS_PRODUCTION;
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);

if (IS_PRODUCTION) {
  assertProductionEnvironment();
}

const {
  db,
  safeUpdate,
  stopBackupScheduler,
  waitForBackupIdle,
} = require('./api/db.cjs');
const { stopAutoKnowledgeSync } = require('./api/services/knowledgeAutoSync.cjs');
const { stopKnowledgeVectorSync } = require('./api/services/knowledgeVectorAutoSync.cjs');
const {
  createQuotationExpiryMaintenance,
  expireOverdueQuotations,
} = require('./api/services/quotationExpiry.cjs');
const quotationExpiryLogger = createLogger('quotation-expiry');
const quotationExpiryMaintenance = createQuotationExpiryMaintenance({
  run: (now, trigger) => expireOverdueQuotations({
    db,
    safeUpdate,
    now,
    trigger,
  }),
  logger: quotationExpiryLogger,
});

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

// 通用 MCP 同时兼容当前协议与 2025 Streamable HTTP，只暴露显式白名单内的只读 Query/Preview。
// MCP 在独立限流和鉴权后解析 JSON，使畸形或超大请求不能绕过该入口保护。
app.use('/mcp', require('./api/routes/mcp.cjs'));

app.use(express.json());
app.use(cookieParser());

// 网页保存的运行设置覆盖 .env 默认值；部署鉴权密钥仍只允许来自环境变量。
require('./api/services/runtimeConfig.cjs').initializeRuntimeSettings();

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

// 健康检查保持公开（方便监控），与业务成本路由独立。
const healthRouter = require('./api/routes/health.cjs');
app.use('/api/health', healthRouter);

const costRouter = require('./api/routes/cost.cjs');

// AI 路由内部按端点校验 JWT Cookie 或 INTERNAL_SECRET。
const aiRouter = require('./api/routes/ai.cjs');
const { requestFullAutoKnowledgeSync } = require('./api/services/knowledgeAutoSync.cjs');
const {
    requestManagementActionLifecycleRecheck,
    shouldRecheckManagementActions,
    startManagementActionLifecycleMonitor,
    stopManagementActionLifecycleMonitor,
} = require('./api/services/managementActionLifecycle.cjs');
app.use('/', aiRouter);

// ══════════════════════════════════════════════
// 🔒 保护路由（需要认证）
// ══════════════════════════════════════════════

// 在此之后的所有 /api 路由都需要通过 JWT 验证
app.use('/api', (req, res, next) => {
  // 放行已经处理过的公开路径
  if (req.path.startsWith('/auth')) return next();
  if (req.path === '/health' || req.path.startsWith('/health/')) return next();
  // 放行内部自己调用的网络请求
  if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) {
      return next();
  }
  // 其余所有接口需要认证
  authMiddleware(req, res, next);
});

// 核心业务写入成功后触发一次防抖复查，生命周期状态无需人工维护。
app.use('/api', (req, res, next) => {
  res.once('finish', () => {
    if (!shouldRecheckManagementActions({
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
    })) return;
    requestManagementActionLifecycleRecheck(
      `${req.method.toLowerCase()}:${req.originalUrl.split('?')[0]}`
    );
  });
  next();
});

// cost 路由包含 /api/cost/*、/api/copper-price/* 等成本相关端点。
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
app.use('/api/files', require('./api/routes/files.cjs'));
app.use('/api/knowledge', require('./api/routes/knowledge.cjs'));

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `API 不存在：${req.method} ${req.originalUrl}` });
});

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
    proxyReq.on('error', error => {
      appLogger.error('Next 页面转发失败', {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        error,
      });
      if (res.headersSent) return res.destroy(error);
      res.status(502).type('text/plain; charset=utf-8').send('前端服务暂时不可用，请稍后重试');
    });
    req.pipe(proxyReq);
  });
}

app.use((error, req, res, next) => {
  appLogger.error('未处理请求错误', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    error,
  });
  if (res.headersSent) return next(error);
  if (req.path.startsWith('/api')) {
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  }
  res.status(500).type('text/plain; charset=utf-8').send('服务器内部错误');
});

// ── 启动 ──
const server = app.listen(PORT, '0.0.0.0', () => {
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

    // 报价过期属于受控维护命令：启动时补跑，之后每天北京时间 00:05 执行。
    quotationExpiryMaintenance.start();

    // 启动时自动更新铜价
    console.log('[启动] 正在获取最新铜价...');
    costRouter.runCopperPriceUpdate();

    // 加载 AI System Prompt
    console.log('[启动] 正在加载 AI System Prompt...');
    aiRouter.loadSystemPromptFromDB();

    // 启动后自动核对派生知识；内容哈希确保只写入真实变化。
    requestFullAutoKnowledgeSync('api_startup');

    // 后台追踪管理待办首次出现、消失和再次出现，查看接口仍保持只读。
    startManagementActionLifecycleMonitor();
});
server.on('error', error => {
  appLogger.error('HTTP 服务错误', { error });
  shutdown('serverError', 1);
});

let shuttingDown = false;
function closeDatabase() {
  try {
    if (db.open) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    }
  } catch (error) {
    appLogger.error(`关闭数据库失败: ${error.message}`);
  }
}

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  appLogger.info(`收到 ${signal}，开始优雅停机`);
  stopBackupScheduler();
  costRouter.stopCopperPriceScheduler?.();
  quotationExpiryMaintenance.stop();
  stopAutoKnowledgeSync();
  stopKnowledgeVectorSync();
  stopManagementActionLifecycleMonitor();

  const forceTimer = setTimeout(() => {
    appLogger.error('优雅停机超过 10 秒，强制关闭连接');
    server.closeAllConnections?.();
    closeDatabase();
    process.exit(exitCode || 1);
  }, 10000);
  if (typeof forceTimer.unref === 'function') forceTimer.unref();

  server.close(async error => {
    await waitForBackupIdle();
    clearTimeout(forceTimer);
    closeDatabase();
    if (error) {
      appLogger.error(`HTTP 服务关闭失败: ${error.message}`);
      process.exit(exitCode || 1);
    }
    appLogger.info('API 已安全停止');
    process.exit(exitCode);
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('uncaughtException', error => {
  appLogger.error('未捕获异常，准备重启进程', { error });
  shutdown('uncaughtException', 1);
});
process.once('unhandledRejection', reason => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  appLogger.error('未处理 Promise 拒绝，准备重启进程', { error });
  shutdown('unhandledRejection', 1);
});
process.on('warning', warning => {
  appLogger.warn('Node.js 运行警告', { warning });
});
