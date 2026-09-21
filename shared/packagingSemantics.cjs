const PACKING_ROLES = new Set(['container', 'foam', 'pearlCotton', 'fixed'])

function text(value) {
  return String(value || '').trim()
}

function inferPackagingSemantics(part = {}) {
  const model = text(part.model)
  const name = text(part.name)
  const supplier = text(part.supplier)
  const currentMaterial = text(part.packagingMaterial)
  const haystack = `${model} ${name} ${supplier}`

  if (haystack.includes('珍珠棉')) return { packagingMaterial: '珍珠棉', packingRole: 'pearlCotton' }
  if (haystack.includes('泡沫')) return { packagingMaterial: '泡沫', packingRole: 'foam' }
  if (haystack.includes('说明书')) return { packagingMaterial: '说明书', packingRole: 'fixed' }
  if (haystack.includes('贴纸') || haystack.includes('商标')) {
    return { packagingMaterial: '其他包材', packingRole: 'fixed' }
  }
  if (haystack.includes('木箱')) return { packagingMaterial: '木箱', packingRole: 'container' }
  if (haystack.includes('彩印') || haystack.includes('彩箱')) {
    return { packagingMaterial: '彩印箱', packingRole: 'container' }
  }
  if (haystack.includes('牛皮')) return { packagingMaterial: '牛皮纸箱', packingRole: 'container' }
  if (haystack.includes('纸箱') || haystack.includes('外包装')) {
    return { packagingMaterial: currentMaterial || '纸箱', packingRole: 'container' }
  }

  const role = PACKING_ROLES.has(text(part.packingRole))
    ? text(part.packingRole)
    : currentMaterial.includes('泡沫')
      ? 'foam'
      : currentMaterial.includes('珍珠棉')
        ? 'pearlCotton'
        : (currentMaterial.includes('木箱') || currentMaterial.includes('纸箱'))
          ? 'container'
          : 'fixed'
  return {
    packagingMaterial: currentMaterial || (role === 'fixed' ? '其他包材' : '纸箱'),
    packingRole: role,
  }
}

function normalizePackagingPart(part = {}, options = {}) {
  const semantics = inferPackagingSemantics(part)
  const normalized = {
    ...part,
    packagingMaterial: semantics.packagingMaterial,
    packingRole: semantics.packingRole,
  }
  if (options.rewriteName && text(part.model)) {
    normalized.name = `${text(part.model)}（${semantics.packagingMaterial}）`
  }
  return normalized
}

module.exports = {
  PACKING_ROLES,
  inferPackagingSemantics,
  normalizePackagingPart,
}
