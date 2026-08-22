const STAINLESS_SHAFT_JOINT_SETTING_KEY = 'stainless_shaft_joint_default_cost';
const STAINLESS_SHAFT_JOINT_DEFAULT_COST = 6;
const STAINLESS_SHAFT_JOINT_MIN_COST = 5;
const STAINLESS_SHAFT_JOINT_MAX_COST = 8;
const STAINLESS_SHAFT_JOINT_PROCESS = 'stainless_friction_weld';

function shaftJointError(message, details) {
    const error = new Error(message);
    error.code = 'STAINLESS_SHAFT_JOINT_COST_INVALID';
    error.statusCode = 422;
    if (details !== undefined) error.details = details;
    return error;
}

function validateStainlessShaftJointCost(value, field = 'stainlessShaftJointCost') {
    const cost = Number(value);
    if (!Number.isFinite(cost)
        || cost < STAINLESS_SHAFT_JOINT_MIN_COST
        || cost > STAINLESS_SHAFT_JOINT_MAX_COST) {
        throw shaftJointError(
            `${field} 必须在 ${STAINLESS_SHAFT_JOINT_MIN_COST} 至 ${STAINLESS_SHAFT_JOINT_MAX_COST} 元之间`,
            {
                field,
                min: STAINLESS_SHAFT_JOINT_MIN_COST,
                max: STAINLESS_SHAFT_JOINT_MAX_COST,
                value,
            }
        );
    }
    return Math.round(cost * 100) / 100;
}

function defaultStainlessShaftJointCost(getSetting = () => undefined) {
    const configured = getSetting(STAINLESS_SHAFT_JOINT_SETTING_KEY);
    if (configured === undefined || configured === null || configured === '') {
        return STAINLESS_SHAFT_JOINT_DEFAULT_COST;
    }
    return validateStainlessShaftJointCost(
        configured,
        STAINLESS_SHAFT_JOINT_SETTING_KEY
    );
}

function resolveStainlessShaftJointConfiguration(input = {}, getSetting = () => undefined) {
    const enabled = input.hasStainlessShaftJoint === true
        || input.hasStainlessShaftJoint === 1
        || input.hasStainlessShaftJoint === '1';
    if (!enabled) {
        return {
            hasStainlessShaftJoint: false,
            stainlessShaftJointCost: 0,
            rotorShaftProcess: 'standard',
        };
    }
    const suppliedCost = input.stainlessShaftJointCost;
    const cost = suppliedCost === undefined || suppliedCost === null || suppliedCost === ''
        ? defaultStainlessShaftJointCost(getSetting)
        : validateStainlessShaftJointCost(suppliedCost);
    return {
        hasStainlessShaftJoint: true,
        stainlessShaftJointCost: cost,
        rotorShaftProcess: STAINLESS_SHAFT_JOINT_PROCESS,
    };
}

function buildStainlessShaftJointBomPart(configuration) {
    if (!configuration?.hasStainlessShaftJoint) return null;
    const cost = validateStainlessShaftJointCost(configuration.stainlessShaftJointCost);
    return {
        model: '不锈钢接轴加工',
        name: '转子不锈钢接轴加工',
        supplier: '',
        qty: 1,
        snapshotPrice: cost,
        inventoryType: 'none',
        costSource: 'process',
        source: 'configuration_override',
        processCode: STAINLESS_SHAFT_JOINT_PROCESS,
        processDescription: '普通45号钢轴外露电机部分摩擦焊接不锈钢轴',
        costRole: 'rotorProcess',
        configurationDependencies: [
            'hasStainlessShaftJoint',
            'stainlessShaftJointCost',
        ],
        formula: `不锈钢接轴加工费 ${cost}`,
    };
}

function isRotorProcessPart(part = {}) {
    return part.costRole === 'rotorProcess'
        || part.processCode === STAINLESS_SHAFT_JOINT_PROCESS;
}

module.exports = {
    STAINLESS_SHAFT_JOINT_DEFAULT_COST,
    STAINLESS_SHAFT_JOINT_MAX_COST,
    STAINLESS_SHAFT_JOINT_MIN_COST,
    STAINLESS_SHAFT_JOINT_PROCESS,
    STAINLESS_SHAFT_JOINT_SETTING_KEY,
    buildStainlessShaftJointBomPart,
    defaultStainlessShaftJointCost,
    isRotorProcessPart,
    resolveStainlessShaftJointConfiguration,
    validateStainlessShaftJointCost,
};
