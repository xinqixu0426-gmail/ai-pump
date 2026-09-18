const {
    buildClaimsFromInvestigation,
    requiredFactCoverage,
    validateClaims,
} = require('./aiClaimGroundingV4.cjs');

const SUPPORTED_DOMAINS = new Set(['catalog', 'coil', 'template', 'recipe', 'cost']);
const FACTUAL_BLOCK_TYPES = new Set(['direct_claim', 'claim_list', 'comparison']);
const BLOCK_TYPES = new Set([
    ...FACTUAL_BLOCK_TYPES,
    'explanation',
    'clarification',
    'unavailable',
]);

function immutable(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(immutable));
    if (!value || typeof value !== 'object') return value;
    return Object.freeze(Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, immutable(nested)])
    ));
}

function claimGroundingFlags(env = process.env) {
    return Object.freeze({
        enabled: String(env?.AI_CLAIM_GROUNDING_V4_ENABLED || '').trim().toLowerCase() === 'true',
    });
}

function eligibleClaimGroundingIntent(intent = {}) {
    return ['query', 'analysis'].includes(intent.mode)
        && intent.entityScope === 'single'
        && (intent.domains || []).length > 0
        && (intent.domains || []).every(domain => SUPPORTED_DOMAINS.has(domain));
}

function blockTypeForClaims(claims) {
    if (claims.every(claim => claim.claimType === 'ambiguous')) return 'clarification';
    if (claims.every(claim => claim.claimType === 'unavailable')) return 'unavailable';
    return claims.length <= 2 ? 'direct_claim' : 'claim_list';
}

function buildAnswerPlan(input = {}) {
    const claims = input.claims || [];
    const requirements = input.requirements || [];
    const factCoverage = requiredFactCoverage(requirements, claims);
    const block = {
        blockId: 'answer-block-1',
        type: blockTypeForClaims(claims),
        claimRefs: claims.map(claim => claim.claimId),
        premiseClaimRefs: [],
        allowedNewBusinessFacts: false,
    };
    const plan = immutable({
        planId: input.planId || 'answer-plan-1',
        answerShape: input.answerShape || 'direct',
        requiredClaimRefs: claims
            .filter(claim => requirements.some(item => !item.optional && item.factKey === claim.factKey))
            .map(claim => claim.claimId),
        blocks: claims.length > 0 ? [block] : [],
        factCoverage,
    });
    const coverage = answerPlanCoverage(plan, claims);
    return immutable({ ...plan, claimCoverage: coverage });
}

function answerPlanCoverage(plan, claims = []) {
    const known = new Set(claims.map(claim => claim.claimId));
    const covered = new Set((plan?.blocks || [])
        .filter(block => block.type !== 'explanation')
        .flatMap(block => block.claimRefs || []));
    const unknownClaimRefs = [...covered].filter(ref => !known.has(ref));
    const missingClaimRefs = (plan?.requiredClaimRefs || []).filter(ref => !covered.has(ref));
    return immutable({
        complete: unknownClaimRefs.length === 0 && missingClaimRefs.length === 0,
        unknownClaimRefs,
        missingClaimRefs,
    });
}

function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? '');
    return `¥${Number.isInteger(number) ? number.toFixed(0) : number.toFixed(2)}`;
}

function subjectLabel(claim) {
    return claim.subject.canonicalName || `${claim.subject.entityType}${claim.subject.entityId ? ` #${claim.subject.entityId}` : ''}`;
}

function predicateLabel(claim) {
    const labels = {
        'price.current': '当前价格',
        'inventory.current': '当前库存',
        'inventory.quantity': '当前库存数量',
        'cost.current.recipe': '当前完整成本',
        'cost.current.template': '当前泵壳成本',
        'cost.current.coil': '当前线圈成本',
        'cost.current.full': '当前完整成本',
        'cost.saved.snapshot': '保存成本快照',
        entityIdentity: '正式业务对象',
        currentStatus: '当前状态',
        singleResourceDetail: '正式明细',
        verifiedNotFound: '正式查询结果',
        ambiguity: '对象匹配结果',
    };
    return labels[claim.predicate] || claim.predicate;
}

