'use strict';
const crypto = require('node:crypto');
const frozen = require('../fixtures/ontology-coil-recipe-canary-v1.json');
const { rows, toolFor } = require('./ontologyBindingCorpus.cjs');
const { formal, boundRecipeDetail } = require('./ontologyShadowFixture.cjs');
const { beginAssistantSession } = require('../../api/services/aiAssistantSession.cjs');
const { buildEvidenceBundle } = require('../../api/services/aiEvidenceBundle.cjs');
const { createTaskEnvelope } = require('../../api/services/aiTaskEnvelope.cjs');
const extra = [
    ['recipe-configuration', 'Shadow配方甲换成12-120线圈成本多少？'],
    ['bom-configuration', '用Shadow配方甲和12-120线圈构建BOM试算'],
    ['coil-comparison', '比较12-120线圈和13-120线圈'],
    ['configuration-query', 'Shadow配方甲的线圈配置怎么样？'],
];
const cases = [...frozen.cases, ...extra.map(([caseId, userText]) => ({ caseId, userText, category: 'negative' }))];
const negativeClasses = { 'coil-cost': 'COIL_COST_QUERY', 'coil-stock': 'COIL_INVENTORY_QUERY', 'recipe-cost': 'RECIPE_COST_QUERY',
    'cost-compare': 'COIL_COMPARISON', 'coil-write': 'WRITE_OR_COMMAND', 'recipe-write': 'WRITE_OR_COMMAND', similar: 'OTHER', semantic: 'OTHER',
    'two-coils': 'AMBIGUOUS', 'two-recipes': 'AMBIGUOUS', 'ambiguous-root': 'AMBIGUOUS', unsupported: 'OTHER',
    'mixed-recipe-coil-cost': 'COIL_COST_QUERY', 'mixed-recipe-coil-stock': 'COIL_INVENTORY_QUERY',
    'mixed-cost-compare-relation': 'COIL_COMPARISON', 'mixed-write-relation': 'WRITE_OR_COMMAND',
    'recipe-configuration': 'RECIPE_CONFIGURATION_QUERY', 'bom-configuration': 'BOM_CONFIGURATION_QUERY',
    'coil-comparison': 'COIL_COMPARISON', 'configuration-query': 'RECIPE_CONFIGURATION_QUERY' };
function seedResults(c) {
    return (c.sessionType ? [c.sessionType] : ['coil', 'recipe']).map(type => toolFor(type,
        c.ambiguousType === type ? [rows[type], { ...rows[type], id: rows[type].id + 1 }] : [rows[type]]));
}
async function runCase(c, flag, runAiAssistant, options = {}) {
    const conversationId = `p6r-${crypto.randomUUID()}`, subject = 'p6r-fixture-owner';
    if (options.seed !== false) beginAssistantSession(subject, conversationId).finish({ toolResults: seedResults(c) });
    const catalogs = [], prompts = [], executed = [], events = [], records = [];
    let modelCalls = 0, legacyDetectorCalls = 0, legacyRepairCalls = 0;
    const shortlist = require('../../api/services/aiToolShortlist.cjs');
    const reply = message => ({ json: async () => ({ choices: [{ message }] }) });
    const call = (name, n) => ({ id: `fixture-${n}-${name}`, type: 'function', function: { name, arguments:
        JSON.stringify(name === 'calculate_coil_cost' || name === 'search_coils' && /12-120/u.test(c.userText) ? { spec: '12', sheets: 120 }
            : ['preview_recipe_cost', 'get_recipe_technical_files'].includes(name) ? { recipeId: 301 } : {}) } });
    const result = await runAiAssistant({ messages: [{ role: 'user', content: c.userText }], confirmationSubject: subject, conversationId,
        env: { AI_PROVIDER: options.mode || 'local', AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true',
            AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED: flag, ...options.env },
        ontologyRelationCanaryEligible: true,
        emit: (type, data) => events.push({ type, data }), ...options.input }, {
        loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
        ontologyRouting: { ...options.routing, record: r => { records.push(r); options.record?.(r); } },
        legacyRelationDetector: text => { legacyDetectorCalls++; if (options.forbidLegacy) throw Error('LEGACY_DETECTOR_USED'); return shortlist.isCoilRecipeRelationQuery(text); },
        legacyRelationRepair: (name, text) => { legacyRepairCalls++; if (options.forbidLegacy) throw Error('LEGACY_REPAIR_USED');
            return require('../../api/services/aiAssistantRuntime.cjs').requiredCoilRecipeToolCall(name, text); },
        fetchAiProvider: async (messages, o) => {
            modelCalls++; catalogs.push(o.tools.map(t => t.function.name));
            prompts.push(messages.filter(m => m.role === 'system').map(m => m.content));
            const repair = messages.findLast(m => m.role === 'system' && m.content.startsWith('上一响应没有发送给用户。这个问题要求核对线圈与配方的关联'));
            if (modelCalls === 1 && o.tools.length) return reply({ tool_calls: [call(o.tools[0].function.name, modelCalls)] });
            if (repair && modelCalls === 3) {
                const names = repair.content.match(/尚未调用：([^。]+)/u)[1].split('、');
                return reply({ tool_calls: names.map(name => call(name, modelCalls)) });
            }
            return reply({ content: '已核实：Shadow配方甲使用Shadow线圈甲（12-120）。' });
        },
        executeToolCall: async (name, args, o) => {
            if (o.allowWrite !== false) throw Error('WRITE_ACCESS'); executed.push({ name, args });
            if (name === 'get_all_recipes') return toolFor('recipe').result;
            if (name === 'search_coils') return toolFor('coil').result;
            // ONT-P8L-FINAL: the recipe-rooted direction now certifies its coil through this bounded read
            // instead of the whole catalogue. The result must match the real executor's shape (a single
            // `recipe` object at the top level, not a `data` array) or the ontology cannot use it.
            if (name === 'get_recipe_detail') {
                const detail = boundRecipeDetail(Number(args.recipeId) || 301).result;
                return formal(`/api/recipes/${detail.recipe.id}`, { recipe: detail.recipe });
            }
            return formal('/api/coils/cost-preview', { data: [], count: 0, totalCost: 100 });
        }, ...options.dependencies,
    });
    const signature = { catalogs, executed, finalContent: result.finalContent, modelCalls,
        selectedTools: executed.map(t => t.name),
        deterministicRepair: events.some(e => e.type === 'status' && e.data.message === '正在补齐线圈与配方关联查询...')
            && !prompts.some(p => p.some(t => t.startsWith('上一响应没有发送给用户。这个问题要求核对线圈与配方的关联'))),
        results: result.toolResults, evidence: buildEvidenceBundle(createTaskEnvelope(c.userText), result.toolResults),
        // Ignore session-specific prior-context text; retain every completion instruction.
        repairPrompts: prompts.map(p => p.filter(t => t.startsWith('上一响应') || t.startsWith('刚才的回答'))),
    };
    return { signature: JSON.parse(JSON.stringify(signature)), result, records, legacyDetectorCalls, legacyRepairCalls, events };
}
module.exports = { cases, negativeClasses, seedResults, runCase };
