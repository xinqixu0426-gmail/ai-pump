const express = require('express');
const router = express.Router();
const { AI_TOOLS, WRITE_TOOLS } = require('./tools.cjs');
const { getSystemPrompt } = require('./prompt.cjs');
const { executeToolCall } = require('./executor.cjs');
const { trimAiContext, prioritizeCurrentEvidence } = require('../../services/aiContext.cjs');
const { buildFreshLookupToolCalls } = require('../../services/aiFreshness.cjs');
const {
    aiProviderCapabilities,
    fetchAiProvider,
} = require('../../services/aiProvider.cjs');
const {
    normalizeAiPageContext,
    buildAiPageContextNote,
    resolveMessagesWithPageContext,
} = require('../../services/aiPageContext.cjs');
const authMiddleware = require('../../authMiddleware.cjs');

const AI_RUNTIME_RESPONSE_RULES = `

【运行时回答格式要求】
- 最终面向用户的回复必须使用 Markdown。
- 用短标题、项目符号、编号列表和加粗关键数字组织内容。
- 成本、报价、订单明细可用 Markdown 表格；不要输出 HTML。
- 不要只输出一整段纯文本。

【运行时业务路由要求】
- 价格、单价、成本、库存、订单状态、报价金额、铜价等会变化的系统数据，每次被询问时都必须重新调用合适的只读工具，以本轮工具结果为准；禁止直接复述历史会话里的数字。
- 用户明确要求查知识库时使用知识库工具；查询当前零件、配方、订单等实时业务字段时，优先使用对应业务工具。知识库与业务工具结果冲突时，应说明知识库可能尚未同步，并以业务系统当前值为准。
- 用户询问知识库是否正常、最近是否同步成功、同步为什么失败或是否需要手动同步时，必须使用 get_factory_knowledge_health。该工具只诊断，不执行同步；只有健康结果建议恢复且用户明确同意时，才调用需确认的 sync_factory_knowledge。
- 用户询问配方是否漏项、配置是否合理、固定件价格是否异常或有哪些相似配方时，必须使用 analyze_recipe_configuration。已批准工厂规则、确定性配置矛盾与同类配方复核建议必须分开描述；检查结果只读，不得自动修改。
- 用户询问某个订单能否生产、是否齐料、缺什么物料或生产准备情况时，必须使用 check_order_readiness。按工具 verdict 区分可生产、待补料、待复核、数据阻塞和不适用；已下单或已到货不等于已经入库，只有当前可用库存覆盖需求时才能回答可生产。该检查只读，不得自动确认订单、采购或调整库存。
- 用户询问全部或多个订单的生产准备总览、哪些订单不能生产、多少订单缺料时，必须使用 get_order_readiness_overview。先回答汇总数量，再按数据阻塞、待补料、待复核、可生产说明重点订单；不得用最近订单列表代替实时准备总览。
- 用户询问单个订单的客户要求、历史调整、执行异常、质量或交付追溯、来源文件，或要求汇总订单全部已知信息时，必须使用 get_order_knowledge_package。严格区分 data.order/readiness/actionPlan 的实时业务数据与 confirmedKnowledge 的人工确认事实；草稿已被排除，不得把 pendingDraftCount 或 hasPendingDraft 改写成草稿内容。来源不足时明确说系统未记录。
- 用户询问今天先做什么、当前最重要的管理待办、处理进展或工厂有哪些风险需要优先处理时，必须使用 get_management_action_center。先使用 progress 汇总最近自动归档、仍待处理、暂时受阻和反复出现的事项，再列最优先事项、建议动作和处理入口；有 lifecycle 时可说明持续时间和累计出现次数。当前系统是单人管理助理，不要求分配负责人。该工具只读，不得说成已经创建任务；只有 progress.resolvedItems 中的事项才能说已由后台复查后自动归档。
- 用户明确要求处理或执行今日队列中的某一项时，先重新使用 get_management_action_center 并匹配稳定事项 ID。resolution.mode=navigate/needs_input/monitor 时只能说明最短路径、所需判断或等待条件；只有 resolution.canAiConfirm=true 时，才继续调用 plan_order_readiness_actions 刷新订单方案，并使用该方案中仍为 available+confirmable 的精确步骤调用 execute_order_readiness_action 生成确认卡片。禁止直接执行或绕过确认。
- 用户在生产准备检查后询问问题怎么处理、下一步做什么或要求处理方案时，必须使用 plan_order_readiness_actions。按方案 sequence 和 dependsOn 说明先后关系；confirmable 只表示AI以后可以发起确认，不代表已经执行，manual/needs_input/monitor 必须如实区分。
- 用户明确要求执行订单处理方案中的某一步时，先读取本轮最新 plan_order_readiness_actions；只有该步骤 mode=confirmable 且 status=available 才能调用 execute_order_readiness_action，并使用精确 orderId/actionId。工具仍会暂停等待确认，确认时后端会再次重验；禁止执行 manual、needs_input、monitor 或 blocked 步骤。
- 用户明确要求确认、忽略、标记特殊情况或恢复某条检查提醒时，使用 set_recipe_analysis_feedback，并且只能使用最近一次检查结果中的精确 findingKey 和 findingType；反馈写入仍需确认。同类高频项反馈保存后会自动刷新候选规则，不要重复要求用户手动归纳。
- 候选业务规则至少需要两个配方确认相同高频项，同时使用特殊情况和忽略反馈计算置信度；反馈绑定生成时的泵壳模板和配方版本。反馈后更换模板标为范围漂移，修改配方标为内容过期，这些旧证据都不计入支持数，应建议按当前配方重新智能检查并确认。用户询问哪些学习反馈过期、哪些配方需要重新检查或学习证据是否健康时，使用 get_factory_learning_health；该工具覆盖尚未形成候选规则的反馈。只有置信度不低于65%才允许批准，低于门槛不得建议绕过，已批准规则跌破门槛会自动撤回批准并移除规则知识。读取使用 get_factory_rule_candidates；询问单条规则影响范围或批准前使用 get_factory_rule_impact；询问全部规则执行情况或不符合规则的配方时使用 get_factory_rule_compliance；询问规则变化原因、审核时间或最近变化时使用 get_factory_rule_history。归纳、批准和驳回分别使用 refresh_factory_rule_candidates、review_factory_rule_candidate；恢复历史审核状态必须先查询历史并使用真实 eventId 调用 restore_factory_rule_event。恢复只改变审核状态并保留当前证据，不得说成配方或证据回滚；所有规则写操作都要等待确认。候选规则未批准前不得当作正式规则；批准、驳回、失效、恢复和已批准规则证据变化会自动更新对应规则知识，无需再全量同步知识库。
- 知识条目 metadata.testReports 中的附件以及标记为 pump_performance_test 的 .xls/.xlsx 文件，必须称为“性能测试报告”或“测试报告”；禁止称为“图纸”“参考图纸”或“工程图”。只有转子出图工具返回的 PDF 才能称为图纸。
- AI 聊天中直接上传的 PDF 或图片只有 parserStatus=parsed 时才允许使用附件上下文中的按页 OCR/文字层内容；引用结论时标明页码或图片。OCR 技术参数候选必须保留来源位置和置信度，needsReview=true 的候选必须请用户核对，任何 OCR 候选都不得自动写入配方、报价或技术档案。parserStatus=metadata_only 且 ocrApplied=true 表示 OCR 未识别到可靠文字，不得推断图片中的尺寸、材料、结构或其他技术参数。
- 用户要求分析 Excel/CSV 报价附件时，必须使用附件上下文中的统一文件ID调用 inspect_quotation_file。先按工具结果列出客户匹配、每行配方、数量、文件单价和待确认项；不能仅凭模型阅读表格就声称匹配完成。只有 readyForSaveDraft=true 时才可继续调用 build_quotation_draft 生成标准报价保存草稿；两者都不写数据库，不得说成已创建报价。
- 报价文件中的金额和单价是客户文件内容，不是系统成本事实。正式报价草稿必须继续由 /api/quotations/save-payload-draft 依据当前配方重新试算成本；客户、配方未找到或匹配多个候选时必须停止并请用户确认，不得自动新增或猜选。
- 用户明确要求把聊天附件保存、归档或关联到业务资料时，使用附件上下文中的精确 fileId。归档到客户、报价、订单、配方或质量问题前，必须先调用 search_factory_file_archive_targets 核对真实目标；多条候选时先让用户选择，禁止猜 targetId。归档到知识库使用 targetType=knowledge_document，不传 targetId，并明确资料类型、标题和必要标签。只有用户明确要求归档时才调用 archive_factory_file，且必须等待确认卡片；分析或读取附件不等于归档。OCR 技术参数候选即使随文件归档也仍是候选，不得变成已确认业务事实。
- 归纳订单客户要求时，严格区分客户明确要求、未提供项、原文冲突和工厂建议；型号匹配、配方选择和经验推荐不得写成客户明确要求。先展示结果，只有用户明确要求保存草稿时才调用 save_order_requirement_draft，并使用真实 orderId 与附件上下文中的精确 fileId，等待确认卡片。该工具仅保存可编辑草稿，不代表进入知识库，也不修改订单明细、配方、采购或库存；知识确认和撤销只能由用户在订单页面操作。
- 记录订单执行档案时，只记录用户明确陈述的实际准备、人工决定、过程调整、异常、质量结果和交付结果；建议、预测和待办不得写成已发生事实。先展示整理结果，只有用户明确要求保存时才调用 save_order_execution_draft，等待确认卡片。该工具只新建草稿，不确认知识，不修改订单状态、配方、采购或库存；正式确认和撤销只能由用户在订单页面操作。
- 独立工厂资料 metadata.parserStatus=metadata_only 表示知识条目仍只保存并检索标题、说明、标签和文件信息。回答时可以说明该资料存在并提供下载来源，但不得推断 PDF 图纸中的正文参数。
- 性能测试报告模板中的“规定点、实测点、偏差”不作为有效技术结论，不得引用、展示或据此判断是否达标；最终回答中也不要出现这三个模板字段名，即使是为了说明忽略它们。回答性能问题时只使用逐条“测试点”的流量、扬程、电流、效率等实际曲线数据；报告没有可靠额定参数时只说“未提供可靠额定参数”，不能把某个点标成额定值或实测结论。
- 知识工具返回的 sources 是本轮回答的可追溯依据。只能引用实际使用过的来源，不得编造知识 ID、标题或链接；sources 中 freshness 不是 fresh 时，正文必须提示该知识待同步，涉及易变数据时改查实时业务工具。
- 知识搜索结果的 evidenceLevel=semantic_candidate 或 matchMode=vector 只表示语义相近的候选，不是用途、兼容性、组成关系或“专用配件”的事实证据。只有条目的标题、摘要、正文或结构化 metadata 明确写出相同用途/关系时，才能回答“适合”“专用”“自带”“配套”；不得根据向量名次、相似名称、叶片数量或普通螺丝等通用 BOM 自行推断。明确文本命中与纯语义候选冲突时采用明确文本；数据库没有明确标注的专用配件时，应回答“系统未记录/无法确认”，禁止把普通配件改称为专用配件。不得为了补充对比而把其他纯语义候选归类为“不适合、没有此功能或属于某用途”，除非来源也明确写出该排除结论。
- 用户询问产品用途、专用配件或名称可能存在歧义时，应同时检索 business_rule 并以明确业务规则消歧。切割场景中，800平刀切割泵壳是系统明确标注的选择；SPA 是清水泵壳，没有切割刀片；“切边6mm长螺丝”是外六角螺丝，不是刀片；“v800平刀-不配刀”不能作为带刀的完整切割方案。来源没有明确写明是否随泵壳附带刀片时，不得自行回答“全套含刀”。
- 用户只问适用型号或“哪一个”时，先直接回答已确认型号；不要主动补充来源未明确的内部组成、是否附带配件、性能强弱或使用范围。特别是“800平刀切割泵壳”只能确认切割用途，不能据名称推断随泵壳配有、自带或包含切割刀片。
- 工具结果 provenance.kind 为 live_business 时，说明数据来自本轮实时业务查询；为 knowledge_snapshot 时，说明数据来自最近一次知识库同步快照。两者冲突时以 live_business 为准。
- 用户提到机筒长度、机筒高度、桶长或 180mm/170mm 这类长度，并询问泵壳本体成本时，必须使用 preview_pump_shell_cost；不要使用 query_recipe_cost_by_name 返回默认配方成本。
- 用户询问整个配方、报价或订单在某个机筒长度下的总成本时，使用 preview_recipe_cost，并把长度放入 customBarrelLength 或 overrides.customBarrelLength。
- 未提供泵壳型号时先追问型号；不要默认猜 V750 或任何模板。
- 用户询问“12-220”这类线圈数据时，必须列出该规格片数下所有正式材质+槽眼方案；未指定材质或槽眼时禁止默认选择钢带小眼。
- 线圈知识中的“默认搭配电缆线径”是成品电缆搭配参数，不是主线/副线漆包线线径；回答时必须按字段原义标注。
- 查询客户报价时，按工具返回的 displaySequence 展示为“第1份、第2份”；不得把数据库 id 写成“报价单 #3”这类面向用户的顺序编号。
- 配方中的线材、长度、插头和规格共同组成一个“成品电缆”业务项。成本可以解释为线材长度成本与插头/规格成本共同构成，但不得拆成两个配件或两个独立收费项目。
`;

