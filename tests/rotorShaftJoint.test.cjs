const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildStainlessShaftJointBomPart,
    resolveStainlessShaftJointConfiguration,
    validateStainlessShaftJointCost,
} = require('../api/services/rotorShaftJoint.cjs');

test('不锈钢接轴默认关闭且关闭时忽略客户端费用', () => {
    assert.deepEqual(
        resolveStainlessShaftJointConfiguration({
            hasStainlessShaftJoint: false,
            stainlessShaftJointCost: 999,
        }),
        {
            hasStainlessShaftJoint: false,
            stainlessShaftJointCost: 0,
            rotorShaftProcess: 'standard',
        }
    );
});

test('不锈钢接轴启用时读取全局默认费用并生成非库存工艺行', () => {
    assert.equal(
        resolveStainlessShaftJointConfiguration({ hasStainlessShaftJoint: true })
            .stainlessShaftJointCost,
        6
    );
    const configuration = resolveStainlessShaftJointConfiguration(
        { hasStainlessShaftJoint: true },
        key => key === 'stainless_shaft_joint_default_cost' ? '6.5' : undefined
    );
    const part = buildStainlessShaftJointBomPart(configuration);

    assert.equal(configuration.stainlessShaftJointCost, 6.5);
    assert.equal(configuration.rotorShaftProcess, 'stainless_friction_weld');
    assert.equal(part.snapshotPrice, 6.5);
    assert.equal(part.inventoryType, 'none');
    assert.equal(part.costRole, 'rotorProcess');
    assert.equal(part.partId, undefined);
    assert.deepEqual(part.configurationDependencies, [
        'hasStainlessShaftJoint',
        'stainlessShaftJointCost',
    ]);
});

test('不锈钢接轴加工费仅允许5至8元闭区间', () => {
    assert.equal(validateStainlessShaftJointCost(5), 5);
    assert.equal(validateStainlessShaftJointCost(8), 8);
    for (const value of [4.99, 8.01, '不是数字']) {
        assert.throws(
            () => validateStainlessShaftJointCost(value),
            error => error.code === 'STAINLESS_SHAFT_JOINT_COST_INVALID'
                && error.statusCode === 422
        );
    }
});
