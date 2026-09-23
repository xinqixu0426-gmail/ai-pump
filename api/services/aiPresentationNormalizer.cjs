'use strict';
/**
 * 面向用户的确定性展示规范化（AI Answer Presentation Remediation V1 — Part 2）。
 *
 * ── 它是什么 / 不是什么 ──────────────────────────────────────────────
 * 是「已验证内容的展示层规范化器」：只重排、压缩、把机器词汇换成业务语言。
 * **不是**第二套 answer engine：
 *   - 不做第二次模型调用；
 *   - 不新增/改动业务事实，不做实体解析，不调业务 API；
 *   - 不改任何金额数值，不重算成本；
 *   - 不改任务状态与确认/写入语义；
 *   - 不隐藏缺失、不完整、歧义、策略拒绝、需人工核对等等**决策相关**信息。
 *
 * ── 在流水线中的位置 ────────────────────────────────────────────────
 *   verified semantic answer
 *     -> Money Guard（循环内，负责金额安全与补全）
 *     -> …语义/影响/兼容边界（它们仍会改写正文）…
 *     -> **本层**（所有内容生成之后、对外发送之前）
 *     -> final user response
 * 放在最后是必要的：语义边界（`enforceSemanticAnswerBoundary`）与影响边界
 * （`enforceImpactAnswerBoundary`）运行在 Money Guard 之后，若本层放在它们之前，
 * 规范化结果会被覆盖。放在最后也保证不会与 Money Guard 形成循环处理。
 *
 * ── 幂等 ────────────────────────────────────────────────────────────
 * 要求 NORMALIZE(NORMALIZE(x)) == NORMALIZE(x)：机器词汇替换、清单摘要、
 * 收尾邀约清理都按「已规范化后的形态」判定，不会反复生效。
 */
const { getAiCapability } = require('../capabilities/registry.cjs');

// ── 机器词汇：工具显示名 → 业务对象名 ───────────────────────────────
// 一次有界、集中、可测试的映射。只用于**展示**，不改动 any 证据或回执。
// 键是 registry 里真实的 displayName（见 defect 记录
// LegacyAiMachineVocabularyInsteadOfBusinessLanguageDefectV1.json）。
const TOOL_LABEL_TO_BUSINESS = Object.freeze({
    '读取订单知识包': '订单',
    '读取订单详情': '订单',
    '读取最近订单': '订单',
    '生成 BOM 草稿': '配置成本',
    '配方成本试算': '配方成本',
    '配方当前成本': '配方成本',
    '对比配方': '配方对比',
    '成本对比': '配方对比',
    '解释成本差异': '成本差异',
    '读取配方列表': '配方',
    '读取配方明细': '配方',
    '按线圈反查配方': '配方',
    '按零件反查配方': '配方',
    '读取配方规范零件': '配方零件',
    '读取配方技术档案': '性能测试报告',
    '查询线圈库存': '线圈',
    '查询泵壳模板': '泵壳模板',
    '读取泵壳模板': '泵壳模板',
    '计算线圈成本': '线圈成本',
    '计算动态配置成本': '配置成本',
    '查询铜价': '铜价',
    '搜索零件': '零件',
    '读取线圈规格': '线圈规格',
    '查询客户历史': '客户历史',
    '查询客户': '客户',
    '查询报价': '报价',
    '读取报价详情': '报价',
    '生成报价草稿': '报价',
    '生成订单草稿': '订单',
    '读取经营摘要': '经营数据',
    '读取管理待办': '待办',
    '查询经营风险': '经营风险',
    '读取订单准备情况': '订单备料',
    '按线圈反查使用它的配方': '配方',
});

// ── 决策相关信息：出现这些就必须保留，压缩与收尾清理都不得吞掉 ──────
const DECISION_RELEVANT_RE = new RegExp([
    '缺(?:少|货|料)?', '待采购', '未(?:取得|完成|定价|知|确认|核实)', '无法', '不能',
    '不完整', '尚未', '歧义', '候选', '请(?:选择|确认|提供|告知)', '需要(?:你|您|人工)',
    '需人工', '不可用', '未找到', '不存在', '已核实', '警告', '风险', '异常', '冲突',
    '待确认', '待核对', '需复核', '建议(?:先|核)',
].join('|'), 'u');

