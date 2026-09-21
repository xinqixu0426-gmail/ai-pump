const test = require('node:test')
const assert = require('node:assert/strict')
const {
    buildPackingOptionValues,
    findPackingOption,
    inferPackingSemantics,
    resolvePackingPart,
    updatePackingRoleValue,
} = require('../apps/web-next/lib/recipe-packing.cjs')

const paperCatalog = {
    model: 'TEST-纸箱-小',
    supplier: '测试供应商-包装',
    packagingMaterial: '纸箱',
    packingRole: 'container',
    price: 7.5,
}

test('订单外包装按稳定身份匹配，不因配方缺少快照价而丢失纸箱', () => {
    const selected = findPackingOption([paperCatalog], {
        model: 'TEST-纸箱-小',
        supplier: '测试供应商-包装',
        packagingMaterial: '纸箱',
    })
    assert.equal(selected, paperCatalog)
})

test('存在历史快照价候选时优先恢复精确价格，目录改价不改变包材身份', () => {
    const historical = { ...paperCatalog, price: 5 }
    const selected = findPackingOption([paperCatalog, historical], {
        model: paperCatalog.model,
        supplier: paperCatalog.supplier,
        packagingMaterial: '纸箱',
        snapshotPrice: 5,
    })
    assert.equal(selected, historical)
})

test('历史快照价候选已不存在时回填当前目录候选', () => {
    const selected = findPackingOption([paperCatalog], {
        model: paperCatalog.model,
        supplier: paperCatalog.supplier,
        packagingMaterial: '纸箱',
        snapshotPrice: 5,
    })
    assert.equal(selected, paperCatalog)
})

test('纸箱木箱和供应商保持可区分且不会凭空选择外包装', () => {
    const wood = { ...paperCatalog, model: 'TEST-木箱-小', packagingMaterial: '木箱', price: 18 }
    assert.equal(findPackingOption([paperCatalog, wood], { ...wood, snapshotPrice: 0 }), wood)
    assert.equal(findPackingOption([paperCatalog], { ...paperCatalog, supplier: '其他供应商' }), undefined)
    assert.equal(findPackingOption([paperCatalog], undefined), undefined)
})

test('同型号同供应商不同材质时不降级成错误外包装', () => {
    const wood = { ...paperCatalog, packagingMaterial: '木箱', price: 18 }
    assert.equal(findPackingOption([paperCatalog, wood], { ...wood, snapshotPrice: 0 }), wood)
    assert.equal(findPackingOption([paperCatalog], { ...wood, snapshotPrice: 0 }), undefined)
})

test('仅 boxType 或 JSON 没有外包装时仍恢复 container', () => {
    const fallback = resolvePackingPart('[]', 'container', '三寸木箱')
    assert.deepEqual(fallback, {
        model: '三寸木箱',
        supplier: '',
        qty: 1,
        packingRole: 'container',
        packagingMaterial: '木箱',
    })
    const options = buildPackingOptionValues([], [{ boxType: '三寸木箱', packingPartsJson: '[]' }])
    assert.equal(findPackingOption(options, fallback)?.model, '三寸木箱')
    assert.equal(
        resolvePackingPart('[{"model":"说明书","packingRole":"fixed"}]', 'container', '牛皮纸箱')?.packagingMaterial,
        '牛皮纸箱'
    )
    const fixedOnlyOptions = buildPackingOptionValues([], [{
        boxType: '牛皮纸箱',
        packingPartsJson: '[{"model":"说明书","packingRole":"fixed"}]',
    }])
    const fixedOnlyFallback = resolvePackingPart(
        '[{"model":"说明书","packingRole":"fixed"}]',
        'container',
        '牛皮纸箱'
    )
    assert.equal(findPackingOption(fixedOnlyOptions, fixedOnlyFallback)?.model, '牛皮纸箱')
})

test('历史纸箱木箱错误角色由真实型号语义纠正', () => {
    assert.deepEqual(inferPackingSemantics({ model: '三寸木箱', packingRole: 'fixed', packagingMaterial: '纸箱' }), {
        packagingMaterial: '木箱',
        packingRole: 'container',
    })
    assert.equal(
        resolvePackingPart('[{"model":"550纸箱","packingRole":"fixed"}]', 'container')?.packingRole,
        'container'
    )
})

test('前端包材语义与后端权威实现保持同一引用', () => {
    const { inferPackagingSemantics } = require('../api/services/packagingSemantics.cjs')
    const samples = [
        { model: 'TEST-纸箱-小', packingRole: 'fixed' },
        { model: '三寸木箱', packagingMaterial: '纸箱' },
        { model: '泡沫上', packingRole: 'fixed' },
        { model: 'PKG-001', packagingMaterial: '珍珠棉' },
    ]
    samples.forEach(sample => assert.deepEqual(
        inferPackingSemantics(sample),
        inferPackagingSemantics(sample)
    ))
})

