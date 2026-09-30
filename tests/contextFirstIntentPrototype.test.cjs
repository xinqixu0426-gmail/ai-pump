'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { messagesForBusiness } = require('../scripts/ai-experiments/context-first-intent/businessUnderstandingAgent.cjs');
const { messagesForOntology } = require('../scripts/ai-experiments/context-first-intent/ontologyContextAgent.cjs');
const { messagesForIntent } = require('../scripts/ai-experiments/context-first-intent/intentAgent.cjs');
const { loadContextSources } = require('../scripts/ai-experiments/context-first-intent/contextSources.cjs');
const { executeCase } = require('../scripts/ai-experiments/context-first-intent/orchestrator.cjs');

const root = path.resolve(__dirname, '..');
const sampleSources = loadContextSources();

test('the two context agents run concurrently and intent waits for both memos', async () => {
    let arrivals = 0; let release;
    const bothStarted = new Promise(resolve => { release = resolve; });
    const order = [];
    const blockContext = async name => { order.push(`${name}:start`); arrivals += 1; if (arrivals === 2) release(); await bothStarted; order.push(`${name}:finish`); return `${name} memo`; };
    const run = await executeCase({ id: 'T', userInput: '原话' }, sampleSources, {
        runBusiness: () => blockContext('business'), runOntology: () => blockContext('ontology'),
        runIntent: async input => { order.push('intent'); assert.equal(input.businessMemo, 'business memo'); assert.equal(input.ontologyMemo, 'ontology memo'); return 'intent memo'; },
    });
    assert.deepEqual(order.slice(0, 2).sort(), ['business:start', 'ontology:start']);
    assert.ok(order.indexOf('intent') > order.indexOf('business:finish'));
    assert.ok(order.indexOf('intent') > order.indexOf('ontology:finish'));
    assert.equal(run.parallelProof.intervalsOverlap, true);
});

test('all agents receive the raw user input and necessary conversation directly', () => {
    const input = { userInput: '刚才那个线圈多少钱？', recentConversation: 'User: 我先看一下12-120。', businessModel: 'BUSINESS', domainPolicy: 'POLICY', ontologyText: 'ONTOLOGY', businessMemo: 'BM', ontologyMemo: 'OM' };
    for (const messages of [messagesForBusiness(input), messagesForOntology(input), messagesForIntent(input)]) {
        assert.ok(messages.some(message => message.role === 'user' && message.content.includes(input.userInput)));
        assert.ok(messages.some(message => message.role === 'user' && message.content.includes(input.recentConversation)));
    }
});

test('Business receives full Business Model and Domain Policy, but no Ontology', () => {
    const input = { userInput: '12-120是什么？', recentConversation: '', businessModel: 'FULL BUSINESS MODEL sentinel', domainPolicy: 'FULL POLICY sentinel' };
    const serialized = JSON.stringify(messagesForBusiness(input));
    assert.ok(serialized.includes(input.businessModel)); assert.ok(serialized.includes(input.domainPolicy));
    assert.doesNotMatch(serialized, /ONTOLOGY sentinel|ontologyText/);
});

test('Ontology receives complete active ontology definitions and no Domain Policy or business model', () => {
    const serialized = JSON.stringify(messagesForOntology({ userInput: '12-120是什么？', recentConversation: '', ontologyText: sampleSources.ontologyText }));
    assert.ok(serialized.includes('coil.commonDesignation'));
    assert.ok(serialized.includes('recipe.uses_template'));
    assert.ok(serialized.includes('template.uses_shell_part'));
    assert.ok(serialized.includes('part.isStainless'));
    assert.doesNotMatch(serialized, /Published Domain Policy|RULE-01|FULL BUSINESS MODEL/);
});

test('Intent receives raw utterance and both full memos without business/tool or database source context', () => {
    const input = { userInput: 'V750成本，还有它现在用哪个线圈。', recentConversation: '', businessMemo: 'COMPLETE BUSINESS MEMO', ontologyMemo: 'COMPLETE ONTOLOGY MEMO' };
    const serialized = JSON.stringify(messagesForIntent(input));
    for (const required of [input.userInput, input.businessMemo, input.ontologyMemo]) assert.ok(serialized.includes(required));
    assert.doesNotMatch(serialized, /Business API|Tool definitions|Capability Registry|api\/ontology\/|company-business-model-v1/);
});

test('all three model prompts deny business tools and the provider call uses an empty tool list', () => {
    const context = { userInput: '读取业务数据', recentConversation: '', businessModel: 'B', domainPolicy: 'P', ontologyText: 'O', businessMemo: 'BM', ontologyMemo: 'OM' };
    for (const messages of [messagesForBusiness(context), messagesForOntology(context), messagesForIntent(context)]) {
        assert.match(messages[0].content, /Tool|API|工具/);
    }
    const modelClient = fs.readFileSync(path.join(root, 'scripts/ai-experiments/context-first-intent/modelClient.cjs'), 'utf8');
    assert.match(modelClient, /tools:\s*\[\]/);
});

test('prototype source modules have no DB, production business tool, or production runtime imports', () => {
    const prototypeDir = path.join(root, 'scripts/ai-experiments/context-first-intent');
    const files = fs.readdirSync(prototypeDir).filter(file => file.endsWith('.cjs'));
    for (const file of files) {
        const source = fs.readFileSync(path.join(prototypeDir, file), 'utf8');
        assert.doesNotMatch(source, /require\([^)]*(?:api\/db\.cjs|api\/database|services\/ai-assistant\/runtime|capabilities\/registry|routes\/|tools\.cjs)/);
        assert.doesNotMatch(source, /\b(?:WRITE_TOOLS|businessTool|callBusinessApi)\b/);
    }
    for (const directory of ['api', 'apps']) {
        const scan = dir => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const target = path.join(dir, entry.name);
                if (entry.isDirectory()) scan(target);
                else if (/\.(?:cjs|mjs|js|ts|tsx)$/.test(entry.name)) {
                    const source = fs.readFileSync(target, 'utf8');
                    assert.doesNotMatch(source, /scripts\/ai-experiments\/context-first-intent/);
                }
            }
        };
        scan(path.join(root, directory));
    }
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'api.cjs'), 'utf8'), /scripts\/ai-experiments\/context-first-intent/);
});
