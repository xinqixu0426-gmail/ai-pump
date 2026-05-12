const { dbGetAllTemplates } = require('../../../db.cjs');

/**
 * 成本计算与出图相关的 AI 工具执行器
 * @param {string} toolName
 * @param {object} args
 * @param {function} internalFetch - 内部网络请求助手
 * @returns {Promise<object>} 执行结果
 */
async function executeCostTool(toolName, args, internalFetch) {
    switch (toolName) {
        case 'query_recipe_cost_by_name': {
            const response = await internalFetch(`/api/cost/recipe/by-name?name=${encodeURIComponent(args.name)}`);
            return await response.json();
        }

        case 'query_recipe_cost_by_id': {
            const response = await internalFetch(`/api/cost/recipe/${args.id}`);
            return await response.json();
        }

        case 'full_calculate': {
            const response = await internalFetch(`/api/cost/full-calculate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args)
            });
            return await response.json();
        }

        case 'get_copper_price': {
            const response = await internalFetch(`/api/copper-price`);
            return await response.json();
        }

        case 'calculate_coil_cost': {
            const response = await internalFetch(`/api/coils/calculate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spec: args.spec, sheets: args.sheets, material: args.material || null, wireWeight: args.wireWeight || null })
            });
            return await response.json();
        }

        case 'dynamic_config_cost': {
            const response = await internalFetch(`/api/cost/dynamic-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args)
            });
            return await response.json();
        }

        case 'generate_rotor_drawing': {
            const drawParams = { ...args };
            let templateInfo = null;

            // 如果提供了泵壳型号，从模板中提取轴承和油封参数
            if (args.shell_model) {
                const allTemplates = dbGetAllTemplates();
                const tpl = allTemplates.find(t => 
                    (t.泵壳型号 || t.shell_model || '') === args.shell_model ||
                    (t.泵壳型号 || t.shell_model || '').includes(args.shell_model)
                );
                if (!tpl) {
                    return { success: false, error: `未找到泵壳模板: ${args.shell_model}` };
                }

                let parts = [];
                try { parts = JSON.parse(tpl.配件JSON || tpl.parts_json || '[]'); } catch (e) {}

                templateInfo = { model: tpl.泵壳型号 || tpl.shell_model, extracted: {} };

                // 花板轴承 → 上轴承
                const upperBPart = parts.find(p => (p.name || '').includes('花板轴承'));
                if (upperBPart && !drawParams.upper_bearing) {
                    // 从 model 中提取轴承型号 (如 '6202-2RS 轴承' → '6202-2RS', '202' → '202')
                    const bearingModel = (upperBPart.model || '').replace(/\s*轴承.*$/, '').trim();
                    drawParams.upper_bearing = bearingModel;
                    templateInfo.extracted.upper_bearing = bearingModel;
                }
                // 油缸轴承 → 下轴承
                const lowerBPart = parts.find(p => (p.name || '').includes('油缸轴承'));
                if (lowerBPart && !drawParams.lower_bearing) {
                    const bearingModel = (lowerBPart.model || '').replace(/\s*轴承.*$/, '').trim();
                    drawParams.lower_bearing = bearingModel;
                    templateInfo.extracted.lower_bearing = bearingModel;
                }
                // 机械油封 → 油封孔径 (model格式: '14*28*38', 取第一段)
                const sealPart = parts.find(p => (p.name || '').includes('机械油封'));
                if (sealPart && drawParams.oil_seal_dia == null) {
                    const sealDia = parseFloat((sealPart.model || '').split('*')[0]);
                    if (!isNaN(sealDia)) {
                        drawParams.oil_seal_dia = sealDia;
                        templateInfo.extracted.oil_seal_dia = sealDia;
                    }
                }

                // 从 rotor_params_json 提取出图尺寸参数（开档、定位等）
                let rotorParams = {};
                try { rotorParams = JSON.parse(tpl.rotor_params_json || '{}'); } catch (e) {}
                const rotorKeys = ['bearing_span', 'stack_offset', 'bearing_to_impeller',
                    'impeller_depth', 'impeller_dia', 'thread_dia', 'thread_length', 'rotor_dia'];
                for (const k of rotorKeys) {
                    if (rotorParams[k] != null && drawParams[k] == null) {
                        drawParams[k] = rotorParams[k];
                        templateInfo.extracted[k] = rotorParams[k];
                    }
                }

                // 清理 shell_model 字段，不传给 /api/rotor/draw
                delete drawParams.shell_model;
            }

            const response = await internalFetch('/api/rotor/draw', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(drawParams)
            });
            const result = await response.json();
            if (result.status === 'success') {
                const ret = {
                    success: true,
                    message: '出图任务已启动，大约需要15-30秒',
                    jobId: result.jobId,
                    params: result.params,
                    statusUrl: `/api/rotor/status/${result.jobId}`,
                    printUrl: `/api/rotor/print/${result.jobId}`
                };
                if (templateInfo) ret.templateInfo = templateInfo;
                return ret;
            }
            return { success: false, error: result.message || '出图失败' };
        }

        case 'print_rotor_drawing': {
            const { jobId } = args;
            if (!jobId) return { success: false, error: '缺少 jobId 参数' };
            const response = await internalFetch(`/api/rotor/print/${jobId}`, {
                method: 'POST'
            });
            const result = await response.json();
            if (result.ok) {
                return { success: true, message: '打印指令已发送到默认打印机', jobId };
            }
            return { success: false, error: result.error || '打印失败' };
        }

        case 'get_rotor_drawing_history': {
            const limit = args.limit || 10;
            const response = await internalFetch('/api/rotor/history');
            const rows = await response.json();
            const recent = (Array.isArray(rows) ? rows : []).slice(0, limit).map(r => ({
                jobId: r.job_id,
                status: r.status,
                input: (r.nl_input || '').slice(0, 80),
                fileUrl: r.file_url,
                createdAt: r.created_at
            }));
            return { success: true, count: recent.length, history: recent };
        }

        default:
            return null; // 不是 costTools
    }
}

const COST_TOOLS = new Set([
    'query_recipe_cost_by_name', 'query_recipe_cost_by_id', 'full_calculate',
    'get_copper_price', 'calculate_coil_cost', 'dynamic_config_cost',
    'generate_rotor_drawing', 'print_rotor_drawing', 'get_rotor_drawing_history'
]);

module.exports = { executeCostTool, COST_TOOLS };