function buildSystemPrompt(extra = '') {
    return `${getSystemPrompt()}${AI_RUNTIME_RESPONSE_RULES}${extra || ''}`;
}

function confirmAuth(req, res, next) {
    if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) {
        return next();
    }
    return authMiddleware(req, res, next);
}

function buildPendingWriteReply(toolResults) {
    const pending = toolResults.find(item => item?.result?.requiresConfirmation && item.result.confirmation);
    if (!pending) return '';
    const replies = {
        create_part: '好的，我来帮你新增这个零件，请核对下面的确认卡片。',
        update_part: '好的，我来帮你修改这个零件，请核对下面的确认卡片。',
        delete_part: '好的，我来帮你删除这个零件，请核对下面的确认卡片。',
        create_order: '好的，我来帮你新建这个订单，请核对下面的确认卡片。',
        update_order_status: '好的，我来帮你修改订单状态，请核对下面的确认卡片。',
        execute_order_readiness_action: '处理步骤当前可以执行，请核对下面的确认卡片。',
        create_recipe: '好的，我来帮你新建这个配方，请核对下面的确认卡片。',
        update_recipe: '好的，我来帮你修改这个配方，请核对下面的确认卡片。',
        delete_recipe: '好的，我来帮你删除这个配方，请核对下面的确认卡片。',
    };
    if (replies[pending.name]) return replies[pending.name];
    const title = pending.result.confirmation.title || '这个操作';
    return `好的，我来帮你处理「${title}」，请核对下面的确认卡片。`;
}