function formatClaim(claim) {
    if (claim.presentationPolicy === 'internal_support') return '';
    const subject = subjectLabel(claim);
    if (claim.claimType === 'scalar_value') {
        const value = claim.unit === 'CNY' ? money(claim.value) : `${claim.value}${claim.unit ? ` ${claim.unit}` : ''}`;
        return `${subject}${predicateLabel(claim)}为 ${value}。`;
    }
    if (claim.claimType === 'entity_identity') return `${subject}是正式${claim.subject.entityType}记录。`;
    if (claim.claimType === 'status') return `${subject}${predicateLabel(claim)}为 ${claim.value}。`;
    if (claim.claimType === 'verified_not_found') return `正式查询未找到与“${claim.qualifiers.targetMention || subject}”匹配的${claim.subject.entityType}记录。`;
    if (claim.claimType === 'ambiguous') {
        const candidates = Array.isArray(claim.value) ? claim.value : [];
        if (candidates.length === 0) return '正式查询发现目标存在歧义，请补充对象类型或更具体的名称。';
        return `正式查询发现多个候选：${candidates.map(item => item.canonicalName || `${item.entityType} #${item.entityId}`).join('、')}。请确认具体对象。`;
    }
    if (claim.claimType === 'unavailable') return '正式查询未能完成验证，暂时不能给出该业务结论。';
    if (claim.claimType === 'relationship') {
        const explicitValue = claim.qualifiers?.valuePath
            && (typeof claim.value !== 'object' || claim.value === null)
            ? `为 ${String(claim.value)}`
            : '已核验';
        return `${subject}${claim.qualifiers?.label || predicateLabel(claim)}${explicitValue}。`;
    }
    return '';
}

function formatAnswerPlanDeterministically(plan, claims = []) {
    const byId = new Map(claims.map(claim => [claim.claimId, claim]));
    const lines = [];
    for (const block of plan?.blocks || []) {
        const blockClaims = (block.claimRefs || []).map(ref => byId.get(ref)).filter(Boolean);
        for (const claim of blockClaims) {
            const text = formatClaim(claim);
            if (text && !lines.includes(text)) lines.push(text);
        }
    }
    return lines.join('\n\n') || '当前没有足够的正式 Claim 可以回答。';
}

function rendererPayload(goal, plan, claims) {
    return immutable({
        goal: String(goal || ''),
        answerPlan: plan,
        claims: claims.map(claim => ({
            claimId: claim.claimId,
            claimType: claim.claimType,
            subject: claim.subject,
            predicate: claim.predicate,
            value: claim.value,
            unit: claim.unit,
            temporalScope: claim.temporalScope,
            scenario: claim.scenario,
            certainty: claim.certainty,
        })),
        claimLabels: Object.fromEntries(claims.map(claim => [claim.claimId, formatClaim(claim)])),
        allowedPremiseClaims: Object.fromEntries(claims.map(claim => [claim.claimId, claim.premiseClaimRefs])),
    });
}

function parseRenderedAnswer(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    const text = String(value || '').trim();
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] || text;
    return JSON.parse(fenced);
}

