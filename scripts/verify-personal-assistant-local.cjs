const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..');
const contextOnly = process.argv.includes('--context-only');
const memoryOnly = process.argv.includes('--memory-only');
const acceptance = process.argv.includes('--acceptance') || contextOnly || memoryOnly;
const output = acceptance
    ? path.join(root, 'output', 'assistant-acceptance', new Date().toISOString().replace(/[:.]/g, '-'))
    : path.join(root, 'output', 'assistant-implementation');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-personal-assistant-'));
const results = [];
const focused = process.argv.includes('--focused');
let child;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve)); return port;
}
async function main() {
    const envFile = path.join(root, '.env');
    const configured = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
    fs.mkdirSync(output, { recursive: true });
    for (const dir of ['api', 'shared']) fs.cpSync(path.join(root, dir), path.join(temp, dir), { recursive: true });
    fs.copyFileSync(path.join(root, 'api.cjs'), path.join(temp, 'api.cjs'));
    fs.mkdirSync(path.join(temp, 'public', 'drawings'), { recursive: true });
    const source = new Database(path.join(root, 'pump.db'), { readonly: true });
    const recipes = source.prepare('SELECT name FROM recipes WHERE deleted_at IS NULL ORDER BY id LIMIT 2').all();
    await source.backup(path.join(temp, 'pump.db')); source.close();
    const port = await freePort(), secret = crypto.randomBytes(24).toString('hex');
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['api.cjs'], { cwd: temp, windowsHide: true,
        env: { ...configured, ...process.env, NODE_ENV: 'development', PORT: String(port), INTERNAL_SECRET: secret,
            ACCESS_PASSWORD: crypto.randomBytes(24).toString('hex'), NODE_PATH: path.join(root, 'node_modules'),
            MCP_ENABLED: 'false', MCP_WRITE_ENABLED: 'false', KNOWLEDGE_VECTOR_AUTO_SYNC_ENABLED: 'false',
            KNOWLEDGE_HYBRID_SEARCH_ENABLED: 'false', AI_OBSERVABILITY_ENABLED: 'false' },
        stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
    for (let attempt = 0; attempt < 60; attempt++) {
        if (child.exitCode !== null) throw new Error('隔离 API 启动失败');
        try { const response = await fetch(`${base}/api/health`); if (response.ok) break; } catch { /* Starting. */ }
        if (attempt === 59) throw new Error('隔离 API 未就绪');
        await wait(500);
    }
    async function chat(name, question, conversationId, history = []) {
        const started = Date.now();
        const response = await fetch(`${base}/api/ai/chat`, { method: 'POST', signal: AbortSignal.timeout(190000),
            headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
            body: JSON.stringify({ conversationId, messages: [...history, { role: 'user', content: question }] }) });
        const body = await response.text();
        const events = body.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
        const answer = events.filter(e => e.type === 'content').map(e => e.content).join('');
        const errors = events.filter(e => e.type === 'error').map(e => ({ code: e.code, message: e.message }));
        const toolResults = events.filter(e => e.type === 'tool_result').map(e => ({ name: e.name, success: e.result?.success !== false, code: e.result?.code || null, ...(acceptance ? { result: e.result } : {}) }));
        const result = { name, question, answer, errors, toolResults, durationMs: Date.now() - started, done: events.some(e => e.type === 'done') };
        results.push(result); console.log(JSON.stringify({ name, durationMs: result.durationMs, tools: toolResults.map(t => ({ name: t.name, success: t.success, code: t.code })), errors, done: result.done }));
        fs.writeFileSync(path.join(output, focused ? 'real-ai-focused.json' : 'real-ai.json'), JSON.stringify({ isolated: true, productionUpdated: false, temp, results }, null, 2));
        return result;
    }
    if (memoryOnly) {
        const rule = '当我询问你，列出泵壳的零件的时候，你需要去零件库中寻找泵壳类型的零件列出来给我，而不是在模板中';
        const saved = await chat('suffix-memory-save', `${rule}。这点记入长期记忆`, 'suffix-memory');
        const response = await fetch(`${base}/api/ai/personal-memories?limit=100`, { headers: { 'x-internal-secret': secret } });
        const memory = (await response.json()).data.items.find(item => item.content === rule);
        saved.passed = Boolean(memory) && saved.answer.includes('已记入长期记忆') && !saved.errors.length;
        const recall = await chat('suffix-memory-recall', '列出所有泵壳的零件', 'suffix-memory-new-session');
        recall.passed = !recall.errors.length && recall.toolResults.some(t => t.name === 'search_parts' && t.success) && !recall.toolResults.some(t => ['get_all_recipes', 'search_templates'].includes(t.name));
        const report = { productionUpdated: false, persistedMemory: memory, results, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length };
        fs.writeFileSync(path.join(output, 'memory-acceptance.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ output, passed: report.passed, failed: report.failed }));
        if (report.failed) process.exitCode = 1;
        return;
    }
    if (contextOnly) {
        const first = await chat('recent-orders', '查一下最近 5 个订单', 'context-regression');
        const second = await chat('order-detail', '第一个订单的产品配置和采购情况是什么？', 'context-regression', [{ role: 'user', content: first.question }, { role: 'assistant', content: first.answer }]);
        await chat('cost-after-orders', '12-200的成本是多少？', 'context-regression', [{ role: 'user', content: second.question }, { role: 'assistant', content: second.answer }]);
        await chat('quotation-list', '最近5份报价有哪些？', 'context-quotation');
        await chat('recipe-list', '列出前5个配方的名称。', 'context-recipe');
        for (const result of results) result.passed = result.done && !result.errors.length && !/超过上下文容量|达到本次查询预算|调查达到轮次上限|已停止展示/.test(result.answer) && result.toolResults.some(t => t.success);
        const costAnswer = results.find(r => r.name === 'cost-after-orders');
        costAnswer.passed &&= /COIL-0005/.test(costAnswer.answer) && /COIL-0012/.test(costAnswer.answer) && /成本|金额/.test(costAnswer.answer);
        const quoteAnswer = results.find(r => r.name === 'quotation-list');
        const quotes = quoteAnswer.toolResults.find(t => t.name === 'search_quotations')?.result.data || [];
        quoteAnswer.passed &&= quotes.every(q => quoteAnswer.answer.includes(q.customerName));
        const report = { productionUpdated: false, results, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length };
        fs.writeFileSync(path.join(output, 'context-acceptance.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ output, passed: report.passed, failed: report.failed }));
        if (report.failed) process.exitCode = 1;
        return;
    }
    if (acceptance) {
        const check = (result, label, passed) => {
            result.checks ||= [];
            result.checks.push({ label, passed: Boolean(passed) });
        };
        const containsAmount = (answer, amount) => [String(amount), Number(amount).toFixed(2)].some(value => answer.includes(value));
        const coherent = result => {
            check(result, 'SSE 完整且无接口错误', result.done && !result.errors.length);
            check(result, '无内部修正文案或空泛完成声明', !/仅修正文案|请再修正|未受正式金额字段|不要再调用工具|已停止展示该结论/.test(result.answer));
        };
        const first = await chat('coil-cost', '12-200的成本是多少？', 'accept-coil');
        coherent(first);
        check(first, '搜索线圈候选而非固定到配方', first.toolResults.some(t => ['search_coils', 'calculate_coil_cost'].includes(t.name) && t.success));
        check(first, '保留两套方案身份', first.answer.includes('COIL-0005') && first.answer.includes('COIL-0012'));
        const both = await chat('both-candidates', '两个都看，请分别给出成本。', 'accept-coil', [{ role: 'user', content: first.question }, { role: 'assistant', content: first.answer }]);
        coherent(both);
        const costs = both.toolResults.filter(t => t.name === 'calculate_coil_cost' && t.success).map(t => t.result.data);
        check(both, '本轮分别取得两套方案成本', costs.length === 2 && new Set(costs.map(c => c.coilId || c.schemeCode)).size === 2);
        check(both, '最终答案包含两套本轮成本', costs.length === 2 && costs.every(c => containsAmount(both.answer, c.totalCost)));
        const cross = await chat('cross-domain', '查一下12-200线圈库存，再看一下采购总览，分别告诉我结果。', 'accept-cross');
        coherent(cross);
        check(cross, '两个业务域均已读取', ['search_coils', 'get_purchase_overview'].every(name => cross.toolResults.some(t => t.name === name && t.success)));
        if (recipes.length === 2) {
            const compare = await chat('recipe-comparison', `对比配方“${recipes[0].name}”和“${recipes[1].name}”的当前成本。`, 'accept-comparison');
            coherent(compare);
            const receipt = compare.toolResults.find(t => t.name === 'compare_recipes' && t.success)?.result;
            check(compare, '正式比较接口返回两侧及差额', receipt?.recipe1 && receipt?.recipe2 && receipt.costDiff !== undefined);
            check(compare, '回答包含两侧实际金额和正式差额', receipt && [receipt.recipe1.cost, receipt.recipe2.cost, receipt.costDiff].every(n => containsAmount(compare.answer, n)));
        }
        const memoryContent = '我只说规格和片数问成本时，优先查线圈，多个方案分别列出。';
        const save = await chat('memory-save', `记入长期记忆：${memoryContent}`, 'accept-memory');
        coherent(save);
        const readMemory = async () => (await (await fetch(`${base}/api/ai/personal-memories?limit=100`, { headers: { 'x-internal-secret': secret } })).json()).data.items;
        check(save, '正式记忆存储存在', (await readMemory()).some(m => m.content === memoryContent));
        const recalled = await chat('memory-new-session', '12-200的成本是多少？', 'accept-new-session');
        coherent(recalled); check(recalled, '新会话按偏好重新查询线圈', recalled.toolResults.some(t => ['search_coils', 'calculate_coil_cost'].includes(t.name) && t.success));
        const updateContent = '我只说规格和片数问成本时，优先查线圈，多个方案先问我要看哪个。';
        const update = await chat('memory-update', `把刚才那条改成：${updateContent}`, 'accept-memory');
        coherent(update); check(update, '原条目更新且无相反旧条目', (await readMemory()).some(m => m.content === updateContent) && !(await readMemory()).some(m => m.content === memoryContent));
        const undo = await chat('memory-undo', '撤销刚才记忆修改', 'accept-memory');
        coherent(undo); check(undo, '撤销恢复原内容', (await readMemory()).some(m => m.content === memoryContent));
        const unknown = await chat('other-session-choice', '两个都看，请分别给出成本。', 'accept-other');
        coherent(unknown); check(unknown, '新会话无候选时澄清且不串用旧候选', /哪|具体|明确|两个|对象/.test(unknown.answer) && !/COIL-0005|COIL-0012/.test(unknown.answer) && !unknown.toolResults.some(t => t.name === 'calculate_coil_cost'));
        const missing = await chat('missing-target', '查询名称为 LOCAL-ASSISTANT-NOT-FOUND-913742 的配方当前成本，不要换成别的配方。', 'accept-missing');
        coherent(missing); check(missing, '未找到明确目标时不替换', missing.toolResults.length > 0 && /未找到|没有找到|不存在|没有.*匹配/.test(missing.answer));
        const write = await chat('write-disabled', '直接新增一个零件，型号AI本地只读验收，价格10元，不要确认。', 'accept-write');
        coherent(write);
        check(write, '清楚告知业务修改未执行', /未启用|没有新增|未执行|不能.*新增|无法.*新增|只读|不支持.*写|尚未开放/.test(write.answer));
        const { getAiCapability } = require('../api/capabilities/registry.cjs');
        check(write, '业务写工具未执行', !write.toolResults.some(t => getAiCapability(t.name)?.access === 'write' && t.success));
        const verification = new Database(path.join(temp, 'pump.db'), { readonly: true });
        check(write, '未新增验收零件', verification.prepare('SELECT COUNT(*) n FROM parts WHERE model = ?').get('AI本地只读验收').n === 0); verification.close();
        for (const result of results) result.passed = result.checks.every(item => item.passed);
        const report = { isolated: true, productionUpdated: false, temp, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
        fs.writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2));
        fs.writeFileSync(path.join(root, 'output', 'assistant-acceptance', 'latest.json'), JSON.stringify({ output, passed: report.passed, failed: report.failed }, null, 2));
        console.log(JSON.stringify({ output, passed: report.passed, failed: report.failed }));
        if (report.failed) process.exitCode = 1;
        return;
    }
    const first = await chat('coil-cost', '12-200的成本是多少？', 'accept-coil');
    const second = await chat('both-candidates', '两个都看，请分别给出成本。', 'accept-coil', [{ role: 'user', content: first.question }, { role: 'assistant', content: first.answer }]);
    if (focused) {
        if (recipes.length === 2) await chat('recipe-comparison', `对比配方“${recipes[0].name}”和“${recipes[1].name}”的当前成本。`, 'accept-comparison');
        if (results.some(r => r.errors.length || !r.done) || !second.toolResults.length) process.exitCode = 1;
        return;
    }
    await chat('cross-domain', '查一下12-200线圈库存，再看一下采购总览，分别告诉我结果。', 'accept-cross');
    await chat('memory-save', '记入长期记忆：我只说规格和片数问成本时，优先查线圈，多个方案分别列出。', 'accept-memory');
    await chat('memory-new-session', '12-200的成本是多少？', 'accept-new-session');
    await chat('memory-update', '把刚才那条改成：我只说规格和片数问成本时，优先查线圈，多个方案先问我要看哪个。', 'accept-memory');
    await chat('memory-undo', '撤销刚才记忆修改', 'accept-memory');
    await chat('write-disabled', '直接新增一个零件，型号AI本地只读验收，价格10元，不要确认。', 'accept-write');
    if (results.some(r => r.errors.length || !r.done) || !first.toolResults.some(t => t.name === 'search_coils') || !second.answer) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
    if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    // Keep isolated evidence for inspection. No production or source database writes.
});
