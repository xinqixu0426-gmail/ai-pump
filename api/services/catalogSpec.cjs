// Structured catalog specifications are authoritative. Legacy parsing is limited
// to explicit units/tokens confirmed by the owner, never an alias lookup.
function namingOf(part) {
    if (part?.naming) return part.naming;
    if (!part?.naming_json) return null;
    return JSON.parse(part.naming_json);
}
function wireValueOf(part) {
    const naming = namingOf(part);
    if (['cable', 'float'].includes(naming?.ruleId)) return String(naming.spec.wireValue);
    const prefix = part?.category === '电缆线' ? '电缆' : part?.category === '浮球' ? '浮球' : null;
    const match = prefix && String(part.model || '').match(new RegExp(`^${prefix}-线径([0-9]+(?:\\.[0-9]+)?)$`));
    return match ? String(Number(match[1])) : null;
}
function bearingCodeOf(part) {
    const named = namingOf(part);
    let code = String(named?.ruleId === 'bearing' ? named.spec.code : part?.model || '').trim().toUpperCase().replace(/^轴承-/, '');
    if (/^6[0-9]{3}(?:ZZ|2RS|RS|Z)?$/.test(code)) code = code.slice(1);
    return code;
}
function capacitorValueOf(part) {
    const naming = namingOf(part);
    if (naming?.ruleId === 'capacitor') return Number(naming.spec.capacitanceUf);
    const match = String(part?.model || '').match(/^(?:电容-)?([0-9]+(?:\.[0-9]+)?)μF$/);
    return match ? Number(match[1]) : null;
}
function selectWirePart(catalog, category, wire, supplier = '', partId) {
    const { resolveCatalogPartIdentity } = require('./bomPartIdentity.cjs');
    if (partId != null) {
        const part = resolveCatalogPartIdentity(catalog, { partId, supplier });
        if (part.category !== category || wireValueOf(part) !== String(Number(wire))) {
            throw Object.assign(new Error('导线身份与类别或横截面积不一致'), { code: 'WIRE_SPEC_MISMATCH', statusCode: 422 });
        }
        return part;
    }
    const candidates = catalog.filter(part => !part.deletedAt && !part.deleted_at && part.category === category
        && wireValueOf(part) === String(Number(wire)) && (!supplier || part.supplier === supplier));
    if (candidates.length > 1) throw Object.assign(new Error('同横截面积有多个供应商，请选择具体零件'), {
        code: 'WIRE_SPEC_AMBIGUOUS', statusCode: 409,
        details: { candidates: candidates.map(part => ({ partId: part.id || part.Id, model: part.model, supplier: part.supplier })) },
    });
    return candidates[0] || null;
}
module.exports = { namingOf, wireValueOf, bearingCodeOf, capacitorValueOf, selectWirePart };
