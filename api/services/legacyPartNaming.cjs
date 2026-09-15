// Explicit request adapter for old clients. Every successful new part is still
// named by the formal generator; incomplete physical dimensions are not guessed.
function inferLegacyPartNaming(category, model) {
    const value = String(model || '').trim(); let match;
    if (category === '轴承' && /^[0-9]+(?:ZZ|2RS|RS|Z)?$/i.test(value)) return { ruleId: 'bearing', spec: { code: value } };
    if (category === '电容' && (match = value.match(/^(?:电容-)?([0-9]+(?:\.[0-9]+)?)μF$/))) return { ruleId: 'capacitor', spec: { capacitanceUf: Number(match[1]) } };
    if (['电缆线', '浮球'].includes(category) && (match = value.match(/^(?:电缆|浮球)-(?:线径|截面积)([0-9]+(?:\.[0-9]+)?)(?:mm²)?$/))) return {
        ruleId: category === '电缆线' ? 'cable' : 'float', spec: { wireValue: Number(match[1]), wireMeasure: '截面积', wireUnit: 'mm²' },
    };
    if (category === '螺丝' && (match = value.match(/^([0-9]+(?:\.[0-9]+)?)\*([0-9]+(?:\.[0-9]+)?)-(?:201-内六|内六-201)(-组合)?$/))) return {
        ruleId: 'screw', spec: { headStyle: '内六角', diameterMm: Number(match[1]), lengthMm: Number(match[2]), material: '201', ...(match[3] ? { variant: '组合' } : {}) },
    };
    const generic = { 皮垫: 'gasket', 配件: 'accessory', 包装: 'packaging', 其他: 'custom-part' }[category] || (!['轴承', '电容', '螺丝', '油封', '泵壳', '泵壳搭配', '浮球', '电缆线', '线圈转子'].includes(category) ? 'custom-part' : null);
    if (generic && value) return { ruleId: generic, spec: { kind: category, specification: value } };
    throw Object.assign(new Error('请填写该类别的结构化规格；旧型号无法完整确认尺寸或含义'), { code: 'PART_NAMING_REQUIRED', statusCode: 400 });
}
module.exports = { inferLegacyPartNaming };
