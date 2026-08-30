const { getJson, postJson } = require('../internalApiClient.cjs');

function coilDiameter(spec, diameterMm) {
    const stored = Number(diameterMm || 0);
    if (stored > 0) return stored;
    const text = String(spec || '').trim();
    return text === '12' ? 120 : Number.parseInt(text, 10) || 0;
}

function coilCandidateData(coil) {
    return {
        id: coil.id ?? coil.Id,
        spec: coil.commonName || coil.spec,
        diameterMm: coilDiameter(coil.spec, coil.diameterMm),
        sheets: Number(coil.sheets || 0),
        material: coil.material || '钢带',
        slotType: coil.slotType || '小眼',
        schemeName: coil.schemeName || '',
        schemeCode: coil.schemeCode || '',
        schemeStatus: coil.schemeStatus || 'official',
        isDefault: Boolean(coil.isDefault),
        ratedVoltageV: coil.ratedVoltageV ?? null,
        ratedFrequencyHz: coil.ratedFrequencyHz ?? null,
        market: coil.market || '',
        schemeFamilyCode: coil.schemeFamilyCode || '',
        pricingMode: coil.pricingMode === 'kit' ? 'kit' : 'calculated',
        kitPrice: Number(coil.kitPrice || 0),
        unitPrice: Number(coil.unitPrice || 0),
        wireWeight: Number(coil.wireWeight || 0),
        copperBase: Number(coil.copperBase || 0),
        coilFee: Number(coil.coilFee || 0),
        rotorFee: Number(coil.rotorFee || 0),
        cost: Number(coil.cost || 0),
        pairedCableWireGauge: coil.defaultWireGauge || '',
        defaultCapacitor: coil.defaultCapacitor || '',
        mainWireGauge: coil.mainWireGauge || '',
        mainWireData: coil.mainWireData || '',
        auxWireGauge: coil.auxWireGauge || '',
        auxWireData: coil.auxWireData || '',
    };
}

/**
 * 成本计算与出图相关的 AI 工具执行器
 * @param {string} toolName
 * @param {object} args
 * @param {function} internalFetch - 内部网络请求助手
 * @returns {Promise<object>} 执行结果
 */
async function executeCostTool(toolName, args, internalFetch) {
    switch (toolName) {
        case 'full_calculate': {
            const data = await postJson(internalFetch, '/api/cost/full-estimate', args, '完整成本估算失败');
            return { success: true, data };
        }

        case 'get_copper_price': {
            const data = await getJson(internalFetch, '/api/copper-price', '铜价读取失败');
            return { success: true, data };
        }

        case 'calculate_coil_cost': {
            let material = args.material || '';
            let slotType = args.slotType || '';
            if (!args.coilId && !args.schemeCode && (!material || !slotType)) {
                const targetDiameter = coilDiameter(args.spec);
                const targetSheets = Number(args.sheets || 0);
                const coils = await getJson(internalFetch, '/api/coils', '线圈记录读取失败');
                const candidates = (Array.isArray(coils) ? coils : []).filter(coil => (
                    (coil.schemeStatus || 'official') === 'official'
                    && coilDiameter(coil.spec, coil.diameterMm) === targetDiameter
                    && Number(coil.sheets || 0) === targetSheets
                    && (!material || (coil.material || '钢带') === material)
                    && (!slotType || (coil.slotType || '小眼') === slotType)
                ));
                if (candidates.length !== 1) {
                    return {
                        success: candidates.length > 0,
                        intent: 'coil_variant_choices',
                        summary: candidates.length > 0
                            ? `${args.spec}-${args.sheets} 找到 ${candidates.length} 套正式方案，必须按材质和槽眼分别标注。`
                            : `未找到 ${args.spec}-${args.sheets} 的正式线圈方案。`,
                        data: {
                            spec: String(args.spec || ''),
                            sheets: targetSheets,
                            requiresVariantSelection: candidates.length > 1,
                            variants: candidates.map(coilCandidateData),
                        },
                        ...(candidates.length > 0 ? {} : { error: `未找到 ${args.spec}-${args.sheets} 的正式线圈方案` }),
                    };
                }
                material = candidates[0].material || '钢带';
                slotType = candidates[0].slotType || '小眼';
            }
            const data = await postJson(internalFetch, '/api/coils/calculate', {
                spec: args.spec,
                coilId: args.coilId || null,
                schemeCode: args.schemeCode || '',
                schemeFamilyCode: args.schemeFamilyCode || '',
                sheets: args.sheets,
                material,
                slotType,
                wireWeight: args.wireWeight || null,
            }, '线圈成本计算失败');
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
                const preview = await postJson(
                    internalFetch,
                    '/api/rotor/draw-preview',
                    drawParams,
                    '出图预览失败'
                );
                if (Array.isArray(preview.warnings) && preview.warnings.length > 0) {
                    return {
                        success: false,
                        code: 'rotor_draw_preview_warning',
                        error: '正式出图预览包含安全警报，请调整参数后重新确认',
                        warnings: preview.warnings,
                    };
                }
                const result = await postJson(
                    internalFetch,
                    '/api/rotor/draw',
                    {
                        confirmationToken: preview.confirmationToken,
                        idempotencyKey: preview.suggestedIdempotencyKey,
                    },
                    '出图失败'
                );
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
                const preview = await postJson(
                    internalFetch,
                    `/api/rotor/print/${jobId}/preview`,
                    {},
                    '打印预览失败'
                );
                await postJson(
                    internalFetch,
                    `/api/rotor/print/${jobId}`,
                    {
                        confirmationToken: preview.confirmationToken,
                        idempotencyKey: preview.suggestedIdempotencyKey,
                    },
                    '打印失败'
                );
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

module.exports = { executeCostTool };