// ── 内部 ID 展示 ────────────────────────────────────────────────────
// 只在**同一行/同一对象**上确有业务可读身份时隐藏；纯 ID 是唯一身份时保留
// （歧义场景），用户也可以显式要求列出。
const INTERNAL_ID_PATTERNS = Object.freeze([
    /(?:配方|模板|订单|报价|客户|零件|线圈|方案)(?:ID|Id|id)\s*[:：]?\s*[A-Za-z0-9_-]+/gu,
    /(?:ID|Id|id)\s*[:：]\s*[A-Za-z0-9_-]{2,}/gu,
]);

// 用户显式要求 ID / 原文精度 / 机器语言时，不隐藏。
const EXPLICIT_ID_REQUEST_RE = /(?:ID|Id|id)\s*(?:是多少|是几|多少|列出|列一下|给我|显示)|(?:把|将)?(?:内部)?(?:ID|编号|代号)(?:都)?(?:列|写|显示|给)/u;
const EXPLICIT_DETAIL_REQUEST_RE = /(?:全部|所有|完整|详细|逐项|逐个|每一|完整清单|列全部|都列)/u;
const EXPLICIT_RAW_REQUEST_RE = /(?:原始|原样|raw|不(?:要)?四舍五入|完整精度|源精度|不做格式化)/iu;
const EXPLICIT_DEBUG_REQUEST_RE = /(?:调试|debug|诊断|内部|工具名|执行轨迹|工具调用|原始回执|provenance)/iu;

/** 本轮的展示要求：全部来自用户已表达的结构化请求，不做关键词意图推断。 */
function presentationRequest(userText) {
    const text = String(userText || '');
    return Object.freeze({
        wantsIds: EXPLICIT_ID_REQUEST_RE.test(text),
        wantsDetail: EXPLICIT_DETAIL_REQUEST_RE.test(text),
        wantsRawPrecision: EXPLICIT_RAW_REQUEST_RE.test(text),
        wantsMachineLanguage: EXPLICIT_DEBUG_REQUEST_RE.test(text),
    });
}

/** 正文是否含决策相关信息（含则压缩与收尾清理必须保守）。 */
function hasDecisionRelevantContent(text) {
    return DECISION_RELEVANT_RE.test(String(text || ''));
}

/**
 * 把工具显示名换成业务对象名。
 * 只在**明确作为对象主体**的位置替换（表格「对象」列、以及 `X 的` 这类前缀），
 * 不做全文无差别替换，避免把正常句子改坏。
 */
function businessVocabulary(answer) {
    let text = String(answer || '');
    for (const [machine, business] of Object.entries(TOOL_LABEL_TO_BUSINESS)) {
        if (machine === business) continue;
        const escaped = machine.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        // 表格对象列：| 读取订单知识包 | …
        text = text.replace(new RegExp(`\\|\\s*${escaped}\\s*\\|`, 'gu'), `| ${business} |`);
        // 「读取订单知识包 的 …」/「读取订单知识包：…」这类把工具名当主体的写法
        text = text.replace(new RegExp(`${escaped}(?=\\s*(?:的|：|:|为|是))`, 'gu'), business);
        // 行首主体：「读取订单知识包 | 总成本 | …」
        text = text.replace(new RegExp(`^\\s*${escaped}\\s*\\|`, 'gmu'), `${business} |`);
    }
    return text;
}

/**
 * 隐藏内部 ID 代号。
 *
 * 判据是**「删掉之后每个候选是否仍然唯一可区分」**，不是「这一行还有没有中文」：
 *   - 用户明确要 ID / 调试模式 → 原样保留；
 *   - 一行里只有一个 ID 短语、且同行另有业务可读身份（型号/名称/规格）→ 隐藏 ID；
 *   - 一行里有 ≥2 个 ID 短语时，这些 ID 很可能就是候选的**唯一区分身份**：
 *     只有当**每个** ID 短语各自都带有一个属于自己的可读身份时才隐藏，
 *     否则整行 ID 全部保留（保守 —— 没有可靠替代身份就不得删除）。
 * 实例（A04b）：「请选择配方ID 12或配方ID 13。」两个候选只有 ID 可区分，
 * 旧实现因为「删除后还剩中文『请选择』」而把两个 ID 都删掉，句子变成「请选择或。」，
 * 用户彻底失去选择能力。
 */
