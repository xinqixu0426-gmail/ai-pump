const { generateCatalogName } = require('./catalogNaming.cjs');

// Read-only migration proposals. This adapter is deliberately separate from future
// formal naming validation: a parseable old name is not proof of physical identity.
function extractPartCandidate(row) {
    const name = String(row.model || '').trim();
    const category = String(row.category || '');
    const result = { extractedSpec: {}, suggestedName: null, missingFields: [], basis: 'manual_review' };
    let match;
    if (category === '轴承' && /^\d+$/.test(name)) {
        result.extractedSpec = { catalogCode: name };
        result.suggestedName = `轴承-${name}`;
        result.basis = 'exact_catalog_code';
    } else if (category === '电容' && (match = name.match(/^(\d+(?:\.\d+)?)μF$/))) {
        result.extractedSpec = { capacitanceUf: Number(match[1]) };
        result.suggestedName = `电容-${Number(match[1])}μF`;
        result.basis = 'explicit_capacitance_unit';
    } else if (category === '螺丝' && (match = name.match(/^(\d+(?:\.\d+)?)\*(\d+(?:\.\d+)?)-(?:201-内六|内六-201)(-组合)?$/))) {
        result.extractedSpec = { diameter: Number(match[1]), length: Number(match[2]), material: '201', headStyle: '内六角', combination: Boolean(match[3]) };
        result.suggestedName = `内六角螺丝-${Number(match[1])}*${Number(match[2])}-201${match[3] || ''}`;
        result.basis = 'complete_legacy_screw_tokens';
    } else if (category === '油封') {
        result.extractedSpec = { legacyDimensions: name };
        result.missingFields = ['sealType', 'dimensionMeaning'];
        if (/^\d+(?:\.\d+)?\*\d+(?:\.\d+)?$/.test(name)) result.missingFields.push('thickness');
    } else if (category === '电缆线' || category === '浮球') {
        match = name.match(category === '电缆线' ? /^电缆-线径(\d+(?:\.\d+)?)$/ : /线径(\d+(?:\.\d+)?)$/);
        if (match) result.extractedSpec = { legacyWireValue: Number(match[1]) };
        if (match && category === '电缆线') {
            // Owner-confirmed: legacy cable values select a cross-section's per-metre price.
            result.extractedSpec = { wireValue: Number(match[1]), wireMeasure: '截面积', wireUnit: 'mm²' };
            try {
                result.suggestedName = generateCatalogName({ ruleId: 'cable', spec: result.extractedSpec }).name;
                result.basis = 'confirmed_cable_cross_section';
            } catch (error) {
                if (error.statusCode !== 400) throw error;
                result.missingFields = ['validCrossSection'];
            }
        } else {
            result.missingFields = ['wireMeasure', 'wireUnit'];
        }
    } else {
        result.missingFields = ['structuredSpecification'];
    }
    // Only the owner-confirmed cable unit is applied; other dimensional meanings remain unconfirmed.
    return result;
}

function buildNamingCandidates(catalogs, references) {
    const types = ['part', 'coil', 'template', 'recipe', 'modelVariant'];
    const rows = [];
    for (const type of types) {
        for (const row of catalogs.get(type) || []) {
            const originalName = type === 'part' ? row.model : type === 'coil' ? row.scheme_name
                : type === 'template' ? row.shell_model : type === 'recipe' ? row.name : row.model_name;
            const extracted = type === 'part' ? extractPartCandidate(row) : {
                extractedSpec: type === 'coil' ? { spec: row.spec, sheets: row.sheets, material: row.material, slotType: row.slot_type, schemeCode: row.scheme_code }
                    : {},
                suggestedName: null, missingFields: ['confirmedNamingFields'], basis: 'manual_review',
            };
            const matchedReferences = references.filter(ref => ref.targetType === type && ref.candidateIds.includes(row.id));
            rows.push({
                objectType: type, objectId: row.id, category: row.category || type,
                originalName, supplier: row.supplier || '', inactive: Boolean(row.deleted_at) || (type === 'coil' && row.scheme_status !== 'official'),
                ...extracted, reviewRequired: true, migrationApproved: false,
                referenceCount: matchedReferences.length,
                referenceStatuses: [...new Set(matchedReferences.map(ref => ref.status))],
                conflicts: [],
            });
        }
    }
    for (const row of rows) {
        if (!row.suggestedName || row.inactive) continue;
        row.conflicts = rows.filter(other => other !== row && !other.inactive && other.objectType === row.objectType
            && other.supplier === row.supplier && (other.suggestedName || other.originalName) === row.suggestedName)
            .map(other => other.objectId);
    }
    return rows;
}

module.exports = { buildNamingCandidates, extractPartCandidate };