function validateRenderedAnswer(rendered, plan, claims = []) {
    const errors = [];
    if (!rendered || typeof rendered !== 'object' || !Array.isArray(rendered.blocks)) {
        return immutable({ valid: false, errors: [{ code: 'RENDER_SCHEMA_INVALID' }] });
    }
    const canonical = new Map(claims.map(claim => [claim.claimId, claim]));
    const required = new Set(plan.requiredClaimRefs || []);
    const covered = new Set();
    for (const block of rendered.blocks) {
        if (!BLOCK_TYPES.has(block?.type)) {
            errors.push({ code: 'RENDER_BLOCK_TYPE_INVALID' });
            continue;
        }
        const refs = [...(block.claimRefs || []), ...(block.premiseClaimRefs || [])];
        for (const ref of refs) {
            if (!canonical.has(ref)) errors.push({ code: 'RENDER_UNKNOWN_CLAIM_REF', claimRef: ref });
            else if (block.type !== 'explanation' && (block.claimRefs || []).includes(ref)) covered.add(ref);
        }
        if (FACTUAL_BLOCK_TYPES.has(block.type)) {
            const presentations = Array.isArray(block.claimPresentations)
                ? block.claimPresentations
                : [];
            const claimRefs = block.claimRefs || [];
            const presentationRefs = presentations.map(item => item?.claimRef);
            const referencesMatch = claimRefs.length === presentationRefs.length
                && new Set(claimRefs).size === claimRefs.length
                && new Set(presentationRefs).size === presentationRefs.length
                && claimRefs.every(ref => presentationRefs.includes(ref));
            if (!referencesMatch) {
                errors.push({ code: 'RENDER_CLAIM_PRESENTATION_INCOMPLETE' });
            }
            for (const item of presentations) {
                const claim = canonical.get(item.claimRef);
                if (!claim) continue;
                for (const field of ['subject', 'predicate', 'value', 'unit', 'temporalScope', 'scenario', 'claimType']) {
                    if (JSON.stringify(item[field]) !== JSON.stringify(claim[field])) {
                        errors.push({ code: `RENDER_${field.toUpperCase()}_CHANGED`, claimRef: item.claimRef });
                    }
                }
            }
        }
        if (block.type === 'clarification') {
            const ambiguousRefs = (block.claimRefs || []).filter(ref => canonical.get(ref)?.claimType === 'ambiguous');
            if (ambiguousRefs.length !== (block.claimRefs || []).length || block.selectedClaimRef) {
                errors.push({ code: 'RENDER_AMBIGUITY_RESOLVED' });
            }
        }
        if (block.type === 'unavailable'
            && (block.claimRefs || []).some(ref => canonical.get(ref)?.claimType === 'verified_not_found')) {
            errors.push({ code: 'RENDER_NEGATIVE_AVAILABILITY_CHANGED' });
        }
        if (block.type === 'explanation') {
            if (block.allowedNewBusinessFacts !== false
                || (block.claimRefs || []).length > 0
                || String(block.text || '').trim()
                || !['because', 'comparison', 'summary'].includes(block.connector)) {
                errors.push({ code: 'RENDER_EXPLANATION_NEW_FACT' });
            }
            if (Array.isArray(block.businessFacts) && block.businessFacts.length > 0) {
                errors.push({ code: 'RENDER_EXPLANATION_NEW_FACT' });
            }
        }
        if (Array.isArray(block.businessNumbers) && block.businessNumbers.length > 0) {
            errors.push({ code: 'RENDER_UNSUPPORTED_BUSINESS_NUMBER' });
        }
    }
    for (const ref of required) {
        if (!covered.has(ref)) errors.push({ code: 'RENDER_REQUIRED_CLAIM_MISSING', claimRef: ref });
    }
    return immutable({ valid: errors.length === 0, errors });
}

function composeRenderedAnswer(rendered, claims = []) {
    const labels = new Map(claims.map(claim => [claim.claimId, formatClaim(claim)]));
    return rendered.blocks.map(block => {
        if (block.type === 'explanation') {
            const premiseLabels = (block.premiseClaimRefs || []).map(ref => labels.get(ref)).filter(Boolean);
            if (premiseLabels.length === 0) return '';
            const prefix = block.connector === 'comparison' ? '对比依据：' : '说明依据：';
            return `${prefix}${premiseLabels.join(' ')}`;
        }
        return (block.claimRefs || []).map(ref => labels.get(ref)).filter(Boolean).join('\n');
    }).filter(Boolean).join('\n\n');
}

function rendererMessages(payload, repairErrors = null) {
    return [
        {
            role: 'system',
            content: [
                '你是受限的业务答案排版器，只返回 JSON，不调用工具，不调查事实。',
                '输出 {"blocks":[...]}。每个 factual block 必须原样引用给定 claimId，并在 claimPresentations 中逐字段原样复制 Claim；不得新增或计算业务数字、状态、关系。',
                'explanation 只能引用 premiseClaimRefs，connector 只能是 because/comparison/summary，text 必须为空；allowedNewBusinessFacts 必须为 false，businessFacts 和 businessNumbers 必须为空。',
                repairErrors ? `上一次结构错误：${JSON.stringify(repairErrors)}` : '',
            ].filter(Boolean).join('\n'),
        },
        { role: 'user', content: JSON.stringify(payload) },
    ];
}

async function callRenderer(renderer, payload, input, repairErrors = null) {
    const response = await renderer(rendererMessages(payload, repairErrors), {
        tools: [],
        stream: false,
        onProvider: input.onProvider,
        env: input.env,
        dbAccessors: input.dbAccessors,
        signal: input.signal,
    });
    const data = await response.json();
    if (data?.usage && typeof input.onUsage === 'function') input.onUsage(data.usage);
    const message = data?.choices?.[0]?.message;
    if (!message || message.tool_calls?.length) throw new Error('R3 renderer 返回非法工具调用或空消息');
    return parseRenderedAnswer(message.content);
}

function shouldUseRenderer(plan, claims) {
    return claims.length > 2 && !claims.some(claim => (
        ['ambiguous', 'unavailable', 'verified_not_found'].includes(claim.claimType)
    )) && plan.answerShape !== 'direct';
}