const IDENTITY_TOKEN_RE = /[\u4e00-\u9fa5]{2,}|[A-Za-z]*\d+[-A-Za-z0-9]*/gu;

/** 文本里的可读身份片段（中文词组 / 型号式编码）。 */
function identityTokens(text) {
    return [...String(text ?? '').matchAll(IDENTITY_TOKEN_RE)].map(match => match[0]);
}

/** 一行里的全部内部 ID 短语，按出现位置排序。 */
function collectIdPhrases(line) {
    const phrases = [];
    for (const pattern of INTERNAL_ID_PATTERNS) {
        for (const match of String(line).matchAll(pattern)) phrases.push({ text: match[0], index: match.index });
    }
    return phrases.sort((left, right) => left.index - right.index);
}

function stripIdPhrases(line, phrases) {
    let text = '';
    let cursor = 0;
    for (const phrase of phrases) {
        text += line.slice(cursor, phrase.index) + ' ';
        cursor = phrase.index + phrase.text.length;
    }
    return text + line.slice(cursor);
}

/** 这一行的内部 ID 是否可以安全隐藏（每个候选都还剩唯一可读身份）。 */
function idsHideableOnLine(line) {
    const phrases = collectIdPhrases(line);
    if (!phrases.length) return false;
    if (phrases.length === 1) return identityTokens(stripIdPhrases(line, phrases)).length > 0;
    for (let index = 0; index < phrases.length; index += 1) {
        const start = phrases[index].index + phrases[index].text.length;
        const end = index + 1 < phrases.length ? phrases[index + 1].index : line.length;
        if (identityTokens(line.slice(start, end)).length === 0) return false;
    }
    return true;
}

function hideInternalIds(answer, request) {
    if (request.wantsIds || request.wantsMachineLanguage) return String(answer || '');
    const kept = [];
    let changed = false;
    for (const line of String(answer || '').split('\n')) {
        if (!idsHideableOnLine(line)) { kept.push(line); continue; }
        changed = true;
        kept.push(stripIdPhrases(line, collectIdPhrases(line)));
    }
    if (!changed) return String(answer || '');
    // 清理因删除产生的悬空分隔符
    return kept.join('\n')
        .replace(/[，,、]\s*(?=[，,、。；;])/gu, '')
        .replace(/([（(])\s*([）)])/gu, '')
        .replace(/[ \t]{2,}/gu, ' ');
}

/**
 * 收尾的延伸邀约清理。
 * 只删「用户问题已回答、且不需要用户补充」时的泛化邀约；
 * 真正需要用户动作的澄清（选择候选、补资料、确认型号）一律保留。
 */
const UNSOLICITED_INVITATION_RE = new RegExp([
    '我(?:可以|能)(?:继续|帮你|为你)',
    '如果(?:需要|想|您需要)',
    '需要(?:的话|时)(?:我|可以|再)',
    '要不要我',
    '告诉我(?:即可|就行)',
    '(?:还)?需要我(?:继续|再|帮)',
    '随时(?:告诉我|说)',
].join('|'), 'u');
// 必须保留的收尾（用户需要动作或事实缺失）。
const REQUIRED_ACTION_RE = new RegExp([
    '请(?:选择|确认|提供|告知|指定)', '需要(?:你|您)', '候选', '缺', '待', '未',
    '无法', '不能', '不确定', '歧义', '请核对', '请复核',
].join('|'), 'u');

