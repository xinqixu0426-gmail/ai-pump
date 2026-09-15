const test = require('node:test');
const assert = require('node:assert/strict');
const { getNamingRules, generateCatalogName, previewCatalogName } = require('../api/services/catalogNaming.cjs');

test('所有类别规则可以通过相同结构化规格入口生成名称，字段顺序不影响输入指纹', () => {
    for (const rule of getNamingRules().rules) {
        const spec = Object.fromEntries(rule.fields.filter(field => !field.optional).map(field => [field.key,
            field.type === 'choice' ? field.values[0] : field.type === 'number' ? field.key === 'outerDiameterMm' ? 28 : 12 : '样例规格',
        ]));
        const result = generateCatalogName({ ruleId: rule.id, spec });
        const reversed = generateCatalogName({ ruleId: rule.id, spec: Object.fromEntries(Object.entries(spec).reverse()) });
        assert.deepEqual(result, reversed);
        assert.ok(result.name.length > 0);
        assert.match(result.namingInputFingerprint, /^[a-f0-9]{64}$/);
    }
    const screw = generateCatalogName({ ruleId: 'screw', spec: { headStyle: '内六角', diameterMm: 6, lengthMm: 25, material: '201', variant: '组合' } });
    assert.equal(screw.name, '内六角螺丝-6*25-201-组合');
});

test('规格输入变更改变输入指纹，纯空白与型号大小写规范化不改变指纹', () => {
    const first = generateCatalogName({ ruleId: 'bearing', spec: { code: ' 6202zz ' } });
    assert.equal(first.name, '轴承-202ZZ');
    assert.equal(first.namingInputFingerprint, generateCatalogName({ ruleId: 'bearing', spec: { code: '6202ZZ' } }).namingInputFingerprint);
    assert.notEqual(first.namingInputFingerprint, generateCatalogName({ ruleId: 'bearing', spec: { code: '6203ZZ' } }).namingInputFingerprint);
    assert.equal(generateCatalogName({ ruleId: 'bearing', spec: { code: '202' } }).name, '轴承-202');
    assert.deepEqual(generateCatalogName({ ruleId: 'bearing', spec: { code: '202', variant: '  ' } }),
        generateCatalogName({ ruleId: 'bearing', spec: { code: '202' } }));
});

test('拒绝缺项、未知字段、直接指定名字、非法数字及不能确定的单位', () => {
    const cases = [
        { ruleId: 'capacitor', spec: { capacitanceUf: '18' } },
        { ruleId: 'capacitor', spec: { capacitanceUf: -1 } },
        { ruleId: 'capacitor', spec: { capacitanceUf: Infinity } },
        { ruleId: 'capacitor', spec: { capacitanceUf: 1.12345 } },
        { ruleId: 'bearing', spec: { code: '  ' } },
        { ruleId: 'bearing', spec: { code: 'x\ny' } },
        { ruleId: 'bearing', spec: { code: '202', name: '随便改' } },
        { ruleId: 'bearing', spec: { code: '202' }, name: '随便改' },
        { ruleId: 'seal', spec: { innerDiameterMm: 14, outerDiameterMm: 28 } },
        { ruleId: 'seal', spec: { sealType: '骨架油封', innerDiameterMm: 28, outerDiameterMm: 14, heightMm: 8 } },
        { ruleId: 'cable', spec: { wireValue: 0.55 } },
        { ruleId: 'cable', spec: { wireValue: 0.55, wireMeasure: '直径', wireUnit: 'mm²' } },
        { ruleId: '__proto__', spec: {} },
    ];
    for (const input of cases) assert.throws(() => generateCatalogName(input), error => error.statusCode === 400 && error.code.startsWith('NAMING_'));
});

test('线圈片数不标作叠长，预览不签发写确认或声明完成改名', () => {
    const result = previewCatalogName({ ruleId: 'coil', spec: { statorCode: '12', sheets: 120, material: '钢带', slotType: '小眼', scheme: '普通' } });
    assert.equal(result.name, '线圈-12-120片-钢带-小眼-普通');
    assert.equal(result.preview, true);
    assert.equal(result.confirmationToken, undefined);
    assert.equal(result.warnings[0].code, 'NAMING_PREVIEW_ONLY');
    const rules = getNamingRules();
    rules.rules[0].fields[0].label = '外部修改';
    assert.notEqual(getNamingRules().rules[0].fields[0].label, '外部修改');
});

test('电缆只能使用横截面积，浮球保留独立的规格含义', () => {
    assert.equal(generateCatalogName({ ruleId: 'cable', spec: { wireValue: 0.55, wireMeasure: '截面积', wireUnit: 'mm²' } }).name, '电缆-截面积0.55mm²');
    assert.throws(() => generateCatalogName({ ruleId: 'cable', spec: { wireValue: 0.55, wireMeasure: '直径', wireUnit: 'mm' } }), { code: 'NAMING_SPEC_INVALID' });
    assert.throws(() => generateCatalogName({ ruleId: 'float', spec: { wireValue: 0.55, wireMeasure: '直径', wireUnit: 'mm' } }), { code: 'NAMING_SPEC_INVALID' });
});
