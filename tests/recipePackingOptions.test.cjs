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