async function composeGroundedClaimsV4(input, state, claims) {
    const claimValidation = validateClaims(claims, {
        requirements: state.requirements,
        evidenceLedger: input.evidenceLedger,
        observations: input.observations,
        state,
    });
    const factCoverage = requiredFactCoverage(state.requirements, claims);
    if (!claimValidation.valid || !factCoverage.complete) {
        const invalidIds = new Set(claimValidation.errors.map(item => item.claimId));
        const validClaims = claims.filter(claim => !invalidIds.has(claim.claimId));
        const safePlan = buildAnswerPlan({
            claims: validClaims,
            requirements: state.requirements,
            answerShape: input.answerShape,
        });
        const grounded = formatAnswerPlanDeterministically(safePlan, validClaims);
        const notice = '部分所需事实未通过 Claim grounding 校验，未输出未经验证的业务结论。';
        return immutable({
            content: grounded ? `${grounded}\n\n${notice}` : notice,
            claims: validClaims,
            answerPlan: safePlan,
            rendering: 'safe_claim_fallback',
            groundingErrors: [...claimValidation.errors, ...factCoverage.missingFactKeys.map(factKey => ({
                code: 'REQUIRED_FACT_CLAIM_MISSING',
                factKey,
            }))],
        });
    }
    const answerPlan = buildAnswerPlan({
        claims,
        requirements: state.requirements,
        answerShape: input.answerShape,
    });
    if (!answerPlan.factCoverage.complete || !answerPlan.claimCoverage.complete) {
        return immutable({
            content: `${formatAnswerPlanDeterministically(answerPlan, claims)}\n\n部分所需 Claim 未进入 AnswerPlan，未输出缺少覆盖的业务结论。`,
            claims,
            answerPlan,
            rendering: 'safe_plan_fallback',
        });
    }
    const deterministic = formatAnswerPlanDeterministically(answerPlan, claims);
    if (!shouldUseRenderer(answerPlan, claims) || typeof input.renderer !== 'function') {
        return immutable({ content: deterministic, claims, answerPlan, rendering: 'deterministic' });
    }
    const payload = rendererPayload(input.goal, answerPlan, claims);
    let lastValidation = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const rendered = await callRenderer(input.renderer, payload, input, attempt ? lastValidation?.errors : null);
            lastValidation = validateRenderedAnswer(rendered, answerPlan, claims);
            if (lastValidation.valid) {
                return immutable({
                    content: composeRenderedAnswer(rendered, claims) || deterministic,
                    claims,
                    answerPlan,
                    rendering: 'llm_structured',
                });
            }
        } catch (error) {
            lastValidation = { valid: false, errors: [{ code: 'RENDER_FAILURE', message: error.message }] };
        }
    }
    return immutable({
        content: deterministic,
        claims,
        answerPlan,
        rendering: 'deterministic_fallback',
        renderingErrors: lastValidation?.errors || [],
    });
}

async function composeGroundedAnswerV4(input = {}) {
    const state = input.state || input.investigationState;
    let claims = [];
    try {
        claims = buildClaimsFromInvestigation(input);
        return await composeGroundedClaimsV4(input, state, claims);
    } catch (error) {
        const context = {
            requirements: state?.requirements || [],
            evidenceLedger: input.evidenceLedger || [],
            observations: input.observations || [],
            state,
        };
        const validClaims = claims.filter(claim => {
            try {
                return validateClaims([claim], context).valid;
            } catch {
                return false;
            }
        });
        let answerPlan = null;
        let grounded = '';
        try {
            answerPlan = buildAnswerPlan({
                claims: validClaims,
                requirements: state?.requirements || [],
                answerShape: input.answerShape,
            });
            grounded = formatAnswerPlanDeterministically(answerPlan, validClaims);
        } catch {
            // The terminal notice below remains safe even if plan formatting itself is unavailable.
        }
        const notice = '回答编排未能完成；已保留通过验证的 Claim，且未输出任何未经验证的业务结论。';
        return immutable({
            content: grounded ? `${grounded}\n\n${notice}` : notice,
            claims: validClaims,
            answerPlan,
            rendering: 'safe_internal_fallback',
            groundingErrors: [{
                code: error.code || 'AI_CLAIM_GROUNDING_INTERNAL_FAILURE',
                message: error.message,
            }],
        });
    }
}

module.exports = {
    FACTUAL_BLOCK_TYPES,
    SUPPORTED_DOMAINS,
    answerPlanCoverage,
    buildAnswerPlan,
    claimGroundingFlags,
    composeGroundedAnswerV4,
    eligibleClaimGroundingIntent,
    formatAnswerPlanDeterministically,
    formatClaim,
    parseRenderedAnswer,
    rendererPayload,
    validateRenderedAnswer,
};