// ── 表格里的内部 ID 列（缺陷 002 的未覆盖形态）──────────────────────
// 复现：问「查询V750配方当前名称」时回答带出 `| 配方ID | 名称 | 规格摘要 |`。
// 原先的 ID 规则只匹配「配方ID 12」这种**带值**形式，匹配不到**表头**，
// 于是内部 ID 作为一整列默认可见。实测规模（121 条助手消息）：ID 表头 5 条/3 会话。
const ID_TABLE_HEADER_RE = /^(?:.+)?(?:ID|Id|id|编号|代号)$/u;
// 行内 ID 指代**不在本函数处理范围**：由 hideInternalIds 按其既有保守规则负责。
// 这里只处理表格列，因此表头判定就是唯一需要的判据。
const ID_TABLE_ROW_RE = /^\s*\|.*\|\s*$/u;
const ID_TABLE_SEPARATOR_RE = /^\s*\|[\s:|-]+\|\s*$/u;

function splitMarkdownRow(line) {
    return line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|');
}

/**
 * 去掉表格里的内部 ID 列，并去掉行内 ID 指代。
 *
 * 为什么不是「有歧义就保留整列」：消歧依赖的是**名称与规格差异**（用户按名称或序号选择即可），
 * 内部 ID 不是决策依据。因此可以把「可读身份」全部保留、只移除内部代号，
 * 同时保证「缺少可读身份时 ID 必须保留」（那种情况下 ID 是唯一身份）。
 *
 * 用户显式要 ID / 要明细 / 调试模式时完全不生效（负向对照）。
 */