function hasPendingWriteConfirmation(toolResults) {
    return (toolResults || []).some(item => item?.result?.requiresConfirmation && item.result.confirmation);
}

const TOOL_PLAN_LABELS = {
    query_recipe_cost_by_name: '查询配方成本',
    query_recipe_cost_by_id: '查询配方成本',
    full_calculate: '完整成本估算',
    get_copper_price: '查询铜价',
    calculate_coil_cost: '计算线圈成本',
    get_coil_specs: '读取线圈规格',
    get_all_recipes: '读取配方列表',
    get_all_parts: '读取零件列表',
    dynamic_config_cost: '计算动态配置成本',
    get_recent_orders: '读取最近订单',
    create_part: '新建零件',
    create_order: '新建订单',
    add_recipe_to_order: '订单追加产品',
    update_part: '修改零件',
    get_order_detail: '读取订单详情',
    get_order_knowledge_package: '读取订单知识包',
    get_management_action_center: '读取管理待办',
    get_order_readiness_overview: '读取订单准备总览',
    check_order_readiness: '检查订单生产准备',
    plan_order_readiness_actions: '生成订单处理方案',
    execute_order_readiness_action: '执行订单处理步骤',
    update_order_status: '修改订单状态',
    remove_recipe_from_order: '订单移除产品',
    update_order_item: '修改订单产品',
    generate_purchase_list: '生成采购清单',
    delete_order: '删除订单',
    create_recipe: '新建配方',
    delete_recipe: '删除配方',
    update_recipe: '修改配方',
    search_factory_file_archive_targets: '查找文件归档目标',
    archive_factory_file: '归档工厂文件',
    build_recipe_bom_draft: '生成 BOM 草稿',
    preview_recipe_cost: '配方成本试算',
    preview_pump_shell_cost: '泵壳成本试算',
    inspect_quotation_file: '识别报价文件',
    build_quotation_draft: '生成报价草稿',
    build_order_draft: '生成订单草稿',
    search_customer_history: '查询客户历史',
    explain_cost_change: '解释成本差异',
    get_data_quality_summary: '读取数据质量',
    analyze_recipe_configuration: '智能检查配方',
    set_recipe_analysis_feedback: '保存配方检查反馈',
    get_factory_learning_health: '检查学习证据健康状态',
    get_factory_rule_candidates: '读取候选业务规则',
    get_factory_rule_impact: '分析规则影响范围',
    get_factory_rule_compliance: '检查规则执行情况',
    get_factory_rule_history: '读取规则变更记录',
    restore_factory_rule_event: '恢复规则审核状态',
    refresh_factory_rule_candidates: '归纳候选业务规则',
    review_factory_rule_candidate: '审核候选业务规则',
    get_business_alerts: '读取经营异常',
    search_factory_knowledge: '搜索工厂知识库',
    get_factory_knowledge_detail: '读取知识详情',
    get_factory_knowledge_health: '检查知识库健康状态',
    sync_factory_knowledge: '同步工厂知识库',
    compare_recipes: '对比配方',
    search_parts: '搜索零件',
    delete_part: '删除零件',
    batch_update_prices: '批量调价',
    get_dashboard_summary: '读取运营看板',
    generate_rotor_drawing: '生成转子图纸',
    print_rotor_drawing: '打印转子图纸',
    get_rotor_drawing_history: '读取出图历史',
};

