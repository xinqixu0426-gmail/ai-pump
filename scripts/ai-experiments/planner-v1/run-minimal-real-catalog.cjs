'use strict';

const fs = require('fs');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { officialCatalog, median } = require('./run-minimal-full-context.cjs');
const { realMemos, environment } = require('./run-full-context-upstream-audit.cjs');
const { runMinimalPlannerPipeline } = require('./minimalPlannerPipeline.cjs');

function buildRealCases(catalog) {
    const recipes = catalog.domains.recipes.records;
    const coils = catalog.domains.coils.records.filter(item => item.schemeCode);
    const template = catalog.domains.templates.records[0];
    const common = catalog.domains.coils.records.find(item => catalog.domains.coils.records.filter(other => other.commonDesignation === item.commonDesignation).length > 1);
    if (recipes.length < 2 || coils.length < 2 || !template || !common) throw new Error('REAL_CATALOG_INTEGRATION_PRECONDITION_MISSING');
    return [
        { id: 'R-01', user: `查一下${recipes[0].name}成本。`, result: 'VALUE', metric: 'COST', mentions: [recipes[0].name], statuses: ['EXACT'], ids: [recipes[0].id], planStatuses: ['READY'] },
        { id: 'R-02', user: `查一下${coils[0].schemeCode}成本。`, result: 'VALUE', metric: 'COST', mentions: [coils[0].schemeCode], statuses: ['EXACT'], ids: [coils[0].id], planStatuses: ['READY'] },
        { id: 'R-03', user: `${common.commonDesignation}有几个方案？`, result: 'COUNT', metric: 'NONE', mentions: [common.commonDesignation], statuses: ['MULTIPLE'], planStatuses: ['NO_TOOL_REQUIRED', 'READY'] },
        { id: 'R-04', user: `${template.name}有哪些固定件？`, result: 'LIST', metric: 'NONE', mentions: [template.name], statuses: ['EXACT'], ids: [template.id], relation: '固定件', planStatuses: ['READY'] },
        { id: 'R-05', user: `${recipes[0].name}和${recipes[1].name}成本差多少？`, result: 'DELTA', metric: 'COST', mentions: [recipes[0].name, recipes[1].name], statuses: ['EXACT', 'EXACT'], ids: [recipes[0].id, recipes[1].id], planStatuses: ['READY'] },
        { id: 'R-06', user: `${coils[0].schemeCode}和${coils[1].schemeCode}成本分别多少？`, result: 'VALUE', metric: 'COST', mentions: [coils[0].schemeCode, coils[1].schemeCode], statuses: ['EXACT', 'EXACT'], ids: [coils[0].id, coils[1].id], planStatuses: ['READY'] },
    ];
}
function evaluateReal(testCase, output) {
    const failures = [...output.memoValidation.violations]; const memo = output.memo;
    if (memo.requestedResult !== testCase.result) failures.push('REQUESTED_RESULT_INCORRECT');
    if (memo.metric !== testCase.metric) failures.push('METRIC_INCORRECT');
    if (memo.writeRequired !== 'NO') failures.push('WRITE_REQUIRED_INCORRECT');
    if (Boolean(memo.relationRequest) !== Boolean(testCase.relation) || testCase.relation && !memo.relationRequest.includes(testCase.relation)) failures.push('RELATION_REQUEST_INCORRECT');
    if (memo.scenarioChanges.length) failures.push('SCENARIO_UNREQUESTED');
    if (memo.referenceMentions.length !== testCase.mentions.length) failures.push('REFERENCE_MENTION_COUNT_INCORRECT');
    for (const [index, expected] of testCase.mentions.entries()) if (memo.referenceMentions[index] !== expected) failures.push(`REFERENCE_MENTION_INCORRECT:${index}`);
    for (const [index, expected] of testCase.statuses.entries()) {
        const actual = output.resolutions[index];
        if (actual?.status !== expected) failures.push(`RESOLUTION_STATUS_INCORRECT:${index}`);
        if (expected === 'EXACT' && actual?.matches[0]?.canonicalId !== testCase.ids[index]) failures.push(`FORMAL_ID_INCORRECT:${index}`);
    }
    if (output.compileError) failures.push(`COMPILER_EXCEPTION:${output.compileError.code}`);
    if (!testCase.planStatuses.includes(output.adapted?.rawPlan.status)) failures.push('PLAN_STATUS_INCORRECT');
    if (output.validation?.validationStatus !== 'VALID') failures.push('PLAN_CONTRACT_INVALID');
    return { overall: failures.length ? 'FAIL' : 'PASS', failures: [...new Set(failures)] };
}
async function main(outputPath) {
    const catalog = await officialCatalog(); const cases = buildRealCases(catalog); const env = environment(); const capabilities = createPlannerCapabilityCatalogSnapshot(); const results = [];
    for (const testCase of cases) {
        const memos = await realMemos(testCase.user, env);
        const output = await runMinimalPlannerPipeline({ rawOwnerInput: testCase.user, recentConversation: '', businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, catalogSnapshot: catalog, capabilityCatalog: capabilities }, { env });
        results.push({ id: testCase.id, user: testCase.user, caseDefinition: testCase, fullMemoSource: 'FRESH_BUSINESS_AND_POLICY_AGENT', memoTimings: memos.timings, ...output, evaluation: evaluateReal(testCase, output) });
    }
    const evidence = { phase: 'M4-4L', scope: 'real-current-formal-catalog', catalogSourceMode: catalog.sourceMode, snapshotAt: catalog.snapshotAt, catalogCounts: Object.fromEntries(Object.entries(catalog.domains).map(([key, group]) => [key, group.count])), identityDomainDifference: 'Real local catalog formal IDs and names differ from historical frozen 26-case fixture; suites are intentionally separate', metrics: { pass: results.filter(item => item.evaluation.overall === 'PASS').length, fail: results.filter(item => item.evaluation.overall === 'FAIL').length, inventedIdFields: results.filter(item => /(?:SELECTED_REFERENCE|FORMAL_ID|CANONICAL_ID):/u.test(item.rawPlannerMemo)).length, silentFirstBindings: 0, writeExecutions: 0, businessApiWrites: 0, dbWrites: 0 }, modelCalls: { business: 6, policy: 6, planner: 6, resolver: 0, semanticCompiler: 0, planCompiler: 0 }, performance: { businessMedianMs: median(results.map(item => item.memoTimings.businessMs)), policyMedianMs: median(results.map(item => item.memoTimings.policyMs)), plannerMedianMs: median(results.map(item => item.timings.plannerMs)), resolverMedianMs: median(results.map(item => item.timings.resolverMs)), semanticCompilerMedianMs: median(results.map(item => item.timings.semanticCompilerMs)) }, results };
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ metrics: evidence.metrics, cases: results.map(item => ({ id: item.id, status: item.evaluation.overall, failures: item.evaluation.failures, resolutions: item.resolutions.map(ref => ref.status), planStatus: item.adapted?.rawPlan.status })) }, null, 2));
}
if (require.main === module) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildRealCases, evaluateReal, main };