function hideInternalIdColumns(answer, request) {
    const text = String(answer || '');
    if (request.wantsIds || request.wantsMachineLanguage || request.wantsDetail) return text;
    const lines = text.split('\n');

    // 找出含 ID 表头的表格：header 行 + 分隔行 + 数据行
    const dropColumns = new Map();
    for (let i = 0; i < lines.length; i += 1) {
        if (!ID_TABLE_ROW_RE.test(lines[i]) || !ID_TABLE_SEPARATOR_RE.test(lines[i + 1] || '')) continue;
        const header = splitMarkdownRow(lines[i]).map(cell => cell.trim().replace(/[*_`]/gu, ''));
        const idColumn = header.findIndex(cell => ID_TABLE_HEADER_RE.test(cell));
        if (idColumn < 0) continue;
        // 计算该表的数据行范围
        const rows = [];
        for (let j = i + 2; j < lines.length && ID_TABLE_ROW_RE.test(lines[j]); j += 1) rows.push(j);
        // 保证「移除后每个候选仍然唯一可区分」：至少还有一个非 ID 表头列，
        // 且每行该列非空，并且**投影后没有两行变得完全相同**。
        // 后者是关键：`| 配方ID | 当前成本 |` 里两行的成本恰好都是 100 时，
        // 删掉 ID 只剩两行一模一样的「100」，用户再也无法区分这两个对象（A04a）。
        const otherColumns = header.map((_, index) => index).filter(index => index !== idColumn);
        if (otherColumns.length === 0) continue;
        const projectedRows = rows.map(index => {
            const cells = splitMarkdownRow(lines[index]);
            return otherColumns.map(column => String(cells[column] ?? '').trim());
        });
        const rowsKeepIdentity = projectedRows.every(cells => cells.some(cell => cell !== ''))
            && new Set(projectedRows.map(cells => cells.join('\u0000'))).size === projectedRows.length;
        if (!rowsKeepIdentity) continue;
        for (const index of [i, i + 1, ...rows]) dropColumns.set(index, idColumn);
    }

    const projected = lines.map((line, index) => {
        if (!dropColumns.has(index)) return line;
        const cells = splitMarkdownRow(line);
        cells.splice(dropColumns.get(index), 1);
        return `| ${cells.map(cell => cell.trim()).join(' | ')} |`;
    }).join('\n');

    // 重要边界：本函数**只处理表格列**。
    // 行内 ID 指代由 hideInternalIds 按其既有保守规则处理 —— 曾经在这里额外删过
    // 行内 ID，结果把「（泵壳模板 ID 3）」这种消歧必需的写法也删了，触发既有回归
    // （测试：a vague clarification about a model shorthand gets the verified cross-catalog
    //  candidates 要求保留该 ID）。行内 ID 只在「同行另有可读身份」时才由 hideInternalIds 处理，
    // 且它不覆盖 `模板 ID 3` 这种不寻常写法 —— 保留才是正确行为。
    return projected;
}

function trimUnsolicitedInvitations(answer, request) {
    const text = String(answer || '');
    if (request.wantsDetail || request.wantsMachineLanguage) return text;
    const blocks = text.split(/\n{2,}/);
    if (blocks.length < 2) return text;
    const last = blocks[blocks.length - 1];
    const match = UNSOLICITED_INVITATION_RE.exec(last);
    if (!match) return text;

    // 只删**邀约短语本身**，不删它所在的整句。
    // 实例（真实回归）：口径说明末句是
    //   「…要按在售配方为基准重新核算，包含泵壳、零件、人工、包装等；需要的话我按你指定的配方继续算。」
    // 整句删除会同时抹掉「按在售配方为基准重新核算」这条决策相关信息。
    // 因此这里做三件事：
    //   1. 若该句还含必须保留的内容 → 只裁掉邀约分句；
    //   2. 若裁掉后会出现悬空连接词（"；" / "，" 结尾）→ 一并整理；
    //   3. 若整块基本都是邀约 → 整块删除。
    const clauseStart = Math.max(
        last.lastIndexOf('；', match.index),
        last.lastIndexOf(';', match.index),
        last.lastIndexOf('。', match.index),
        last.lastIndexOf('！', match.index),
        last.lastIndexOf('？', match.index),
    ) + 1;
    const tail = last.slice(clauseStart);
    // 被删掉的比例过高（说明这块基本就是邀约）→ 整块移除。
    if (tail.trim().length >= last.trim().length * 0.6) {
        const head = blocks.slice(0, -1).join('\n\n').trim();
        return head || text;
    }
    const keptLast = last.slice(0, clauseStart).replace(/[；;，,、]\s*$/u, '。').trim();
    return [...blocks.slice(0, -1), keptLast].filter(Boolean).join('\n\n').trim();
}

/**
 * 长清单的**展示相关性契约**（Part 2-R1）。
 *
 * 之前用「固定最多 8 项」压缩：那等于把「前 8 项」当成 relevance ranking ——
 * 20 个库存项里第 11 项缺 300 个轴承会被隐藏，答案变短但更差。这里改为分层：
 *
 *   TIER 1 DECISION_CRITICAL —— 永远保留，即使最终条数超过展示容量
 *   TIER 2 DIRECT_SUPPORT    —— 支撑当前结论的项，保留
 *   TIER 3 NEUTRAL_DETAIL    —— 普通重复明细，**只有这一层**允许压缩
 *
 * 压缩 Tier 3 时：保持源顺序、明确标注只展示了部分、报出未展开条数，
 * 并且**不**声称这些是「最重要」的项 —— 8 只是展示容量，不是相关性排序。
 *
 * 分类只用已经核实的行文本语义（本层能看到的唯一结构化证据），不新增事实、
 * 不做业务推断、不调用模型。
 */
const LIST_TIER = Object.freeze({
    DECISION_CRITICAL: 'DECISION_CRITICAL',
    DIRECT_SUPPORT: 'DIRECT_SUPPORT',
    NEUTRAL_DETAIL: 'NEUTRAL_DETAIL',
});

// Tier 1（关键词启发式）：缺料、未定价、不完整、歧义、策略拒绝、失败/异常、需核对、明确差异。
// 注意「缺」必须能单独命中（真的缺料行常写作「缺 300 个…」而不是「缺货」）。
//
// 这是**过渡期兜底**，只在调用方没有提供结构化关键性输入时使用 —— 它靠措辞判断业务重要性，
// 同一个业务含义换个说法就会改变可见结果（A05：「还差300个」被判为中性而被隐藏）。
// 权威来源是 `buildListCriticality(toolResults)`（本轮正式结果里的结构化状态），由运行时接线；
// 不要为了追赶新问法在这里继续加词。
const TIER1_PATTERN = new RegExp([
    '缺', '短少', '欠', '待采购', '无货', '没货', '不足', '缺货',
    '未定价', '尚未定价', '未取得', '不完整', '未完成', '尚未',
    '无法', '不能', '失败', '错误', '异常', '冲突', '拒绝', '不支持',
    '歧义', '候选', '不一致', '不符合', '需(?:要)?(?:人工|复核|核对|确认)',
    '待确认', '待核对', '待复核', '警告', '风险', '不可用', '未找到', '不存在',
].join('|'), 'u');

// Tier 2：直接支撑结论的项（对比差异、正式合计/金额事实、被点名的对象）。
// 含对比句式：真实差异常写作「一个带浮球，一个不带」，不含「差异/不同」这类词。
const TIER2_PATTERN = new RegExp([
    '差(?:异|额|价|了)', '不同', '变化', '变动', '相(?:差|比)',
    '一个[^，。；]{0,20}，?一个', '有的[^，。；]{0,20}，?有的',
    '前者', '后者', '而另一个', '另一个则',
    '合计', '总计', '总额', '总成本', '小计',
    '¥', '￥', '元',
].join('|'), 'u');

/**
 * 给一行明细判定展示层级。
 *
 * 传入 `criticality`（结构化）时：
 *   1. 命中结构化 mustShow token → DECISION_CRITICAL（与措辞无关）；
 *   2. 命中结构化 support token → DIRECT_SUPPORT；
 *   3. **结构化 mustShow 为空**（本轮正式结果里没有出现缺料/未定价/未完成/待选择状态）时，
 *      不得据此推断「没有关键条目」—— 退回保守关键词兜底（PHASE D 修复：
 *      结构化来源为空时丢掉兜底会导致结论性行被隐藏，且会作出无法支持的保全声明）；
 *   4. 结构化 mustShow 非空且未命中 → NEUTRAL_DETAIL（此时关键词不再升级，避免措辞决定重要性）。
 *
 * @param {string} line 明细行
 * @param {{mustShowTokens?: string[], supportTokens?: string[]}|null} criticality
 */
function legacyListRowTier(text) {
    if (TIER1_PATTERN.test(text)) return LIST_TIER.DECISION_CRITICAL;
    if (TIER2_PATTERN.test(text)) return LIST_TIER.DIRECT_SUPPORT;
    return LIST_TIER.NEUTRAL_DETAIL;
}

function listRowTier(line, criticality = null) {
    const text = String(line ?? '');
    if (!criticality) return legacyListRowTier(text);
    const mustShow = Array.isArray(criticality.mustShowTokens) ? criticality.mustShowTokens.filter(Boolean) : [];
    const support = Array.isArray(criticality.supportTokens) ? criticality.supportTokens.filter(Boolean) : [];
    if (mustShow.some(token => text.includes(token))) return LIST_TIER.DECISION_CRITICAL;
    if (support.some(token => text.includes(token))) return LIST_TIER.DIRECT_SUPPORT;
    if (mustShow.length === 0) return legacyListRowTier(text);
    return LIST_TIER.NEUTRAL_DETAIL;
}

/**
 * 从本轮**已核验的工具结果**构造清单展示的关键性输入。
 *
 * E1-A：关键性投影已抽成正式契约 `api/services/criticalFactProjection.cjs`
 * （producer 字段全部来自真实 capability 输出）。本函数只做形状适配，
 * **不再**自带关键词词表 —— presentation 不得决定「什么算缺料/风险/必须展示」。
 *
 * @returns {{ mustShowTokens: string[], supportTokens: string[], facts: Array, producers: object, version: number }}
 */
function buildListCriticality(toolResults = []) {
    const projection = require('./criticalFactProjection.cjs').projectCriticalFacts(toolResults);
    return {
        version: projection.version,
        mustShowTokens: projection.mustShowTokens,
        rowTokens: projection.rowTokens,
        subjectTokens: projection.subjectTokens,
        supportTokens: projection.supportTokens,
        facts: projection.facts,
        producers: projection.producers,
        notAvailable: projection.notAvailable,
    };
}


const LIST_ROW_RE = /^\s*(?:[-*•]|\d+[.、)])\s+/u;

// 中性明细（Tier 3）的展示容量。它**只是展示容量**，不是相关性排序：
// Tier 1/2 条目不受它限制，最终可见条数可以超过这个值。
const NEUTRAL_DETAIL_LIMIT = 8;

/**
 * 长清单摘要（Part 2-R1 展示相关性契约 + A05 结构化关键性）。
 *
 * 分层来源：传了 `criticality`（结构化）就完全按结构化状态分层；
 * 没传则退回关键词启发式 —— 此时**不得**在结尾声明「结论性条目已全部保留」，
 * 因为那一条声明无法被结构化事实支持。
 */
function summarizeLongLists(answer, request, criticality = null) {
    const text = String(answer || '');
    if (request.wantsDetail || request.wantsMachineLanguage) return text;
    // 结构化模式下，结尾的保全声明必须是**可核对的**：
    // 逐个检查 mustShow token 是否真的出现在某一条清单行里。有未落地的关键对象时，
    // 报告事实，而不是照抄一句「已全部保留」。
    const mustShowTokens = criticality && Array.isArray(criticality.mustShowTokens) ? criticality.mustShowTokens.filter(Boolean) : [];
    // ROW token 必须在**清单行**里出现；SUBJECT token（处于关键状态的主体）只要求出现在回答中。
    const rowTokens = criticality && Array.isArray(criticality.rowTokens) ? criticality.rowTokens.filter(Boolean) : mustShowTokens;
    const subjectTokens = criticality && Array.isArray(criticality.subjectTokens) ? criticality.subjectTokens.filter(Boolean) : [];
    const listLines = text.split('\n').filter(line => LIST_ROW_RE.test(line));
    const unrepresentedCritical = rowTokens.filter(token => !listLines.some(line => line.includes(token)));
    const unrepresentedSubject = subjectTokens.filter(token => !text.includes(token));
    const criticalNote = !criticality
        ? '本轮没有结构化关键性依据，未展开项是否含结论性内容无法确认。'
        : mustShowTokens.length === 0
            // 结构化来源为空：本轮正式结果里**没有出现**缺料/未定价/未完成/待选择状态。
            // 这不能用来说明「没有关键条目」，因此保守兜底仍在生效，也不作保全声明。
            ? '本轮正式结果里没有出现结构化的缺料/未定价/未完成/待选择状态；结论性条目按既有保守规则保留，未展开项无法逐项确认。'
            : unrepresentedCritical.length === 0
                ? '本轮正式结果中处于缺料/未定价/未完成/待选择状态的条目已全部保留。'
                    + (unrepresentedSubject.length ? `另有 ${unrepresentedSubject.length} 个处于关键状态的正式对象没有出现在回答里。` : '')
                : `本轮正式结果中有 ${unrepresentedCritical.length} 个处于缺料/未定价/未完成/待选择状态的对象没有出现在清单里，需要完整清单请明确说明。`;
    const blocks = text.split(/\n{2,}/);
    let changed = false;
    const next = blocks.map(block => {
        const lines = block.split('\n');
        const listIndexes = lines.reduce((indexes, line, index) => {
            if (LIST_ROW_RE.test(line)) indexes.push(index);
            return indexes;
        }, []);
        if (listIndexes.length <= NEUTRAL_DETAIL_LIMIT) return block;

        // 分层：Tier 1/2 永远保留；只有 Tier 3（中性重复明细）参与压缩。
        const tierOf = new Map(listIndexes.map(index => [index, listRowTier(lines[index], criticality)]));
        const critical = listIndexes.filter(index => tierOf.get(index) !== LIST_TIER.NEUTRAL_DETAIL);
        const neutral = listIndexes.filter(index => tierOf.get(index) === LIST_TIER.NEUTRAL_DETAIL);
        const keptNeutral = new Set(neutral.slice(0, NEUTRAL_DETAIL_LIMIT));
        const omittedNeutral = neutral.length - keptNeutral.size;
        if (omittedNeutral <= 0) return block;

        changed = true;
        const keptIndexes = new Set([...critical, ...keptNeutral]);
        const rendered = lines.filter((line, index) => !LIST_ROW_RE.test(line) || keptIndexes.has(index));
        rendered.push(`（以上为部分明细：中性明细共 ${neutral.length} 项，已展示前 ${keptNeutral.size} 项，另有 ${omittedNeutral} 项未展开；`
            + `需要完整清单请明确说明。${criticalNote}）`);
        return rendered.join('\n');
    });
    return changed ? next.join('\n\n') : text;
}

/**
 * 结论先行。
 *
 * 正文以「机器形态」开头（内部金额表、工具名、原始执行痕迹）时，把首个
 * 业务结论段落提到最前；正文本身已是业务语言则不动 —— 不制造未经证据支持的结论。
 */
function conclusionFirst(answer, request) {
    const text = String(answer || '');
    if (request.wantsMachineLanguage) return text;
    const blocks = text.split(/\n{2,}/);
    if (blocks.length < 2) return text;
    const machineLead = block => (
        /^\s*\|/u.test(block)                                  // 表格开头
        || /^本轮正式查询金额如下/u.test(block.trim())            // 内部金额表标题
        || /^完整计算明细见/u.test(block.trim())
    );
    if (!machineLead(blocks[0])) return text;
    const businessIndex = blocks.findIndex((block, index) => index > 0
        && !machineLead(block)
        && /[\u4e00-\u9fa5]/u.test(block));
    if (businessIndex <= 0) return text;
    const reordered = [blocks[businessIndex], ...blocks.slice(0, businessIndex), ...blocks.slice(businessIndex + 1)];
    return reordered.join('\n\n');
}

/**
 * 展示规范化入口。
 *
 * @param {string} answer 已经过金额守卫与各语义边界的最终正文
 * @param {string} userText 本轮用户问题（只用于读取用户已表达的结构化展示要求）
 * @param {{criticality?: {mustShowTokens: string[], supportTokens: string[]}}} options
 *        本轮的结构化关键性输入（`buildListCriticality(toolResults)`）。传了就用结构化状态
 *        决定哪些明细必须展示；不传则退回关键词兜底且不声称已保全关键条目。
 * @returns {string}
 */
function normalizeAnswerPresentation(answer, userText = '', options = {}) {
    const text = String(answer || '');
    if (!text.trim()) return text;
    const request = presentationRequest(userText);
    // 调试/原文精度模式：机器语言与源精度按用户要求保留，只做无副作用的结构整理。
    if (request.wantsMachineLanguage) return text;
    const criticality = options.criticality || null;
    let out = text;
    out = businessVocabulary(out);
    out = hideInternalIds(out, request);
    out = hideInternalIdColumns(out, request);
    out = summarizeLongLists(out, request, criticality);
    out = trimUnsolicitedInvitations(out, request);
    out = conclusionFirst(out, request);
    return out;
}

module.exports = {
    TOOL_LABEL_TO_BUSINESS,
    DECISION_RELEVANT_RE,
    UNSOLICITED_INVITATION_RE,
    REQUIRED_ACTION_RE,
    INTERNAL_ID_PATTERNS,
    NEUTRAL_DETAIL_LIMIT,
    LIST_TIER,
    TIER1_PATTERN,
    TIER2_PATTERN,
    listRowTier,
    buildListCriticality,
    identityTokens,
    collectIdPhrases,
    idsHideableOnLine,
    presentationRequest,
    hasDecisionRelevantContent,
    businessVocabulary,
    hideInternalIds,
    hideInternalIdColumns,
    summarizeLongLists,
    trimUnsolicitedInvitations,
    conclusionFirst,
    normalizeAnswerPresentation,
    businessLabelForTool,
};

/** 工具名 → 业务标签（供其他展示路径复用同一张集中映射表）。 */
function businessLabelForTool(toolName) {
    const displayName = getAiCapability(toolName)?.displayName;
    if (!displayName) return null;
    return TOOL_LABEL_TO_BUSINESS[displayName] || displayName;
}
