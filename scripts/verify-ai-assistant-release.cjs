'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const chat = read('api/routes/ai/chat.cjs');
const routes = read('api/routes/ai.cjs');
const runtime = read('api/services/ai-assistant/runtime.cjs');
const policyStore = read('api/services/ai-assistant/domainPolicyStore.cjs');
const context = read('api/services/ai-assistant/context.cjs');
const tools = read('api/services/ai-assistant/agentTools.cjs');
const mainAgent = read('api/services/ai-assistant/mainAgent.cjs');
const broker = read('api/services/ai-assistant/capabilityBroker.cjs');
const agentResolver = read('api/ontology/agentResolver.cjs');
const factLedger = read('api/services/ai-assistant/factLedger.cjs');
const answerValidator = read('api/services/ai-assistant/answerValidator.cjs');
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
assert.match(runtime, /getPublishedPolicySnapshot/); assert.match(runtime, /buildInvestigationContext/); assert.doesNotMatch(runtime, /loadDomainPolicy/);
assert.match(chat, /pageContext/); assert.match(chat, /attachments/);
assert.match(policyStore, /domain_policy_versions/); assert.match(policyStore, /DOMAIN_POLICY_CONFLICT/);
assert.match(context, /不是正式业务事实/);
assert.match(tools, /prepare_part_stock_adjustment/); assert.doesNotMatch(tools, /tool\('adjust_part_stock'/);
assert.match(mainAgent, /selectCapabilities/); assert.doesNotMatch(mainAgent, /\bAGENT_TOOLS\b/);
assert.match(broker, /listAiCapabilities/); assert.match(broker, /capability\.access !== 'write'/);
assert.match(broker, /AGENT_CAPABILITY_NOT_SELECTED/); assert.match(broker, /AGENT_TOOL_IDENTITY_UNVERIFIED/);
assert.match(agentResolver, /lookupEntities/); assert.match(agentResolver, /AMBIGUOUS/);
assert.match(tools, /resolve_entity/); assert.match(tools, /resolve_page_context_entity/);
assert.match(runtime, /createFactLedger/); assert.match(mainAgent, /validateAnswer/);
assert.match(factLedger, /FORMAL_API/); assert.match(factLedger, /technicalFailure/);
assert.match(answerValidator, /GOAL_STATUS_MISSING/); assert.match(answerValidator, /MONEY_CLAIM_UNGROUNDED/);
assert.doesNotMatch(mainAgent, /toolResults\.length\s*===\s*0/);
console.log('AI assistant public cutover release gate: PASS');
