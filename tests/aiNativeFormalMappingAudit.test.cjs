const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAudit } = require('../scripts/ai-experiments/api-index/audit-ai-action-mappings.cjs');
const { getBusinessCapability } = require('../api/capabilities/registry.cjs');

test('Phase A2 audits every unlinked action without fabricating a formal link', () => {
    const { matrix, classification, eligibility, overview } = buildAudit();
    assert.equal(matrix.length, 36);
    assert.equal(new Set(matrix.map(row => row.toolName)).size, 36);
    assert.equal(overview.aiActions, 84);
    assert.equal(overview.formalBusinessCapabilities, 147);
    assert.equal(Object.values(classification).reduce((a, b) => a + b, 0), 36);
    assert.equal(Object.values(eligibility).reduce((a, b) => a + b, 0), 36);
    for (const row of matrix) {
        assert.deepEqual(row.currentFormalCapabilityIds, [], row.toolName);
        assert.ok(row.mappingEvidence.length >= 3, row.toolName);
        assert.ok(row.actualApiRoutes.length, row.toolName);
        assert.ok(row.actualBusinessBehavior, row.toolName);
        assert.ok(row.indexReason, row.toolName);
        row.recommendedFormalCapabilityIds.forEach(id => assert.ok(getBusinessCapability(id), `${row.toolName}: ${id}`));
        if (row.proposedFormalCapabilityId) {
            assert.equal(row.proposedFormalCapabilityStatus, 'PROPOSED_ONLY');
            assert.equal(getBusinessCapability(row.proposedFormalCapabilityId), null);
        }
        const [file, members] = row.actualServices[0].split('::');
        const rel = file.endsWith('Executors.cjs') ? `api/routes/ai/executors/${file}` : `api/routes/${file}`;
        const source = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        members.split('+').forEach(member => assert.ok(source.includes(member.split('.').at(-1)), `${row.toolName}: ${member}`));
    }
});

test('Phase A2 cost mapping keeps direct differences separate from composite and missing formal costs', () => {
    const byName = Object.fromEntries(buildAudit().matrix.map(row => [row.toolName, row]));
    for (const name of ['compare_recipes', 'explain_cost_change']) {
        assert.equal(byName[name].primaryClass, 'DIRECT_FORMAL_MAPPING');
        assert.deepEqual(byName[name].recommendedFormalCapabilityIds, ['cost.recipe_difference']);
    }
    assert.equal(byName.preview_recipe_cost.primaryClass, 'LEGACY_COMPOSITE_OR_DERIVED');
    assert.ok(byName.preview_recipe_cost.actualApiRoutes.length >= 4);
    assert.equal(byName.calculate_coil_cost.primaryClass, 'FORMAL_READ_CAPABILITY_GAP');
    assert.equal(byName.get_copper_price.primaryClass, 'FORMAL_READ_CAPABILITY_GAP');
    assert.equal(byName.get_coil_specs.primaryClass, 'FORMAL_READ_CAPABILITY_GAP');
    assert.equal(byName.get_rotor_drawing_history.primaryClass, 'FORMAL_READ_CAPABILITY_GAP');
});