test('选择和清空外包装时 boxType 与 packingPartsJson 保持同步', () => {
    const initial = {
        boxType: '',
        packingPartsJson: JSON.stringify([{
            model: '说明书',
            supplier: '',
            qty: 1,
            packagingMaterial: '说明书',
            packingRole: 'fixed',
        }]),
    }
    const selected = updatePackingRoleValue(initial, 'container', paperCatalog)
    assert.equal(selected.boxType, paperCatalog.model)
    assert.deepEqual(JSON.parse(selected.packingPartsJson).map(part => part.model), ['说明书', paperCatalog.model])

    const cleared = updatePackingRoleValue(selected, 'container')
    assert.equal(cleared.boxType, '')
    assert.deepEqual(JSON.parse(cleared.packingPartsJson).map(part => part.model), ['说明书'])
})

test('包装目录候选读取正式目录成本价并覆盖同身份历史快照重复项', () => {
    const options = buildPackingOptionValues([{
        id: 71,
        model: 'TEST-木箱-目录价',
        category: '包装',
        subcategory: '外包装',
        supplier: '测试包装厂',
        catalogUnitCost: 13,
    }], [{
        packingPartsJson: JSON.stringify([{
            model: 'TEST-木箱-目录价',
            supplier: '测试包装厂',
            snapshotPrice: 9,
            packagingMaterial: '木箱',
            packingRole: 'container',
        }]),
    }])

    assert.equal(options.length, 1)
    assert.equal(options[0].partId, 71)
    assert.equal(options[0].price, 13)
})

test('包装候选保留同型号不同供应商的正式业务身份', () => {
    const options = buildPackingOptionValues([
        { id: 81, model: 'TEST-纸箱-双供应商', category: '包装', supplier: '甲厂', catalogUnitCost: 6 },
        { id: 82, model: 'TEST-纸箱-双供应商', category: '包装', supplier: '乙厂', catalogUnitCost: 5 },
    ], [])

    assert.deepEqual(options.map(option => option.supplier).sort(), ['乙厂', '甲厂'])
})

test('包装有 ID 时恢复现名，旧名被占用也不换成另一零件', () => {
    const current = { ...paperCatalog, partId: 71, model: '纸箱-新规格' }
    const reused = { ...paperCatalog, partId: 72 }
    const saved = { ...paperCatalog, partId: 71, snapshotPrice: reused.price }
    assert.equal(findPackingOption([reused, current], saved), current)
    assert.equal(findPackingOption([reused], saved), undefined)
    assert.equal(findPackingOption([current], { ...saved, supplier: '冲突供应商' }), undefined)
    assert.equal(findPackingOption([current], { ...saved, supplier: '' }), current)
    assert.equal(findPackingOption([current], { ...saved, packagingMaterial: '木箱' }), undefined)
})

test('同名包装的不同 ID 不合并，无 ID 歧义不自动选中', () => {
    const parts = [71, 72].map(id => ({ ...paperCatalog, id, category: '包装' }))
    const options = buildPackingOptionValues(parts, [])
    assert.equal(options.length, 2)
    assert.equal(findPackingOption(options, paperCatalog), undefined)
    for (const partId of [71, 72]) {
        assert.equal(findPackingOption(options, { ...paperCatalog, partId }).partId, partId)
    }
})

test('历史绑定包装候选使用现名目录价，失效引用不由 boxType 补成无 ID 选项', () => {
    const part = { ...paperCatalog, id: 71, model: '纸箱-新规格', category: '包装', catalogUnitCost: 13 }
    const recipe = saved => ({ boxType: saved.model, packingPartsJson: JSON.stringify([saved]) })
    const saved = { ...paperCatalog, partId: 71, snapshotPrice: 5 }
    const options = buildPackingOptionValues([part], [recipe(saved)])
    assert.equal(options.length, 1)
    assert.equal(options[0].model, part.model)
    assert.equal(options[0].price, 13)
    assert.equal(options[0].partId, 71)
    assert.equal(JSON.parse(updatePackingRoleValue({}, 'container', options[0]).packingPartsJson)[0].partId, 71)
    assert.equal(saved.model, paperCatalog.model)
    for (const badId of [0, -1, 1.5, true, '71', [71], {}, Number.MAX_SAFE_INTEGER + 1, 999]) {
        const invalid = { ...saved, partId: badId }
        assert.equal(findPackingOption(options, invalid), undefined)
        assert.deepEqual(buildPackingOptionValues([], [recipe(invalid)]), [])
    }
    assert.deepEqual(buildPackingOptionValues([], [recipe(saved)]), [])
    const conflict = { ...saved, supplier: '冲突供应商' }
    assert.equal(buildPackingOptionValues([part], [recipe(conflict)]).length, 1)
    assert.deepEqual(buildPackingOptionValues([{ ...part, category: '配件', model: '接头' }], [recipe(saved)]), [])
})

test('包装覆盖转换保留原始非法 ID，不能把布尔值或数组转换成有效引用', () => {
    for (const partId of [0, -1, true, '71', [71]]) {
        const value = updatePackingRoleValue({}, 'container', { ...paperCatalog, partId })
        assert.deepEqual(JSON.parse(value.packingPartsJson)[0].partId, partId)
    }
})
