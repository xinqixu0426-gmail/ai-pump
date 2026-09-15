const { inferPackagingSemantics } = require('../../../shared/packagingSemantics.cjs')

function text(value) {
  return String(value || '').trim()
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function inferPackingMaterial(value) {
  const identity = text(value)
  if (identity.includes('木箱')) return '木箱'
  if (identity.includes('彩印') || identity.includes('彩箱')) return '彩印箱'
  if (identity.includes('牛皮')) return '牛皮纸箱'
  if (identity.includes('纸箱') || identity.includes('外包装')) return '纸箱'
  if (identity.includes('泡沫')) return '泡沫'
  if (identity.includes('珍珠棉')) return '珍珠棉'
  if (identity.includes('商标') || identity.includes('贴纸')) return '其他包材'
  if (identity.includes('说明书')) return '说明书'
  if (identity.includes('包装')) return '纸箱'
  return '其他包材'
}

function inferPackingSemantics(part = {}) {
  return inferPackagingSemantics(part)
}

function normalizePackingParts(value) {
  return parseJsonArray(value)
    .filter(part => part?.model)
    .map(part => {
      const semantics = inferPackingSemantics(part)
      return {
        ...part,
        supplier: text(part.supplier),
        qty: Number(part.qty || 1),
        packagingMaterial: semantics.packagingMaterial,
        packingRole: semantics.packingRole,
      }
    })
}

function resolvePackingPart(value, role, boxType = '') {
  const matched = normalizePackingParts(value).find(part => part.packingRole === role)
  if (matched || role !== 'container' || !text(boxType)) return matched
  const fallback = { model: text(boxType), supplier: '', qty: 1, packingRole: 'container' }
  return { ...fallback, ...inferPackingSemantics(fallback) }
}

function sameStableIdentity(option, packing) {
  if (packing.partId != null) {
    return Number.isSafeInteger(packing.partId) && packing.partId > 0
      && option.partId === packing.partId
      && (!text(packing.supplier) || text(option.supplier) === text(packing.supplier))
  }
  return text(option.model) === text(packing.model)
    && text(option.supplier) === text(packing.supplier)
}

function findPackingOption(options, packing) {
  if (!packing?.model) return undefined
  const semantics = inferPackingSemantics(packing)
  const stableMatches = options.filter(option => sameStableIdentity(option, packing))
  if (stableMatches.length === 0) return undefined
  if (packing.partId == null
    && new Set(stableMatches.filter(option => option.partId != null).map(option => option.partId)).size > 1) {
    return undefined
  }

  const materialMatches = stableMatches.filter(option => (
    inferPackingSemantics(option).packagingMaterial === semantics.packagingMaterial
  ))
  const hasKnownMaterial = text(packing.packagingMaterial)
    && semantics.packagingMaterial !== '其他包材'
  if (hasKnownMaterial && materialMatches.length === 0) return undefined
  const candidates = materialMatches.length > 0 ? materialMatches : stableMatches
  const snapshotPrice = Number(packing.snapshotPrice)
  if (Number.isFinite(snapshotPrice)) {
    const exactPrice = candidates.find(option => Number(option.price) === snapshotPrice)
    if (exactPrice) return exactPrice
  }
  return candidates[0]
}

function packingOptionKeyValue(option) {
  return JSON.stringify([option.partId ?? null, option.model, option.supplier, option.packagingMaterial, option.packingRole])
}

function buildPackingOptionValues(parts, recipes) {
  const options = new Map()
  const addOption = (packing, price = 0) => {
    const model = text(packing.model)
    if (!model) return
    const semantics = inferPackingSemantics(packing)
    const option = {
      ...(packing.partId != null ? { partId: packing.partId } : {}),
      model,
      supplier: text(packing.supplier),
      price: Number(price || 0),
      packagingMaterial: semantics.packagingMaterial,
      packingRole: semantics.packingRole,
    }
    const key = packingOptionKeyValue(option)
    if (!options.has(key)) options.set(key, option)
  }

  parts.forEach(part => {
    const model = text(part.model)
    const looksLikePacking = text(part.category).includes('包装')
      || model.includes('木箱')
      || model.includes('纸箱')
      || model.includes('泡沫')
      || model.includes('珍珠棉')
      || model.includes('包装')
    if (!looksLikePacking) return
    addOption({
      partId: part.id,
      model,
      supplier: text(part.supplier),
      packagingMaterial: inferPackingSemantics(part).packagingMaterial,
      packingRole: part.subcategory === '外包装'
        ? 'container'
        : part.subcategory === '固定包材'
          ? 'fixed'
          : undefined,
    }, Number(part.catalogUnitCost ?? part.price ?? 0))
  })

  recipes.forEach(recipe => {
    const packingParts = normalizePackingParts(recipe.packingPartsJson)
    packingParts.forEach(packing => {
      if (packing.partId != null) {
        if (!Number.isSafeInteger(packing.partId) || packing.partId <= 0) return
        const part = parts.find(item => item.id === packing.partId)
        if (!part || part.category !== '包装'
          || (text(packing.supplier) && text(packing.supplier) !== text(part.supplier))) return
        addOption({ ...packing, model: part.model, supplier: part.supplier },
          Number(part.catalogUnitCost ?? part.price ?? 0))
        return
      }
      const catalogMatches = parts.filter(part => (
        text(part.model) === text(packing.model)
        && (!packing.supplier || text(part.supplier) === text(packing.supplier))
      ))
      const matchedCatalogPart = catalogMatches.length === 1 ? catalogMatches[0] : undefined
      const catalogPrice = matchedCatalogPart?.catalogUnitCost ?? matchedCatalogPart?.price
      if (findPackingOption(Array.from(options.values()), packing)) return
      addOption(packing, Number(packing.snapshotPrice ?? catalogPrice ?? 0))
    })
    if (recipe.boxType && !packingParts.some(part => part.packingRole === 'container')) {
      addOption({
        model: recipe.boxType,
        supplier: '',
        packagingMaterial: inferPackingMaterial(recipe.boxType),
        packingRole: 'container',
      })
    }
  })

  return Array.from(options.values()).sort((a, b) => (
    a.packingRole.localeCompare(b.packingRole)
    || a.packagingMaterial.localeCompare(b.packagingMaterial, 'zh-Hans-CN')
    || a.model.localeCompare(b.model, 'zh-Hans-CN')
  ))
}

function updatePackingRoleValue(overrides, role, option) {
  const nextParts = normalizePackingParts(overrides?.packingPartsJson)
    .filter(part => inferPackingSemantics(part).packingRole !== role)
  if (option) {
    nextParts.push({
      ...(option.partId != null ? { partId: option.partId } : {}),
      model: option.model,
      supplier: text(option.supplier),
      qty: 1,
      snapshotPrice: Number(option.price || 0),
      packagingMaterial: option.packagingMaterial,
      packingRole: option.packingRole,
    })
  }
  const container = nextParts.find(part => inferPackingSemantics(part).packingRole === 'container')
  return {
    ...overrides,
    boxType: container?.model || '',
    packingPartsJson: JSON.stringify(nextParts),
  }
}

module.exports = {
  buildPackingOptionValues,
  findPackingOption,
  inferPackingMaterial,
  inferPackingSemantics,
  normalizePackingParts,
  resolvePackingPart,
  updatePackingRoleValue,
}
