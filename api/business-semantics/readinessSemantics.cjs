'use strict';
/**
 * S2-R3-P1 — 齐料 / 缺料（material readiness）语义的**唯一权威**。
 *
 * 背景（真实 Owner canary 缺陷 2+3）：
 *   ① `按300台虚拟齐料预览` / `按300台虚拟齐料 V750…` 在 WAITING_INPUT 死循环，
 *      而 `…虚拟齐料预览300台` 成功 —— 数量抽取依赖词序；
 *   ② `缺什么料？` / `缺料预览…100台` 进不了 readiness 目标，落到 Legacy 后
 *      在**成本**域用「没有取得可用金额」回答一个从未问过金额的问题。
 *
 * 修复原则（Supervisor 裁定，禁止逐句堆正则）：
 *   判据是**业务含义**，不是句式：
 *     - readiness 域 = 句中出现「库存管理物料是否齐备」的业务概念，
 *       由【物料词 + 齐备/缺口谓词】或【齐料/缺料预览类复合词】共现判定；
 *     - 数量是**当前话语的独立结构化槽位**，与词序无关，也不由意图正则去"证明存在"。
 *
 * 本模块同时被两层消费，因此两层不可能再漂移：
 *   - 业务语义层 `business-semantics/questionSemantics.cjs`（Legacy / 语义帧 / answer boundary）；
 *   - Task V2 语义层 `services/aiTaskSemanticsV2.cjs`（Native 目标规划）。
 */

// ── 数量槽位 ─────────────────────────────────────────────────────────────
// 允许出现在数字前的「数量语境」：句首、空白/标点、数量介词/分配词，
// 或 `做/生产/需要/备` 这类需求动词。数字后必须是数量单位。
// 这样 `300台`、`按300台`、`各100台` 都能定位，而
// `12-120`、`2寸`、`12-200成本`、`铜价95` 不会被误当成数量。
// 数字前必须是「数量语境」：行首、空白/标点、数量介词/分配词、型号尾字
// （款/型/号，例如 `…经典款300台`）、预览词或需求动词。
// 用**固定长度** lookbehind 表达（JS 不允许变长 lookbehind 分支；行首由独立分支覆盖）。
const QUANTITY_CONTEXT = String.raw`[\s，,。；;！!？?：:、＂"'（）()【】按约共总各均每需要需做生产接备来览款型号]`;
const QUANTITY_UNIT = String.raw`(?:台|pcs|PCS|件|套)`;
// 数字后必须是数量单位。**不再要求单位后是标点/结尾** —— 那正是
// 「按300台虚拟齐料」「生产100台缺什么料」解析不到数量的原因（S2-R3-P1 §A 的词序无关要求）。
// 误判由「数字前必须是数量语境」+ 有限量词表共同挡住：`12-120`、`2寸`、`12-200成本` 都不满足。
const QUANTITY_PATTERN = new RegExp(String.raw`(?:^|(?<=${QUANTITY_CONTEXT}))\s*(\d{1,7}|[一二三四五六七八九十百]{1,4})\s*${QUANTITY_UNIT}`, 'gu');
const CHINESE_DIGITS = Object.freeze({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 });

/** 常用中文数量（一~九百九十九）。只做确定性换算，不做语义猜测。 */
function parseChineseQuantity(token) {
    const text = String(token || '');
    if (!text) return null;
    if (!/^[一二三四五六七八九十百]+$/u.test(text)) return null;
    let total = 0; let section = 0; let digit = 0;
    for (const character of text) {
        if (character === '百') { section += (digit || 1) * 100; digit = 0; continue; }
        if (character === '十') { section += (digit || 1) * 10; digit = 0; continue; }
        digit = CHINESE_DIGITS[character] ?? 0;
    }
    total += section + digit;
    return total > 0 && Number.isSafeInteger(total) ? total : null;
}

/**
 * 抽取「当前话语」里的数量槽位。
 * @returns {{value:number, quote:string, start:number, end:number, unit:string, literal:string}|null}
 *         找不到时返回 null（绝不默认数量）。
 */
function extractQuantitySlot(text) {
    const source = String(text || '');
    if (!source) return null;
    let best = null;
    QUANTITY_PATTERN.lastIndex = 0;
    for (const match of source.matchAll(QUANTITY_PATTERN)) {
        const value = /^\d+$/u.test(match[1]) ? Number(match[1]) : parseChineseQuantity(match[1]);
        if (!Number.isSafeInteger(value) || value < 1) continue;
        const quote = match[0].trimStart();
        const start = match.index + (match[0].length - quote.length);
        if (best && best.start <= start) continue;
        best = { value, quote, start, end: start + quote.length, unit: 'pump', literal: match[1] };
    }
    if (best) return best;
    // 「数量300台」这类显式标签句：标签本身证明是数量，不依赖上文语境词。
    const labelled = /数量\s*[:：]?\s*(\d{1,7})\s*(?:台|pcs|PCS|件|套)?/u.exec(source);
    if (labelled) {
        const value = Number(labelled[1]);
        if (Number.isSafeInteger(value) && value >= 1) {
            return { value, quote: labelled[0], start: labelled.index, end: labelled.index + labelled[0].length, unit: 'pump', literal: labelled[1] };
        }
    }
    return null;
}

