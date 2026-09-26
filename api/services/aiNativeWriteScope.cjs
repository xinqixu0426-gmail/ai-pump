'use strict';

/**
 * NATIVE-W1：Native Write V1 的能力白名单与输入形状契约。
 *
 * 设计要点（对应 NATIVE-W1 ticket §4 / §6 / §23 / §26）：
 *   - **默认拒绝**：只有显式登记在 `NATIVE_WRITE_V1_TOOLS` 里的 AI 工具可以进入 Native 写链路。
 *     注册表里其它变更能力（价格、配方、订单、删除、设置、行情……）不会因为存在就获得 Native 写权限；
 *     将来新增的写能力同样必须**显式**改这里才会开放。
 *   - **单一目标**：V1 只允许「一个零件 + 一次库存调整」；多目标批量一律拒绝，绝不静默拆分。
 *   - **数量必须由用户给出**：只接受非零整数增量；缺数量或非法数量一律拒绝，绝不猜测。
 *   - **不存在删除**：本白名单只含库存调整，任何 DELETE 类能力都永远不在其中。
 *
 * 本模块是纯判定：不访问数据库、不调用业务 API、不产生任何副作用。
 */

const NATIVE_WRITE_V1_CAPABILITY = 'inventory.parts.batch_adjust_stock';
const NATIVE_WRITE_V1_TOOL = 'adjust_part_stock';
const NATIVE_WRITE_V1_TOOLS = Object.freeze([NATIVE_WRITE_V1_TOOL]);
const NATIVE_WRITE_V1_CAPABILITIES = Object.freeze([NATIVE_WRITE_V1_CAPABILITY]);
const MAX_NOTE_LENGTH = 200;

function isNativeWriteV1Tool(toolName) {
    return NATIVE_WRITE_V1_TOOLS.includes(String(toolName || '').trim());
}

function isNativeWriteV1Capability(capabilityId) {
    return NATIVE_WRITE_V1_CAPABILITIES.includes(String(capabilityId || '').trim());
}

function reject(code, message, statusCode) {
    return { ok: false, code, message, statusCode };
}

/**
 * 校验并规范化一次 V1 写请求（纯函数）。
 * @returns {{ok:true, toolName:string, capabilityId:string, target:{model:string}, delta:number, args:object}}
 *        | {{ok:false, code:string, message:string, statusCode:number}}
 */
function validateNativeWriteV1Request({ toolName, args } = {}) {
    const normalizedTool = String(toolName || '').trim();
    if (!isNativeWriteV1Tool(normalizedTool)) {
        return reject(
            'NATIVE_WRITE_CAPABILITY_UNSUPPORTED',
            'Native Write V1 只开放「单个零件库存调整」，该写能力当前未开放。',
            403
        );
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return reject('TASK_WRITE_REQUEST_INVALID', '写入预检请求缺少有效参数', 400);
    }
    const items = args.items;
    if (!Array.isArray(items) || items.length !== 1) {
        return reject(
            'NATIVE_WRITE_SINGLE_TARGET_REQUIRED',
            'Native Write V1 每次只允许调整一个零件的库存；请一次提交一个零件。',
            409
        );
    }
    const item = items[0];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return reject('TASK_WRITE_REQUEST_INVALID', '写入预检请求缺少有效目标', 400);
    }
    const model = typeof item.model === 'string' ? item.model.trim() : '';
    if (!model) {
        return reject('NATIVE_WRITE_TARGET_MODEL_REQUIRED', '必须提供要调整的零件型号', 400);
    }
    const delta = item.changeQty;
    if (!Number.isInteger(delta) || delta === 0) {
        return reject('NATIVE_WRITE_QUANTITY_INVALID', '库存调整数量必须是非零整数（入库为正、出库为负）', 400);
    }
    const note = typeof args.note === 'string' ? args.note.trim().slice(0, MAX_NOTE_LENGTH) : '';
    const normalizedArgs = Object.freeze({
        items: Object.freeze([Object.freeze({ model, changeQty: delta })]),
        ...(note ? { note } : {}),
    });
    return {
        ok: true,
        toolName: normalizedTool,
        capabilityId: NATIVE_WRITE_V1_CAPABILITY,
        target: Object.freeze({ model }),
        delta,
        args: normalizedArgs,
    };
}

module.exports = {
    MAX_NOTE_LENGTH,
    NATIVE_WRITE_V1_CAPABILITIES,
    NATIVE_WRITE_V1_CAPABILITY,
    NATIVE_WRITE_V1_TOOL,
    NATIVE_WRITE_V1_TOOLS,
    isNativeWriteV1Capability,
    isNativeWriteV1Tool,
    validateNativeWriteV1Request,
};
