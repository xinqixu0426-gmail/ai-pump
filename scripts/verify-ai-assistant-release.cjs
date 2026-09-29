'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const chat = read('api/routes/ai/chat.cjs');
const routes = read('api/routes/ai.cjs');
const runtime = read('api/services/ai-assistant/runtime.cjs');
const tools = read('api/services/ai-assistant/agentTools.cjs');
const client = read('apps/web-next/lib/ai-assistant-write-proposal-client.cjs');
const requiredAbsent = [
    'api/services/aiDispatcherV3.cjs',
    'api/routes/ai/tasks.cjs',
    'api/services/aiTaskControllerV2.cjs',
    'api/services/aiTaskSemanticsV2.cjs',
    'api/services/aiTaskAnswerV2.cjs',
    'api/services/aiTaskWriteBridgeV2.cjs',
    'api/services/aiNativeWriteChatBridgeV2.cjs',
    'api/services/aiProtectedCommandRoute.cjs',
];
for (const file of requiredAbsent) assert.equal(fs.existsSync(path.join(root, file)), false, `${file} must be retired`);
assert.match(chat, /runAiAssistant/); assert.doesNotMatch(chat, /runAiDispatcherV3|aiNativeRolloutPolicy|aiTask/);
assert.doesNotMatch(routes, /tasks\.cjs/); assert.match(chat, /\/api\/ai\/write\/confirm/);
assert.match(client, /\/api\/ai\/write\/confirm/); assert.doesNotMatch(client, /\/api\/ai\/tasks\//);
assert.doesNotMatch(client, /write-execute|write-reconcile|expectedRevision|toolName|args/);
assert.match(runtime, /writeAllowed/); assert.doesNotMatch(runtime, /aiTask|TaskV2|aiProtectedCommandRoute/);
assert.match(tools, /prepare_part_stock_adjustment/); assert.doesNotMatch(tools, /tool\('adjust_part_stock'/);
console.log('AI assistant public cutover release gate: PASS');
