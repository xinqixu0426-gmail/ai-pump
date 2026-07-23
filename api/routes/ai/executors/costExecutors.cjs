const { getJson, postJson } = require('../internalApiClient.cjs');

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
            const data = await getJson(internalFetch, `/api/cost/recipe/by-name?name=${encodeURIComponent(args.name)}`, '配方成本查询失败');
            return { success: true, data };
        }

        case 'query_recipe_cost_by_id': {
            const data = await getJson(internalFetch, `/api/recipes/${args.id}/cost`, '配方成本查询失败');
            return { success: true, data };
        }

        case 'full_calculate': {
            const data = await postJson(internalFetch, '/api/cost/full-estimate', args, '完整成本估算失败');
            return { success: true, data };
        }

        case 'get_copper_price': {
            const data = await getJson(internalFetch, '/api/copper-price', '铜价读取失败');
            return { success: true, data };
        }

        case 'calculate_coil_cost': {
            const data = await postJson(internalFetch, '/api/coils/calculate', { spec: args.spec, sheets: args.sheets, material: args.material || null, slotType: args.slotType || '小眼', wireWeight: args.wireWeight || null }, '线圈成本计算失败');
            return { success: true, data };
        }

        case 'dynamic_config_cost': {
            const data = await postJson(internalFetch, '/api/cost/dynamic', args, '动态配置成本计算失败');
            return { success: true, data };
        }

        case 'generate_rotor_drawing': {
            const drawParams = { ...args };
            let templateInfo = null;

            // 如果提供了泵壳型号，从模板中提取轴承和油封参数
            if (args.shell_model) {
                const allTemplates = await getJson(internalFetch, '/api/templates', '泵壳模板读取失败');
                const tpl = allTemplates.find(t => 
                    (t.shellModel || '') === args.shell_model ||
                    (t.shellModel || '').includes(args.shell_model)
                );
                if (!tpl) {
                    return { success: false, error: `未找到泵壳模板: ${args.shell_model}` };
                }

                templateInfo = { model: tpl.shellModel, extracted: {} };
                const draft = await postJson(internalFetch, '/api/rotor/template-draft', {
                    templateId: tpl.id ?? tpl.Id,
                    variantId: args.variant_id || args.variantId || undefined,
                }, '转子模板草稿生成失败');
                for (const [key, value] of Object.entries(draft.patch || {})) {
                    if (value != null && value !== '' && drawParams[key] == null) {
                        drawParams[key] = value;
                        templateInfo.extracted[key] = value;
                    }
                }
                if (draft.drawingText && !drawParams.drawingText && !drawParams.drawing_text) drawParams.drawingText = draft.drawingText;
                if (draft.hints) templateInfo.hints = draft.hints;
                if (draft.openOffset != null) templateInfo.openOffset = draft.openOffset;
                if (draft.barrelLength != null) templateInfo.barrelLength = draft.barrelLength;

                // 清理 shell_model 字段，不传给 /api/rotor/draw
                delete drawParams.shell_model;
                delete drawParams.variant_id;
                delete drawParams.variantId;
            }

            try {
                const result = await postJson(internalFetch, '/api/rotor/draw', drawParams, '出图失败');
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
            } catch (error) {
                return { success: false, error: error.message || '出图失败' };
            }
        }

        case 'print_rotor_drawing': {
            const { jobId } = args;
            if (!jobId) return { success: false, error: '缺少 jobId 参数' };
            try {
                await postJson(internalFetch, `/api/rotor/print/${jobId}`, undefined, '打印失败');
                return { success: true, message: '打印指令已发送到默认打印机', jobId };
            } catch (error) {
                return { success: false, error: error.message || '打印失败' };
            }
        }

        case 'get_rotor_drawing_history': {
            const limit = args.limit || 10;
            const rows = await getJson(internalFetch, '/api/rotor/history', '出图历史读取失败');
            const recent = (Array.isArray(rows) ? rows : []).slice(0, limit).map(r => ({
                jobId: r.jobId ?? r.job_id,
                status: r.status,
                input: ((r.nlInput ?? r.nl_input) || '').slice(0, 80),
                fileUrl: r.fileUrl ?? r.file_url,
                createdAt: r.createdAt ?? r.created_at
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