// ── 齐料域的含义判据 ──────────────────────────────────────────────────────
// 物料词：句子的对象是「要用到的物料/库存」。中文里单独一个「料」在齐料语境下
// 就是物料（缺什么料 / 还缺料 / 料够不够），因此它是材料词而不是句式补丁。
const MATERIAL_TOKEN = /(?:物料|原材料|材料|料|零件|配件|齐料|齐套|备料|库存|有货)/u;
// 齐备类谓词：问「够不够/齐不齐」。
const SUFFICIENCY_PREDICATE = /(?:够不够|够不够用|够用|够做|够生产|够吗|是否够|能(?:不能)?(?:做|生产)|齐不齐|齐了|齐吗|备齐|是否齐|齐料|有货|有库存)/u;
// 缺口类谓词：问「缺什么/差多少」。
const SHORTAGE_PREDICATE = /(?:缺什么|缺哪些|缺哪|缺料|缺件|缺多少|缺少什么|短缺|不够|不足|还差|差什么|差哪些|还缺|少什么)/u;
// 预览类复合词/裸词：本身就是齐料预览的业务说法。
const PREVIEW_LEXEME = /(?:虚拟齐料|齐料预览|缺料预览|备料预览|物料预览|齐套预览|缺件预览|齐料|缺料|备料|齐套)/u;
// 线圈域：线圈库存/成本有自己的族，绝不并入配方齐料。
const COIL_DOMAIN = /(?:线圈|绕组|线径|钢带|冷轧|小眼|国标眼|大眼|大槽|小槽|圆槽|线重)/u;
const COIL_SHORTHAND = /(?:^|[^\d])\d{1,3}\s*[-－]\s*\d{2,4}(?:[^\d]|$)/u;
// 配方主体标识：readiness 的正式对象是成品配方。
const RECIPE_IDENTIFIER = /\bV\d+/iu;

/**
 * 判定一句话是不是「按某个数量的配方齐料/缺料预览」请求。
 *
 * 业务形态只有三种，都是**含义**而不是句式：
 *   ① 问齐备：「…够不够 / 齐不齐 / 有货吗」+ 物料词；
 *   ② 问缺口：「缺什么料 / 还差什么」+ 物料词；
 *   ③ 给出数量问物料：「再做300台库存」「做300台料」——数量本身就是齐料预览的前提。
 * 齐料/缺料/虚拟齐料/齐套预览等复合词是同一概念的固定说法，单独即可成立。
 *
 * @returns {{
 *   active:boolean, ask:'SHORTAGE'|'SUFFICIENCY', subject:'recipe'|null,
 *   quantity:{value:number,quote:string,start:number,end:number,unit:string}|null,
 *   evidence:string[], reason:string|null
 * }}
 */
function readinessProfile(text) {
    const source = String(text || '');
    const empty = { active: false, ask: null, subject: null, quantity: null, evidence: [], reason: null };
    if (!source.trim()) return { ...empty, quantity: null };
    if (COIL_SHORTHAND.test(source) || COIL_DOMAIN.test(source)) return { ...empty, reason: 'COIL_DOMAIN' };
    if (!RECIPE_IDENTIFIER.test(source)) return { ...empty, reason: 'NO_RECIPE_SUBJECT' };
    const material = MATERIAL_TOKEN.test(source);
    const sufficiency = SUFFICIENCY_PREDICATE.test(source);
    const shortage = SHORTAGE_PREDICATE.test(source);
    const preview = PREVIEW_LEXEME.test(source);
    const quantity = extractQuantitySlot(source);
    if (!((material && (sufficiency || shortage)) || preview || (material && quantity !== null))) {
        return { ...empty, reason: 'NO_READINESS_CONCEPT' };
    }
    const evidence = [];
    for (const [label, pattern] of [['MATERIAL', MATERIAL_TOKEN], ['SUFFICIENCY', SUFFICIENCY_PREDICATE],
        ['SHORTAGE', SHORTAGE_PREDICATE], ['PREVIEW', PREVIEW_LEXEME]]) {
        const match = pattern.exec(source);
        if (match) evidence.push(`${label}:${match[0]}`);
    }
    if (material && quantity !== null) evidence.push(`QUANTITY:${quantity.quote}`);
    return {
        active: true,
        ask: shortage || /缺料|缺件/.test(source) ? 'SHORTAGE' : 'SUFFICIENCY',
        subject: 'recipe',
        quantity,
        evidence,
        reason: null,
    };
}

/** 该句是否是一个齐料/缺料预览请求（业务含义判据，不看具体句式）。 */
function isReadinessRequest(text) {
    return readinessProfile(text).active;
}

/** 可选的正式数量默认值。当前契约没有定义齐料默认数量 → 永远 null（绝不猜数量）。 */
function formalDefaultQuantity() {
    return null;
}

module.exports = {
    COIL_DOMAIN, MATERIAL_TOKEN, PREVIEW_LEXEME, SHORTAGE_PREDICATE, SUFFICIENCY_PREDICATE,
    extractQuantitySlot, formalDefaultQuantity, isReadinessRequest, parseChineseQuantity, readinessProfile,
};