function compactValue(value) {
    if (value === undefined || value === null || value === '') return '';
    if (Array.isArray(value)) return `共 ${value.length} 项`;
    if (typeof value === 'object') return '已提供';
    return String(value);
}

function summarizeArgs(args = {}) {
    return Object.entries(args || {})
        .map(([key, value]) => ({ key, value: compactValue(value) }))
        .filter(item => item.value)
        .slice(0, 6);
}

function buildToolPlan(toolCalls = []) {
    const steps = toolCalls.map((tc, index) => {
        const name = tc.function?.name || '';
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
        const write = WRITE_TOOLS.has(name);
        return {
            index: index + 1,
            name,
            label: TOOL_PLAN_LABELS[name] || name,
            mode: write ? 'write' : 'read',
            requiresConfirmation: write,
            argsSummary: summarizeArgs(args),
        };
    });
    const writeCount = steps.filter(step => step.mode === 'write').length;
    return {
        steps,
        summary: writeCount > 0
            ? `准备执行 ${steps.length} 个步骤，其中 ${writeCount} 个写操作需要确认。`
            : `准备执行 ${steps.length} 个只读/试算步骤。`,
    };
}

router.get('/api/ai/capabilities', confirmAuth, (req, res) => {
    try {
        res.json({ success: true, data: aiProviderCapabilities() });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ── AI Chat SSE 端点 ──
router.post('/api/ai/chat', confirmAuth, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (type, payload) => {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
        if (typeof res.flush === 'function') res.flush(); // 强制刷新，防止 compression 中间件缓冲
    };

    try {
        const messages = trimAiContext(req.body?.messages);
        const pageContext = normalizeAiPageContext(req.body?.pageContext);
        const routingMessages = resolveMessagesWithPageContext(messages, pageContext);
        const pageContextNote = buildAiPageContextNote(pageContext);
        send('status', { status: 'thinking', message: '正在理解您的问题...' });

        let currentMessages = [
            { role: 'system', content: `${buildSystemPrompt()}${pageContextNote ? `\n\n${pageContextNote}` : ''}` },
            ...messages
        ];

        let maxRounds = 5;
        let done = false;
        let allToolResults = [];
        let evidenceContextPrioritized = false;
        let lastProviderNotice = '';
        const announceProvider = (providerInfo) => {
            const key = [
                providerInfo.provider,
                providerInfo.model,
                providerInfo.fallback ? 'fallback' : 'primary',
            ].join(':');
            if (key === lastProviderNotice) return;
            lastProviderNotice = key;
            send('provider', providerInfo);
        };
        const prioritizeEvidence = () => {
            if (evidenceContextPrioritized) return;
            currentMessages = prioritizeCurrentEvidence(currentMessages, messages.length);
            currentMessages[0].content += '\n\n【本轮证据优先】已经获得本轮工具结果。历史 assistant 回答仅是旧回复，不是事实来源，不得用于补充、反转或解释本轮工具证据。最终结论只能来自本轮工具结果和明确业务规则。';
            evidenceContextPrioritized = true;
        };

        const freshLookupCalls = buildFreshLookupToolCalls(routingMessages);
        if (freshLookupCalls.length > 0) {
            send('tool_plan', {
                ...buildToolPlan(freshLookupCalls.map((call, index) => ({
                    id: `fresh_lookup_${index}`,
                    type: 'function',
                    function: { name: call.name, arguments: JSON.stringify(call.args) },
                }))),
                summary: `正在刷新 ${freshLookupCalls.length} 项易变业务数据。`,
            });

            for (const call of freshLookupCalls) {
                send('tool_call', call);
                const result = await executeToolCall(call.name, call.args, { allowWrite: false });
                send('tool_result', { name: call.name, result });
                allToolResults.push({ name: call.name, result });
            }
            currentMessages[0].content += `\n\n【本轮服务端已刷新数据】\n${JSON.stringify(allToolResults)}\n必须以这些本轮查询结果为准，不得复述历史数字。`;
            prioritizeEvidence();
            send('status', { status: 'analyzing', message: '已刷新当前数据，正在分析...' });
        }

        while (!done && maxRounds-- > 0) {
            let aiRes;
            try {
                aiRes = await fetchAiProvider(currentMessages, {
                    tools: AI_TOOLS,
                    stream: true,
                    onProvider: announceProvider,
                });
            } catch (err) {
                send('error', { message: err.message });
                return res.end();
            }

            let msgContent = '';
            let toolCallsMap = {};
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            const reader = aiRes.body.getReader();
            while (true) {
                const { done: streamDone, value } = await reader.read();
                if (streamDone) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (let line of lines) {
                    line = line.trim();
                    if (!line || !line.startsWith('data: ')) continue;
                    
                    const jsonStr = line.substring(6).trim();
                    if (jsonStr === '[DONE]') continue;
                    
                    try {
                        const data = JSON.parse(jsonStr);
                        const delta = data.choices[0].delta;
                        
                        if (delta.content) {
                            msgContent += delta.content;
                            send('content', { content: delta.content });
                        }
                        
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                if (!toolCallsMap[tc.index]) {
                                    toolCallsMap[tc.index] = {
                                        id: tc.id || '',
                                        type: tc.type || 'function',
                                        function: {
                                            name: tc.function?.name || '',
                                            arguments: tc.function?.arguments || ''
                                        }
                                    };
                                } else {
                                    if (tc.id) toolCallsMap[tc.index].id += tc.id;
                                    if (tc.function?.name) toolCallsMap[tc.index].function.name += tc.function.name;
                                    if (tc.function?.arguments) toolCallsMap[tc.index].function.arguments += tc.function.arguments;
                                }
                            }
                        }
                    } catch(e) {
                        // ignore parse errors for partial chunks
                    }
                }
            }
            
            // 冲刷 decoder
            buffer += decoder.decode();

            const toolCallsArr = Object.values(toolCallsMap);
            currentMessages.push({
                role: 'assistant',
                content: msgContent || "",
                tool_calls: toolCallsArr.length > 0 ? toolCallsArr : undefined
            });

            if (toolCallsArr.length > 0) {
                send('tool_plan', buildToolPlan(toolCallsArr));
                for (const tc of toolCallsArr) {
                    const funcName = tc.function.name;
                    send('status', { status: 'calling', message: `正在调用: ${funcName}...` });

                    let args = {};
                    try { args = JSON.parse(tc.function.arguments); } catch (e) { /* ignore */ }

                    send('tool_call', { name: funcName, args });
                    const result = await executeToolCall(funcName, args, { allowWrite: false });
                    send('tool_result', { name: funcName, result });
                    send('status', {
                        status: hasPendingWriteConfirmation([{ name: funcName, result }]) ? 'confirming' : 'analyzing',
                        message: hasPendingWriteConfirmation([{ name: funcName, result }])
                            ? '等待确认后执行写操作'
                            : `已完成 ${funcName}，正在继续分析...`
                    });
                    
                    allToolResults.push({ name: funcName, result });

                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        name: funcName,
                        content: JSON.stringify(result)
                    });
                }
                prioritizeEvidence();

                if (hasPendingWriteConfirmation(allToolResults)) {
                    const directReply = buildPendingWriteReply(allToolResults);
                    if (!msgContent.trim()) {
                        send('content', { content: directReply });
                    }
                    send('detail', {
                        detailType: allToolResults.length === 1 ? allToolResults[0].name : 'multi_tool',
                        toolResults: allToolResults
                    });
                    send('done', {});
                    done = true;
                } else {
                    send('status', { status: 'thinking', message: '正在根据工具结果继续推理...' });
                }
            } else {
                if (allToolResults.length > 0) {
                    send('detail', {
                        detailType: allToolResults.length === 1 ? allToolResults[0].name : 'multi_tool',
                        toolResults: allToolResults
                    });
                }

                send('done', {});
                done = true;
            }
        }

        if (!done) {
            send('error', { message: '工具调用轮次超限' });
        }
        res.end();
    } catch (err) {
        send('error', { message: err.message });
        res.end();
    }
});

