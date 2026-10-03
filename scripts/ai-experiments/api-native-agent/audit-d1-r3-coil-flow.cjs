'use strict';

// R3 evidence-only audit: it starts the same isolated formal HTTP fixture as
// the controlled suite and follows a real search_coils result through the
// Executor, Agent adapter, ledger, model projection and claimable catalog.
const fs = require('node:fs');
const path = require('node:path');
const { startD1R1ControlledFixture } = require('./d1r1ControlledFixture.cjs');
const { executeAgentTool } = require('../../../api/services/ai-assistant/agentTools.cjs');
const { createFactLedger, modelProjection } = require('../../../api/services/ai-assistant/factLedger.cjs');
const { renderClaimableFactsForModel } = require('./apiNativeAgentCandidate.cjs');

const root = path.resolve(__dirname, '../../..');
const fields = ['id', 'schemeCode', 'schemeName', 'cost', 'totalCost', 'unitCost', 'unitPrice', 'kitPrice', 'pricingMode'];
function extract(row) { return Object.fromEntries(fields.map(field => [field, row?.[field] === undefined ? 'MISSING' : row[field]])); }

async function main(output = path.join(root, 'planning/ai-native-api/M5-D1-R3-Coil-Evidence-Flow.json')) {
    const fixture = await startD1R1ControlledFixture();
    try {
        const { executeToolCall } = require('../../../api/routes/ai/executor.cjs');
        const args = { spec: '12', sheets: 120 };
        const raw = await executeToolCall('search_coils', args, { allowWrite: false });
        const context = { selectedToolNames: new Set(['search_coils']), entityBindings: new Map() };
        const agent = await executeAgentTool('search_coils', args, context, { executeToolCall });
        const ledger = createFactLedger({ includeCoilDirectoryCostFacts: true });
        const appended = ledger.appendToolResult({ toolName: 'search_coils', args, result: agent, entityBindings: context.entityBindings });
        const projection = modelProjection(agent, appended.factIds);
        const catalog = renderClaimableFactsForModel(ledger.snapshot());
        const rows = (raw.data || []).filter(row => ['12-120-A', '12-120-B'].includes(row.schemeCode));
        const evidence = {
            runId: `d1-r3-coil-flow-${Date.now()}`,
            source: 'isolated temporary SQLite + real Executor + formal GET /api/coils',
            fixtureKind: fixture.fixtureKind,
            localBusinessDbTouched: false,
            productionDbTouched: false,
            args,
            fieldFlowMatrix: fields.map(field => ({ field,
                formalApi: rows.map(row => ({ schemeCode: row.schemeCode, value: row[field] === undefined ? 'MISSING' : row[field] })),
                executor: rows.map(row => ({ schemeCode: row.schemeCode, value: raw.data.find(item => item.id === row.id)?.[field] === undefined ? 'MISSING' : raw.data.find(item => item.id === row.id)?.[field] })),
                agentResult: rows.map(row => ({ schemeCode: row.schemeCode, value: agent.data.find(item => item.id === row.id)?.[field] === undefined ? 'MISSING' : agent.data.find(item => item.id === row.id)?.[field] })),
                ledger: ledger.facts().filter(fact => fact.entity?.canonicalName && rows.some(row => row.schemeCode === fact.entity.canonicalName) && (field === 'cost' ? fact.predicate === 'coil_directory_cost' : String(fact.predicate).endsWith(field))).map(fact => ({ entity: fact.entity.canonicalName, predicate: fact.predicate, value: fact.value, basis: fact.basis, unit: fact.unit, moneyRole: fact.qualifiers?.moneyRole || null })),
                modelProjection: field === 'cost' ? projection.data?.map(row => ({ schemeCode: row.schemeCode, value: row.cost })) : 'NOT_SEPARATELY_PROJECTED',
                claimableCatalog: field === 'cost' ? catalog.filter(item => item.predicate === 'coil_directory_cost') : 'NOT_CLAIMABLE_AS_TOTAL_COST',
            })),
            rawRecords: rows.map(extract),
            formalApiResult: raw,
            agentResult: agent,
            ledgerFacts: ledger.facts(),
            modelProjection: projection,
            claimableCatalog: catalog,
            conclusion: 'The formal list provides each coil scheme cost. R3 preserves it as a per-record FORMAL_COIL_DIRECTORY_COST fact; price parameters remain non-claimable as complete cost.',
        };
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
        console.log(JSON.stringify({ output, rows: rows.map(extract), ledgerCostFacts: ledger.facts().filter(fact => fact.predicate === 'coil_directory_cost').length }, null, 2));
        return evidence;
    } finally { await fixture.close(); }
}
if (require.main === module) main(process.env.D1_R3_COIL_FLOW_OUTPUT || undefined).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { main };
