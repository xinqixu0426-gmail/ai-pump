'use strict';

function projectAnswerAgainstFrame(frame, answer) {
    const text = String(answer || '');
    const detected = [];
    const forbidden = new Set(frame?.obligations?.forbiddenClaims || []);
    if (forbidden.has('MUST_NOT_CLAIM_COMPLETE') && /(?:正式目录|系统|全部目录).{0,24}(?:没有|不存在|未找到)|(?:确认|均).{0,16}(?:没有|不存在|未找到)/u.test(text)) {
        detected.push({ forbiddenClaim: 'MUST_NOT_CLAIM_COMPLETE', semanticBlocker: frame.completeness.status,
            requiredFactMissing: frame.evidence.missingFacts[0] || null });
    }
    if (forbidden.has('MUST_NOT_SELECT_VARIANT') && /(?:总成本|整机成本|选用|采用)[^\n]{0,30}\d/u.test(text)) {
        detected.push({ forbiddenClaim: 'MUST_NOT_SELECT_VARIANT', semanticBlocker: 'AMBIGUOUS_OVERRIDE',
            requiredFactMissing: frame.evidence.missingFacts[0] || null });
    }
    if (forbidden.has('MUST_NOT_PRESENT_HYPOTHETICAL_AS_FORMAL') && /按(?:照)?(?:铜价)?\s*\d+[^\n]{0,24}(?:算|计算|成本)/u.test(text)
        && !/(?:不支持|无法|并非|不是|未按)/u.test(text)) {
        detected.push({ forbiddenClaim: 'MUST_NOT_PRESENT_HYPOTHETICAL_AS_FORMAL', semanticBlocker: 'UNSUPPORTED_REQUEST',
            requiredFactMissing: frame.evidence.missingFacts[0] || null });
    }
    if (forbidden.has('MUST_NOT_PRESENT_PART_PRICE_AS_MACHINE_COST') && /(?:整机|成品).{0,12}(?:成本|价格)[^\d]{0,8}\d/u.test(text)) {
        detected.push({ forbiddenClaim: 'MUST_NOT_PRESENT_PART_PRICE_AS_MACHINE_COST', semanticBlocker: 'CROSS_CATALOG_CANDIDATE',
            requiredFactMissing: frame.evidence.missingFacts[0] || null });
    }
    if (frame?.subject?.resolutionStatus === 'ALIAS_UNRESOLVED' && /(?:(?:没有|未).{0,12}(?:查到|找到).{0,24}V\d+|系统里?(?:没有|不存在).{0,40}V\d+)/iu.test(text)) {
        detected.push({ forbiddenClaim: 'MUST_NOT_CLAIM_COMPLETE', semanticBlocker: 'ALIAS_UNRESOLVED',
            requiredFactMissing: 'RECIPE_CANONICAL_IDENTITY' });
    }
    return { detected: detected.length > 0, violations: detected };
}

function projectCriticalFailure(frame, failure) {
    const forbidden = frame?.obligations?.forbiddenClaims || [];
    const missing = frame?.evidence?.missingFacts?.[0] || null;
    if (failure === 'False Complete Claim' && forbidden.includes('MUST_NOT_CLAIM_COMPLETE')) return {
        detectedByFrame: true, semanticBlocker: frame.completeness.status, requiredFactMissing: missing,
        forbiddenClaim: 'MUST_NOT_CLAIM_COMPLETE',
    };
    if (failure === 'Wrong Entity' && ['ALIAS_UNRESOLVED', 'CROSS_CATALOG_CANDIDATE'].includes(frame?.subject?.resolutionStatus)) return {
        detectedByFrame: true, semanticBlocker: frame.subject.resolutionStatus, requiredFactMissing: missing || 'RECIPE_CANONICAL_IDENTITY',
        forbiddenClaim: forbidden.includes('MUST_NOT_CLAIM_COMPLETE') ? 'MUST_NOT_CLAIM_COMPLETE' : 'MUST_NOT_PRESENT_PART_PRICE_AS_MACHINE_COST',
    };
    if (failure === 'Ungrounded Business Parameter' && forbidden.includes('MUST_NOT_GUESS_PARAMETER')) return {
        detectedByFrame: true, semanticBlocker: frame.override.supportStatus, requiredFactMissing: missing,
        forbiddenClaim: 'MUST_NOT_GUESS_PARAMETER',
    };
    return { detectedByFrame: false, semanticBlocker: null, requiredFactMissing: missing, forbiddenClaim: null };
}

module.exports = { projectAnswerAgainstFrame, projectCriticalFailure };