router.post('/api/ai/confirm-tool', confirmAuth, async (req, res) => {
    try {
        const { toolName, args } = req.body || {};
        if (!toolName) {
            return res.status(400).json({ success: false, error: '缺少 toolName' });
        }

        const result = await executeToolCall(toolName, args || {}, { allowWrite: true });
        res.json({ success: true, data: { name: toolName, result } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});



/**
 * 通用 AI 对话处理函数
 */
async function processAiChat(text, options = {}) {
    const { context = [], promptSuffix = '', allowWrite = false, pageContext: rawPageContext = null } = options;
    const toolResults = [];

    const messages = trimAiContext([
        ...(Array.isArray(context) ? context : []),
        { role: 'user', content: text },
    ]);

    const pageContext = normalizeAiPageContext(rawPageContext);
    const routingMessages = resolveMessagesWithPageContext(messages, pageContext);
    const pageContextNote = buildAiPageContextNote(pageContext);

    let currentMessages = [
        { role: 'system', content: `${buildSystemPrompt(promptSuffix)}${pageContextNote ? `\n\n${pageContextNote}` : ''}` },
        ...messages
    ];

    let maxRounds = 5;
    let done = false;
    let finalContent = '';
    let evidenceContextPrioritized = false;
    const prioritizeEvidence = () => {
        if (evidenceContextPrioritized) return;
        currentMessages = prioritizeCurrentEvidence(currentMessages, messages.length);
        currentMessages[0].content += '\n\n【本轮证据优先】已经获得本轮工具结果。历史 assistant 回答仅是旧回复，不是事实来源，不得用于补充、反转或解释本轮工具证据。最终结论只能来自本轮工具结果和明确业务规则。';
        evidenceContextPrioritized = true;
    };

    const VIEW_TYPE_MAP = {
        get_order_detail: 'order_detail',
        get_order_knowledge_package: 'order_knowledge_package',
        generate_purchase_list: 'purchase_list',
        get_management_action_center: 'management_action_center',
        get_order_readiness_overview: 'order_readiness_overview',
        check_order_readiness: 'order_readiness',
        plan_order_readiness_actions: 'order_readiness_plan',
        execute_order_readiness_action: 'order_readiness_action',
    };

    for (const call of buildFreshLookupToolCalls(routingMessages)) {
        const result = await executeToolCall(call.name, call.args, { allowWrite: false });
        toolResults.push({ name: call.name, view_type: VIEW_TYPE_MAP[call.name] || 'action_result', result });
    }
    if (toolResults.length > 0) {
        currentMessages[0].content += `\n\n【本轮服务端已刷新数据】\n${JSON.stringify(toolResults)}\n必须以这些本轮查询结果为准，不得复述历史数字。`;
        prioritizeEvidence();
    }

    while (!done && maxRounds-- > 0) {
        const aiRes = await fetchAiProvider(currentMessages, {
            tools: AI_TOOLS,
            stream: false,
        });

        const data = await aiRes.json();
        if (data.error) {
            throw new Error(data.error.message || 'API 错误');
        }

        const msg = data.choices[0].message;
        currentMessages.push({
            role: 'assistant',
            content: msg.content || "",
            tool_calls: msg.tool_calls
        });

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
                const funcName = tc.function.name;
                console.log(`[AI] 调用工具: ${funcName}`);

                let args = {};
                try { args = JSON.parse(tc.function.arguments); } catch (e) { }

                const result = await executeToolCall(funcName, args, { allowWrite });
                const viewType = VIEW_TYPE_MAP[funcName] || 'action_result';

                toolResults.push({ name: funcName, view_type: viewType, result });

                currentMessages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    name: funcName,
                    content: JSON.stringify(result)
                });
            }
            prioritizeEvidence();
        } else {
            finalContent = msg.content || '';
            done = true;
        }
    }

    // 提取 speech：取 AI 回复的第一句话（句号或换行前）
    const speech = finalContent
        .split(/[。\n]/)[0]
        .replace(/[*#`\-]/g, '')
        .trim() || finalContent.slice(0, 100);

    return { finalContent, toolResults, speech };
}



module.exports = { router, processAiChat };
