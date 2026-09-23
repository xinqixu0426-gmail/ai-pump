'use strict';

const { canonicalJson, normalizeJson, stableHash } = require('./stableJson.cjs');

const freeze = value => Object.freeze([...value]);
const TaskStateV2 = freeze(['NEW', 'UNDERSTANDING', 'RESOLVING', 'RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL', 'VERIFYING', 'SUSPENDED', 'RECONCILING', 'SUCCEEDED', 'PARTIAL', 'UNSUPPORTED', 'FAILED', 'CANCELLED']);
const GoalStateV2 = freeze(['PENDING', 'RUNNING', 'VERIFIED', 'PARTIAL', 'NEEDS_INPUT', 'UNSUPPORTED', 'FAILED', 'CANCELLED']);
const GoalKindV2 = freeze(['CURRENT_COST', 'RECIPE_COST_COMPARISON', 'CONFIGURATION_COMPARE', 'COIL_QUERY', 'COIL_COST', 'INVENTORY_QUERY', 'ORDER_READINESS', 'CUSTOMER_HISTORY', 'QUOTATION_QUERY', 'FILE_INSPECT', 'KNOWLEDGE_QUERY', 'MANAGEMENT_OVERVIEW', 'BUSINESS_CHANGES', 'IMPACT_INVESTIGATION', 'PROFITABILITY', 'PREPARE_CHANGE', 'APPLY_CHANGE', 'OTHER']);
const SubjectResolutionV2 = freeze(['UNRESOLVED', 'UNIQUE', 'MULTIPLE', 'NOT_FOUND', 'UNAVAILABLE', 'SELECTED']);
const SelectionBasisV2 = freeze(['NONE', 'EXPLICIT_ID', 'EXACT', 'APPROVED_ALIAS', 'USER_CHOICE', 'FORMAL_DEFAULT', 'BASELINE_INHERITANCE']);
const TemporalScopeV1 = freeze(['CURRENT', 'SAVED', 'HISTORICAL', 'SCENARIO']);
const EvidenceStateV1 = freeze(['VERIFIED_POSITIVE', 'VERIFIED_NEGATIVE']);
const StepAccessV1 = freeze(['QUERY', 'PREVIEW', 'COMMAND']);
const StepStateV1 = freeze(['PLANNED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT']);
const ArgumentSourceKindV1 = freeze(['USER_SPAN', 'FORMAL_RECEIPT', 'USER_CHOICE', 'FORMAL_POLICY', 'BASELINE_INHERITANCE', 'SOURCE_EVIDENCE']);
const BusinessWritePolicyV1 = freeze(['FORBIDDEN', 'CONFIRMATION_REQUIRED']);
const TaskExecutionModeV1 = freeze(['FOREGROUND', 'DETACHED']);
const ScenarioBasisV1 = freeze(['CURRENT_REBUILT', 'RECIPE_SNAPSHOT', 'QUOTATION_LOCKED', 'ORDER_LOCKED']);
const ScenarioPriceContextV1 = freeze(['FORMAL_READ_SET', 'LOCKED_SNAPSHOT', 'USER_HYPOTHESIS']);
const EntityTypeV1 = freeze(['part', 'coil', 'template', 'recipe', 'customer', 'quotation', 'order', 'file', 'knowledge', 'business_record']);
const FactEntityTypeV1 = freeze([...EntityTypeV1, 'global']);
const TypeHintsV1 = EntityTypeV1;
const QuantityUnitsV1 = freeze(['pump', 'piece', 'set', 'm', 'mm', 'mm2', 'kg', 'sheet', 'CNY', 'CNY_PER_KG', 'CNY_PER_TON', 'ratio']);
const OverrideFieldsV1 = freeze(['hasFloat', 'floatWire', 'floatAccessoryType', 'hasCable', 'cableLength', 'cableWire', 'cableAccessoryType', 'coilSelection', 'coilSheets', 'customBarrelLength', 'packingSelection', 'packingRemoval', 'packingClearAll', 'surfaceTreatmentMode', 'surfaceTreatmentCost', 'hasStainlessShaftJoint', 'stainlessShaftJointCost', 'wireWeight', 'copperPrice']);
const TERMINAL_TASK_STATES = freeze(['SUCCEEDED', 'PARTIAL', 'UNSUPPORTED', 'FAILED', 'CANCELLED']);
const TASK_TRANSITIONS_V2 = Object.freeze({
    NEW: ['UNDERSTANDING', 'CANCELLED', 'FAILED'],
    UNDERSTANDING: ['RESOLVING', 'WAITING_INPUT', 'UNSUPPORTED', 'CANCELLED', 'FAILED'],
    RESOLVING: ['RUNNING', 'WAITING_INPUT', 'VERIFYING', 'CANCELLED', 'FAILED'],
    RUNNING: ['RUNNING', 'RESOLVING', 'WAITING_INPUT', 'WAITING_APPROVAL', 'VERIFYING', 'SUSPENDED', 'RECONCILING', 'CANCELLED', 'FAILED'],
    WAITING_INPUT: ['RESOLVING', 'CANCELLED'], WAITING_APPROVAL: ['RESOLVING', 'RUNNING', 'CANCELLED'],
    VERIFYING: ['SUCCEEDED', 'PARTIAL', 'UNSUPPORTED', 'WAITING_INPUT', 'WAITING_APPROVAL', 'RECONCILING', 'FAILED', 'CANCELLED'],
    SUSPENDED: ['RESOLVING', 'CANCELLED'], RECONCILING: ['VERIFYING', 'WAITING_APPROVAL', 'SUSPENDED'],
    SUCCEEDED: [], PARTIAL: [], UNSUPPORTED: [], FAILED: [], CANCELLED: [],
});

module.exports = {
    ArgumentSourceKindV1, BusinessWritePolicyV1, EntityTypeV1, EvidenceStateV1, FactEntityTypeV1,
    GoalKindV2, GoalStateV2, OverrideFieldsV1, QuantityUnitsV1, ScenarioBasisV1, ScenarioPriceContextV1,
    SelectionBasisV2, StepAccessV1, StepStateV1, SubjectResolutionV2, TASK_TRANSITIONS_V2,
    TERMINAL_TASK_STATES, TaskExecutionModeV1, TaskStateV2, TemporalScopeV1, TypeHintsV1,
    canonicalJson, normalizeJson, stableHash,
};
