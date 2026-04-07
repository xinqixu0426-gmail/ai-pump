/**
 * 水泵BOM成本查询API — 入口文件
 * 路由已按模块拆分到 api/routes/ 目录
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3002;

// ── 中间件 ──
app.use(cors());
app.use(express.json());

// ── 挂载路由模块 ──
// 注意：cost 路由包含 /api/health, /api/cost/*, /api/copper-price/*
// 所有路由自带 /api/ 前缀，故挂到根路径
const costRouter = require('./api/routes/cost.cjs');
app.use('/api', costRouter);
app.use('/api/parts', require('./api/routes/parts.cjs'));
app.use('/api/recipes', require('./api/routes/recipes.cjs'));
app.use('/api/templates', require('./api/routes/templates.cjs'));
app.use('/api/orders', require('./api/routes/orders.cjs'));
app.use('/api/coils', require('./api/routes/coils.cjs'));

// AI/Siri 路由自带完整路径（/api/ai/*, /api/voice/*, /api/siri/*, /siri-result）
const aiRouter = require('./api/routes/ai.cjs');
app.use('/', aiRouter);

// ── 启动 ──
app.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`水泵BOM成本查询API已启动`);
    console.log(`访问地址: http://localhost:${PORT}`);
    console.log(`========================================`);
    console.log(`可用端点:`);
    console.log(`  GET  /api/health                        - 健康检查`);
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
    console.log(`========================================`);

    // 启动时自动更新铜价
    console.log('[启动] 正在获取最新铜价...');
    costRouter.runCopperPriceUpdate();

    // 加载 AI System Prompt
    console.log('[启动] 正在加载 AI System Prompt...');
    aiRouter.loadSystemPromptFromDB();
});
