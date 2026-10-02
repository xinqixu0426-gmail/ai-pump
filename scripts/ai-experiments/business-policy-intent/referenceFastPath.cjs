'use strict';

function referenceKind(surface) {
    const value = String(surface || '');
    if (/线圈/u.test(value)) return 'coil';
    if (/模板/u.test(value)) return 'template';
    if (/配方/u.test(value)) return 'recipe';
    if (/零件|轴承/u.test(value)) return 'part';
    return null;
}

function categoryKind(category) {
    const value = String(category || '');
    if (/线圈|绕组|定子|coil/iu.test(value)) return 'coil';
    if (/模板|template/iu.test(value)) return 'template';
    if (/配方|产品配置|recipe/iu.test(value)) return 'recipe';
    if (/零件|轴承|part/iu.test(value)) return 'part';
    return null;
}

function genericSingularReference(surface) {
    return new Set(['这个', '那个', '它', '刚才那个']).has(String(surface || ''));
}

function result(mode, input, candidates, compatibleCandidates, resolvedLanguageReference, reason) {
    return Object.freeze({
        mode,
        source: 'DETERMINISTIC_REFERENCE_FAST_PATH',
        referenceSurface: input.referenceSurface || null,
        recentCandidates: Object.freeze(candidates),
        compatibleCandidates: Object.freeze(compatibleCandidates),
        resolvedLanguageReference: resolvedLanguageReference || null,
        reason,
    });
}

function resolveReferenceFastPath(input) {
    const candidates = (input.businessReferenceHint?.entries || []).map(entry => Object.freeze({ expression: entry.expression, category: entry.category }));
    const surface = input.referenceSurface || '';
    const recent = String(input.recentOwnerWording || '').trim();
    const typedKind = referenceKind(surface);
    if (!candidates.length) {
        if (!recent) return result('SAFE_UNRESOLVED', input, candidates, [], null, 'NO_RECENT_OWNER_CANDIDATE');
        return result('DEFER_TO_LLM', input, candidates, [], null, 'RECENT_WORDING_WITHOUT_CONTROLLED_CANDIDATE');
    }
    if (typedKind) {
        const compatible = candidates.filter(candidate => categoryKind(candidate.category) === typedKind);
        if (compatible.length === 1) return result('SAFE_RESOLVED', input, candidates, compatible, compatible[0].expression, 'UNIQUE_TYPED_COMPATIBLE_CANDIDATE');
        if (!compatible.length) return result('SAFE_UNRESOLVED', input, candidates, compatible, null, 'NO_TYPED_COMPATIBLE_CANDIDATE');
        return result('SAFE_UNRESOLVED', input, candidates, compatible, null, 'MULTIPLE_TYPED_COMPATIBLE_CANDIDATES');
    }
    if (genericSingularReference(surface)) {
        if (candidates.length === 1) return result('SAFE_RESOLVED', input, candidates, candidates, candidates[0].expression, 'UNIQUE_GENERIC_CANDIDATE');
        return result('SAFE_UNRESOLVED', input, candidates, candidates, null, 'MULTIPLE_GENERIC_CANDIDATES');
    }
    return result('DEFER_TO_LLM', input, candidates, [], null, 'REFERENCE_SURFACE_REQUIRES_LINGUISTIC_REASONING');
}

module.exports = { referenceKind, categoryKind, genericSingularReference, resolveReferenceFastPath };
