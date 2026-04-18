const fs = require('fs');
const path = require('path');

const aiFile = path.join(__dirname, 'api/routes/ai.cjs');
const destDir = path.join(__dirname, 'api/routes/ai');
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

const content = fs.readFileSync(aiFile, 'utf8').replace(/\r\n/g, '\n');

// The markers based on exact file contents:
const markerToolsStart = "const AI_TOOLS = [";
const markerPromptStart = "let AI_SYSTEM_PROMPT = `";
const markerExecutorStart = "/**\n * AI 工具执行器";
const markerChatEndpointStart = "// ── AI Chat SSE 端点 ──";
const markerSystemPromptRouteStart = "// ── System Prompt 读取/修改 ──";
const markerVoiceStart = "// ── 阿里云 NLS Token 自动获取与缓存 ──";
const markerSiriStart = "const SIRI_TOKEN";
const markerProcessChatStart = "/**\n * 通用 AI 对话处理函数";
const markerSiriEndpointStart = "/**\n * 请求体：\n * {\n *   \"text\": \"V750的成本是多少\"";
const markerExportsStart = "module.exports = router;\nmodule.exports.loadSystemPromptFromDB";

// Indices
if (content.indexOf(markerToolsStart) === -1) throw new Error("not found: " + markerToolsStart);
if (content.indexOf(markerPromptStart) === -1) throw new Error("not found: " + markerPromptStart);
if (content.indexOf(markerExecutorStart) === -1) throw new Error("not found: " + markerExecutorStart);
if (content.indexOf(markerChatEndpointStart) === -1) throw new Error("not found: " + markerChatEndpointStart);
if (content.indexOf(markerSystemPromptRouteStart) === -1) throw new Error("not found: " + markerSystemPromptRouteStart);
if (content.indexOf(markerVoiceStart) === -1) throw new Error("not found: " + markerVoiceStart);
if (content.indexOf(markerSiriStart) === -1) throw new Error("not found: " + markerSiriStart);
if (content.indexOf(markerProcessChatStart) === -1) throw new Error("not found: " + markerProcessChatStart);
if (content.indexOf(markerSiriEndpointStart) === -1) throw new Error("not found: " + markerSiriEndpointStart);
if (content.indexOf(markerExportsStart) === -1) throw new Error("not found: " + markerExportsStart);

// Extracted parts
const toolsCode = content.substring(content.indexOf(markerToolsStart), content.indexOf(markerPromptStart));

const promptVarCode = content.substring(content.indexOf(markerPromptStart), content.indexOf(markerExecutorStart));
const promptRouteCode = content.substring(content.indexOf(markerSystemPromptRouteStart), content.indexOf(markerVoiceStart));

const executorCode = content.substring(content.indexOf(markerExecutorStart), content.indexOf(markerChatEndpointStart));

const chatRouteCode = content.substring(content.indexOf(markerChatEndpointStart), content.indexOf(markerSystemPromptRouteStart));
const processChatCode = content.substring(content.indexOf(markerProcessChatStart), content.indexOf(markerSiriEndpointStart));

const voiceCode = content.substring(content.indexOf(markerVoiceStart), content.indexOf(markerSiriStart));

const siriHeaderCode = content.substring(content.indexOf(markerSiriStart), content.indexOf(markerProcessChatStart));
const siriRouteCode = content.substring(content.indexOf(markerSiriEndpointStart), content.indexOf(markerExportsStart));

// Write tools.cjs
let outTools = `${toolsCode}\nmodule.exports = { AI_TOOLS, WRITE_TOOLS };\n`;
fs.writeFileSync(path.join(destDir, 'tools.cjs'), outTools);

// Write prompt.cjs
let outPrompt = `const express = require('express');\nconst router = express.Router();\nconst { db } = require('../../db.cjs');\n\n`;
outPrompt += promptVarCode;
outPrompt += promptRouteCode;
outPrompt += `\nfunction getSystemPrompt() { return AI_SYSTEM_PROMPT; }\n`;
outPrompt += `function setSystemPrompt(val) { AI_SYSTEM_PROMPT = val; }\n`;
outPrompt += `\nmodule.exports = { getSystemPrompt, setSystemPrompt, loadSystemPromptFromDB, router };\n`;
fs.writeFileSync(path.join(destDir, 'prompt.cjs'), outPrompt);

// Write executor.cjs
let outExecutor = `const { db, dbGetAllParts, dbGetAllRecipes, dbGetAllOrders, dbGetAllCoils, dbGetAllTemplates, partRow, recipeRow, orderRow, coilRow, loadPartsData, calculateRecipeCost, updateOrderFields, invalidatePartsCache } = require('../../db.cjs');\n`;
outExecutor += `const { AI_TOOLS, WRITE_TOOLS } = require('./tools.cjs');\n\n`;
outExecutor += executorCode;
outExecutor += `\nmodule.exports = { executeToolCall };\n`;
fs.writeFileSync(path.join(destDir, 'executor.cjs'), outExecutor);

// Write chat.cjs
let outChat = `const express = require('express');\nconst router = express.Router();\n`;
outChat += `const { AI_TOOLS } = require('./tools.cjs');\n`;
outChat += `const { getSystemPrompt } = require('./prompt.cjs');\n`;
outChat += `const { executeToolCall } = require('./executor.cjs');\n\n`;
outChat = outChat + chatRouteCode.replace(/AI_SYSTEM_PROMPT/g, 'getSystemPrompt()') + '\n\n';
outChat = outChat + processChatCode.replace(/AI_SYSTEM_PROMPT/g, 'getSystemPrompt()') + '\n\n';
outChat += `module.exports = { router, processAiChat };\n`;
fs.writeFileSync(path.join(destDir, 'chat.cjs'), outChat);

// Write voice.cjs
let outVoice = `const express = require('express');\nconst router = express.Router();\n`;
outVoice += `const multer = require('multer');\nconst crypto = require('crypto');\n`;
outVoice += `const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });\n\n`;
outVoice += voiceCode;
outVoice += `\nmodule.exports = router;\n`;
fs.writeFileSync(path.join(destDir, 'voice.cjs'), outVoice);

// Write siri.cjs
let outSiri = `const express = require('express');\nconst router = express.Router();\n`;
outSiri += `const crypto = require('crypto');\nconst path = require('path');\n`;
outSiri += `const { processAiChat } = require('./chat.cjs');\n\n`;
outSiri += siriHeaderCode;
outSiri += siriRouteCode;
outSiri += `\nmodule.exports = router;\n`;
fs.writeFileSync(path.join(destDir, 'siri.cjs'), outSiri);

// Write new ai.cjs
let newAiCjs = `const { Router } = require('express');
const router = Router();

// 挂载子路由
const chatModule = require('./ai/chat.cjs');
const voiceRouter = require('./ai/voice.cjs');
const siriRouter = require('./ai/siri.cjs');
const promptModule = require('./ai/prompt.cjs');

router.use('/', chatModule.router);
router.use('/', voiceRouter);
router.use('/', siriRouter);
router.use('/', promptModule.router);

module.exports = router;
module.exports.loadSystemPromptFromDB = promptModule.loadSystemPromptFromDB;
module.exports.processAiChat = chatModule.processAiChat;
`;
fs.writeFileSync(aiFile, newAiCjs);

console.log('Split logic evaluated successfully.');
