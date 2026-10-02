'use strict';

const { UPSTREAM_FIXTURES: U } = require('./frozenUpstreamFixture.cjs');

function base(id, user, upstream, expected) { return Object.freeze({ id, user, upstream, ...expected }); }

const BASE_CASES = Object.freeze([
    base('P-01', '模板和配方有什么区别？', U.CONCEPT, { status: 'NO_TOOL_REQUIRED', steps: 0 }),
    base('P-02', '12-120是什么意思？', U.CONCEPT, { status: 'NO_TOOL_REQUIRED', steps: 0 }),
    base('P-03', '通用款模板有哪些固定件？', U.TEMPLATE, { status: 'READY', targetTerms: ['通用款模板'], capabilities: ['templates.detail'], modes: ['READ'], minFacts: 1 }),
    base('P-04', '查一下V750通用款成本。', U.V750_GENERIC_QUALIFIED, { status: 'READY', targetTerms: ['V750通用款'], capabilities: ['recipes.current_costs'], modes: ['READ'], minFacts: 1 }),
    base('P-05', '查一下V750成本。', U.V750_GENERIC, { status: 'BLOCKED_AMBIGUITY', steps: 0 }),
    base('P-06', '12-120多少钱？', U.COIL_GENERIC, { status: 'BLOCKED_AMBIGUITY', steps: 0 }),
    base('P-07', '12-120有几个方案？', U.COIL_GENERIC, { status: 'NO_TOOL_REQUIRED', steps: 0 }),
    base('P-08', '查一下V750通用款现在用哪个线圈。', U.V750_GENERIC_QUALIFIED, { status: 'READY', capabilities: ['relations.read'], modes: ['READ'], minFacts: 1 }),
    base('P-09', 'V750通用款换木箱成本差多少？', U.V750_GENERIC_QUALIFIED, { status: 'READY', capabilities: ['recipes.current_costs', 'recipes.scenario_compare_preview', 'LOCAL_DETERMINISTIC'], modes: ['READ', 'PREVIEW', 'COMPUTE'], configs: ['木箱'], minFacts: 3, previewDependency: true }),
    base('P-10', 'V750通用款加浮球以后多少钱？', U.V750_GENERIC_QUALIFIED, { status: 'READY', capabilities: ['recipes.scenario_compare_preview'], modes: ['PREVIEW'], configs: ['浮球'], minFacts: 2 }),
    base('P-11', 'V750通用款做电泳成本增加多少？', U.V750_GENERIC_QUALIFIED, { status: 'READY', capabilities: ['recipes.scenario_compare_preview'], modes: ['PREVIEW'], configs: ['电泳'], minFacts: 2 }),
    base('P-12', 'V750通用款做不锈钢接轴成本差多少？', U.V750_GENERIC_QUALIFIED, { status: 'READY', capabilities: ['recipes.scenario_compare_preview'], modes: ['PREVIEW'], configs: ['不锈钢接轴'], minFacts: 2 }),
    base('P-13', 'V750通用款电缆5米，木箱，先算一下，不保存。', U.V750_GENERIC_QUALIFIED, { status: 'READY', capabilities: ['recipes.scenario_compare_preview'], modes: ['PREVIEW'], configs: ['电缆5米', '木箱'], minFacts: 2, noWrite: true }),
    base('P-14', 'V750通用款和V110成本差多少？', Object.freeze({ ...U.V750_GENERIC_QUALIFIED, finalGroundedTargets: Object.freeze([...U.V750_GENERIC_QUALIFIED.finalGroundedTargets, ...U.V110.finalGroundedTargets]) }), { status: 'READY', targetTerms: ['V750通用款', 'V110'], capabilities: ['recipes.current_costs', 'LOCAL_DETERMINISTIC'], modes: ['READ', 'COMPUTE'], multiTarget: true, parallelReads: true }),
    base('P-15', '12-120-A和12-130-A成本分别多少？', Object.freeze({ ...U.COIL_A, finalGroundedTargets: Object.freeze([...U.COIL_A.finalGroundedTargets, ...U.COIL_130_A.finalGroundedTargets]) }), { status: 'READY', targetTerms: ['12-120-A', '12-130-A'], capabilities: ['coils.list'], modes: ['READ'], multiTarget: true }),
    base('P-16', '这个多少钱？', U.UNRESOLVED, { status: 'BLOCKED_GROUNDING', steps: 0 }),
    base('P-17', '把V750通用款包装改成木箱并保存。', U.V750_GENERIC_QUALIFIED, { status: 'BLOCKED_POLICY', previewAvailable: true, noWrite: true }),
    base('P-18', '通用款和豪贝款的V750成本分别多少？', U.QUALIFIED_STYLES, { status: 'READY', targetTerms: ['V750通用款', 'V750豪贝款'], capabilities: ['recipes.current_costs'], modes: ['READ'], multiTarget: true }),
]);

const NEGATIVE_CASES = Object.freeze([
    base('N-01', '通用款模板有哪些固定件？', U.TEMPLATE, { status: 'BLOCKED_CAPABILITY', steps: 0, catalogOmit: ['templates.detail'] }),
    base('N-02', '12-120多少钱？', U.COIL_GENERIC, { status: 'BLOCKED_AMBIGUITY', steps: 0 }),
    base('N-03', '通用款模板有哪些固定件？', U.TEMPLATE, { status: 'READY', capabilities: ['templates.detail'], modes: ['READ'], minFacts: 1 }),
    base('N-04', 'V750通用款电缆5米，木箱，先算一下，不保存。', U.V750_GENERIC_QUALIFIED, { status: 'READY', capabilities: ['recipes.scenario_compare_preview'], modes: ['PREVIEW'], configs: ['电缆5米', '木箱'], noWrite: true }),
    base('N-05', 'V750通用款换木箱成本差多少？', U.V750_GENERIC_QUALIFIED, { status: 'READY', capabilities: ['recipes.scenario_compare_preview'], modes: ['PREVIEW'], configs: ['木箱'], noWrite: true, catalogHasHiddenWrite: true }),
    base('N-06', 'V750通用款和V110成本差多少？', Object.freeze({ ...U.V750_GENERIC_QUALIFIED, finalGroundedTargets: Object.freeze([...U.V750_GENERIC_QUALIFIED.finalGroundedTargets, ...U.V110.finalGroundedTargets]) }), { status: 'READY', capabilities: ['recipes.current_costs', 'LOCAL_DETERMINISTIC'], modes: ['READ', 'COMPUTE'], multiTarget: true, parallelReads: true }),
    base('N-07', 'V750通用款换木箱成本差多少？', U.V750_GENERIC_QUALIFIED, { status: 'READY', capabilities: ['recipes.scenario_compare_preview'], modes: ['PREVIEW'], configs: ['木箱'], previewDependency: true }),
    base('N-08', '这个多少钱？', U.UNRESOLVED, { status: 'BLOCKED_GROUNDING', steps: 0 }),
]);

const TARGETED_IDS = Object.freeze(['P-01', 'P-03', 'P-05', 'P-06', 'P-07', 'P-08', 'P-09', 'P-13', 'P-16', 'P-17']);
const TARGETED_CASES = Object.freeze(TARGETED_IDS.map(id => BASE_CASES.find(item => item.id === id)));

module.exports = { BASE_CASES, NEGATIVE_CASES, TARGETED_CASES };
