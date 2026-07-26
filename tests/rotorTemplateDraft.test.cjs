const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRotorRecipeDraft, buildRotorTemplateDraft } = require('../api/services/rotorTemplateDraft.cjs');

const template = {
    id: 1,
    shell_model: 'V750',
    parts_json: JSON.stringify([
        { name: '花板轴承', model: '202' },
        { name: '油缸轴承', model: '6204' },
        { name: '机械油封', model: '14*28*7' },
    ]),
    rotor_params_json: JSON.stringify({ piece_count: 160, stack_offset: 28 }),
};

const parts = [
    {
        category: '泵壳',
        model: 'V750',
        notes: JSON.stringify({
            isStainless: true,
            openOffset: 23,
            barrelLength: 170,
            defaultImpellerDia: 48,
            defaultThreadDia: 6,
        }),
    },
];

test('转子模板草稿从模板配件和泵壳 notes 带入出图参数', () => {
    const draft = buildRotorTemplateDraft({ template, parts });

    assert.equal(draft.patch.upper_bearing, '6202');
    assert.equal(draft.patch.lower_bearing, '6204');
    assert.equal(draft.patch.oil_seal_dia, '14');
    assert.equal(draft.patch.piece_count, '160');
    assert.equal(draft.patch.stack_offset, '28');
    assert.equal(draft.patch.impeller_dia, '48');
    assert.equal(draft.patch.thread_dia, '6');
    assert.equal(draft.openOffset, 23);
    assert.equal(draft.barrelLength, 170);
    assert.equal(draft.drawingText, '不锈钢机筒：170mm');
});

test('转子模板草稿应用变体机筒长度并自动计算开档', () => {
    const draft = buildRotorTemplateDraft({
        template,
        parts,
        variant: { id: 3, model_name: 'V750-180', barrel_length: 180 },
    });

    assert.equal(draft.patch.bearing_span, '157');
    assert.equal(draft.barrelLength, 180);
    assert.equal(draft.drawingText, '不锈钢机筒：180mm');
    assert.ok(draft.hints.some(hint => hint.includes('V750-180机筒180mm，开档157mm')));
});

test('转子模板草稿兼容零件库 remark 字段', () => {
    const draft = buildRotorTemplateDraft({
        template,
        parts: [{
            category: '泵壳',
            model: 'V750',
            remark: JSON.stringify({
                isStainless: true,
                openOffset: 15,
                defaultUpperBearing: '6202',
                defaultLowerBearing: '6203',
                defaultOilSealDia: 14,
            }),
        }],
    });

    assert.equal(draft.patch.upper_bearing, '6202');
    assert.equal(draft.patch.lower_bearing, '6204');
    assert.equal(draft.patch.oil_seal_dia, '14');
    assert.equal(draft.openOffset, 15);
});

test('转子配方草稿优先读取技术档案中的出图参数', () => {
    const draft = buildRotorRecipeDraft({
        template,
        parts,
        recipe: {
            name: 'V750 出图配方',
            custom_barrel_length: 180,
            impeller_thickness: 12,
            technical_data_json: JSON.stringify({
                upperBearing: '6203',
                lowerBearing: '6205',
                pieceCount: '180',
                rotorDiameter: '96',
                bearingSpan: '155',
                stackOffset: '30',
                oilSealDiameter: '16',
                impellerBoreDiameter: '50',
                impellerSpan: '18',
                impellerDepth: '13',
                threadLength: '22',
                threadDiameter: '8',
            }),
        },
    });

    assert.deepEqual(draft.patch, {
        upper_bearing: '6203',
        lower_bearing: '6205',
        oil_seal_dia: '16',
        piece_count: '180',
        stack_offset: '30',
        impeller_dia: '50',
        thread_dia: '8',
        bearing_span: '155',
        rotor_dia: '96',
        impeller_span: '18',
        impeller_depth: '13',
        thread_length: '22',
    });
    assert.equal(draft.barrelLength, 180);
    assert.equal(draft.drawingName, 'V750 出图配方');
});
