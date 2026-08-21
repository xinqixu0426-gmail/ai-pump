function loadDbAccessors() {
    return require('../db.cjs');
}

function normalizeOwnerKey(value) {
    return String(value || 'admin').trim().slice(0, 80) || 'admin';
}

function positiveId(value, label) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`${label}不合法`);
    return id;
}

function parseJson(value, fallback) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function normalizeText(value, maxLength, label) {
    const text = String(value || '').trim();
    if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
    return text;
}

function caseView(row, adapter) {
    const item = adapter(row);
    return { ...item, config: parseJson(item.configJson, {}) };
}

function resultView(row, adapter) {
    const item = adapter(row);
    return {
        ...item,
        toolResults: parseJson(item.toolResultsJson, []),
        sources: parseJson(item.sourcesJson, []),
        checks: parseJson(item.checksJson, []),
    };
}

function collectEvidence(toolResults) {
    const sources = [];
    const provenance = [];
    const seenSources = new Set();
    for (const tool of toolResults) {
        const result = tool?.result && typeof tool.result === 'object' ? tool.result : {};
        if (result.provenance?.kind) provenance.push(result.provenance);
        for (const source of Array.isArray(result.sources) ? result.sources : []) {
            const key = `${source.knowledgeEntryId || ''}\u0000${source.sourceTable || ''}\u0000${source.sourceId || ''}`;
            if (seenSources.has(key)) continue;
            seenSources.add(key);
            sources.push({
                knowledgeEntryId: Number(source.knowledgeEntryId) || null,
                title: String(source.title || '').slice(0, 200),
                entryType: String(source.entryType || '').slice(0, 60),
                sourceTable: String(source.sourceTable || '').slice(0, 80),
                sourceId: String(source.sourceId || '').slice(0, 120),
                freshness: String(source.freshness || '').slice(0, 40),
                knowledgePath: String(source.knowledgePath || '').slice(0, 300),
                sourcePath: String(source.sourcePath || '').slice(0, 300),
            });
        }
    }
    return { sources: sources.slice(0, 30), provenance };
}

function addCheck(checks, key, label, passed, detail) {
    checks.push({ key, label, passed: Boolean(passed), detail: String(detail || '') });
}

function containsAny(answer, terms) {
    const normalized = normalizeAnswerForChecks(answer);
    return terms.some(term => normalized.includes(normalizeAnswerForChecks(term)));
}

function containsMissingCustomerConclusion(answer, configuredTerms) {
    if (containsAny(answer, configuredTerms)) return true;
    return normalizeAnswerForChecks(answer)
        .split(/[。！？\n]/)
        .some(sentence => (
            sentence.includes('客户')
            && /(?:未找到|没有找到|未查询到|没有查询到|未匹配到|没有匹配到|查无|不存在|未记录)/.test(sentence)
            && !/(?:可能|也许|或许|不确定|是否)/.test(sentence)
        ));
}

function containsZeroQuotationConclusion(answer) {
    return normalizeAnswerForChecks(answer)
        .split(/[。！？\n]/)
        .some(sentence => (
            /(?:没有|无|暂无|未找到|未查询到)(?:任何)?(?:历史)?报价(?:记录)?/.test(sentence)
            || /报价(?:记录)?(?:为)?空/.test(sentence)
        ));
}

function normalizeAnswerForChecks(value) {
    return String(value || '')
        .replace(/[*_`~]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\s+/g, '');
}

function containsForbiddenAssertion(answer, termValue) {
    answer = normalizeAnswerForChecks(answer);
    const term = String(termValue);
    let index = answer.indexOf(term);
    while (index >= 0) {
        const sentenceStart = Math.max(
            answer.lastIndexOf('。', index - 1),
            answer.lastIndexOf('！', index - 1),
            answer.lastIndexOf('？', index - 1),
            answer.lastIndexOf('\n', index - 1)
        ) + 1;
        const prefix = answer.slice(sentenceStart, index);
        const negation = /(?:不是|并非|不属于|不应(?:该)?|不能|不会|不可|不得|不宜|请勿(?:推断|称为|视为|认定为)?|不得(?:推断|称为|视为|认定为)?|无法(?:确认|回答|断定)|不能(?:确认|回答|断定)|未(?:明确)?记录|没有(?:明确)?记录)([^。！？\n]{0,24})$/.exec(prefix);
        const reversedByPivot = negation
            && /(?:而是|却是|实际(?:上)?是|反而是|应是|属于)/.test(negation[1]);
        if (!negation || reversedByPivot) return true;
        index = answer.indexOf(term, index + term.length);
    }
    return false;
}

function numberPattern(value) {
    const escaped = String(Number(value)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\d.])${escaped}(?:\\.0+)?([^\\d.]|$)`);
}

function containsUnavailableConclusion(answer, configuredTerms = []) {
    if (containsAny(answer, configuredTerms)) return true;
    const normalized = normalizeAnswerForChecks(answer);
    return (
        /(?:未|没有|无|暂无).{0,48}(?:找到|查询到|查到|登记|记录|建立|建档|正式方案|匹配)/.test(normalized)
        || /(?:尚未|还未|没有|暂无).{0,24}(?:归档|上传|建立档案)/.test(normalized)
        || /(?:返回(?:数量)?|记录数|结果|命中数|方案数).{0,12}(?:为|是|共)?0(?:条|个|份|项|套|种)?/.test(normalized)
    );
}

function normalizeTargetText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase('zh-CN')
        .replace(/(\d)\s*(?:英寸|inches|inch|[″”"])/g, '$1in')
        .replace(/[\s“'`]+/g, '');
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function profileAnswerMarker(answer, profile, profiles) {
    const text = String(answer || '');
    const material = String(profile?.material || '').trim();
    const slotType = String(profile?.slot_type || '').trim();
    if (!material || !slotType) return -1;
    const identityTerms = [...new Set(profiles.flatMap(item => [
        String(item?.material || '').trim(),
        String(item?.slot_type || '').trim(),
    ]).filter(Boolean))];
    const blockedIdentity = identityTerms.map(escapeRegExp).join('|');
    const bridge = `(?:(?!(?:${blockedIdentity}))[^。！？\\n]){0,24}`;
    const pattern = new RegExp(
        `(?:${escapeRegExp(material)}${bridge}${escapeRegExp(slotType)}`
        + `|${escapeRegExp(slotType)}${bridge}${escapeRegExp(material)})`
    );
    return text.search(pattern);
}

function profileAnswerSegments(answer, profiles) {
    const text = String(answer || '');
    const markers = profiles.map(profile => ({
        profile,
        start: profileAnswerMarker(text, profile, profiles),
    }));
    return new Map(markers.map(({ profile, start }) => {
        const startIsUnique = start >= 0
            && markers.filter(item => item.start === start).length === 1;
        const nextStart = markers
            .map(item => item.start)
            .filter(candidate => candidate > start)
            .sort((left, right) => left - right)[0];
        return [
            Number(profile.id),
            !startIsUnique ? '' : text.slice(start, nextStart ?? text.length),
        ];
    }));
}

function verifiedRecipeReportObservation(config, prerequisite, toolResults = []) {
    const requiredTools = new Set(
        (Array.isArray(config?.requiredTools) && config.requiredTools.length > 0
            ? config.requiredTools
            : ['get_recipe_technical_files'])
            .map(String)
    );
    const targetName = normalizeTargetText(prerequisite?.recipeName);
    for (const tool of toolResults) {
        if (!requiredTools.has(String(tool?.name || ''))) continue;
        const result = tool?.result && typeof tool.result === 'object' ? tool.result : {};
        if (result.executionEvidence?.verified !== true) continue;
        const entityType = String(
            result.entityType
            || result.clarification?.entityType
            || result.resolutionReceipt?.entityType
            || ''
        );
        const query = normalizeTargetText(
            result.query
            || result.clarification?.query
            || result.resolutionReceipt?.originalMention
            || result.recipe?.name
        );
        if (entityType && entityType !== 'recipe') continue;
        if (!targetName || !query || query !== targetName) continue;
        if (
            result.requiresClarification === true
            && result.code === 'AI_RESOURCE_AMBIGUOUS'
        ) {
            return { kind: 'needs_confirmation', toolName: tool.name };
        }
        if (result.code === 'AI_RESOURCE_NOT_FOUND') {
            return { kind: 'verified_unavailable', toolName: tool.name };
        }
        if (result.success !== false && Array.isArray(result.files)) {
            const hasReport = result.files.some(file => (
                file?.reportType === 'pump_performance_test'
            ));
            if (!hasReport) {
                return { kind: 'verified_unavailable', toolName: tool.name };
            }
        }
    }
    return null;
}

function verifiedCoilObservation(config, prerequisite, toolResults = []) {
    const requiredTools = new Set(
        (Array.isArray(config?.requiredTools) && config.requiredTools.length > 0
            ? config.requiredTools
            : ['search_coils'])
            .map(String)
    );
    const targetSpec = normalizeTargetText(prerequisite?.spec);
    const targetSheets = Number.parseInt(prerequisite?.sheets, 10);
    for (const tool of toolResults) {
        if (!requiredTools.has(String(tool?.name || ''))) continue;
        const result = tool?.result && typeof tool.result === 'object' ? tool.result : {};
        if (result.executionEvidence?.verified !== true) continue;
        const filters = result.filters && typeof result.filters === 'object'
            ? result.filters
            : result.queryReceipt?.appliedFilters || {};
        if (normalizeTargetText(filters.spec) !== targetSpec) continue;
        if (Number.parseInt(filters.sheets, 10) !== targetSheets) continue;
        if (Number(result.count ?? result.queryReceipt?.totalCount) === 0) {
            return { kind: 'verified_unavailable', toolName: tool.name };
        }
    }
    return null;
}

function evaluatePrerequisite(config, answer, db, toolResults = []) {
    const prerequisite = config?.prerequisite;
    if (!prerequisite) return null;
    if (prerequisite.type === 'coil_variants') {
        const spec = String(prerequisite.spec || '').trim();
        const sheets = Number.parseInt(prerequisite.sheets, 10);
        const row = db.prepare(`
            SELECT id FROM coils
            WHERE spec = ? AND sheets = ?
              AND COALESCE(scheme_status, 'official') = 'official'
            ORDER BY id LIMIT 1
        `).get(spec, sheets);
        const available = Boolean(row);
        const unavailableTerms = Array.isArray(config.unavailableTerms)
            ? config.unavailableTerms
            : ['未找到', '没有找到', '未查到', '暂无', '没有可列出'];
        const unavailableResultTerms = [
            ...unavailableTerms,
            '未查询到',
            '没有查询到',
            '查询结果为 0',
            '查询结果为0',
            '返回结果为 0',
            '返回结果为0',
        ];
        const observation = !available
            ? verifiedCoilObservation(config, prerequisite, toolResults)
            : null;
        const unavailableConclusion = containsUnavailableConclusion(
            answer,
            unavailableResultTerms
        );
        return {
            type: prerequisite.type,
            available,
            passed: available || (Boolean(observation) && unavailableConclusion),
            observation,
            label: available
                ? `存在 ${spec}-${sheets} 正式线圈方案`
                : `明确说明 ${spec}-${sheets} 正式线圈方案不可用`,
            detail: available
                ? '已找到目标规格片数的正式线圈方案'
                : observation
                    ? unavailableConclusion
                        ? '正式线圈查询已验证目标方案不可用，回答已明确说明'
                        : '正式线圈查询已验证目标方案不可用，但回答没有明确说明'
                    : '没有取得目标规格和片数的正式线圈查询证据',
        };
    }
    if (prerequisite.type !== 'recipe_test_report') return null;
    const recipeName = String(prerequisite.recipeName || '').trim();
    const recipe = db.prepare(`
        SELECT id FROM recipes
        WHERE deleted_at IS NULL AND name = ?
        ORDER BY id DESC LIMIT 1
    `).get(recipeName);
    const report = recipe && db.prepare(`
        SELECT id FROM recipe_technical_files
        WHERE recipe_id = ? AND deleted_at IS NULL
          AND report_type = 'pump_performance_test'
        ORDER BY id DESC LIMIT 1
    `).get(recipe.id);
    const available = Boolean(report);
    const unavailableTerms = Array.isArray(config.unavailableTerms)
        ? config.unavailableTerms
        : ['未找到', '没有找到', '未记录', '没有记录', '无法确认', '无法提供', '尚未归档'];
    const observation = !available
        ? verifiedRecipeReportObservation(config, prerequisite, toolResults)
        : null;
    const unavailableConclusion = containsUnavailableConclusion(answer, unavailableTerms);
    const needsConfirmation = observation?.kind === 'needs_confirmation';
    const verifiedUnavailable = observation?.kind === 'verified_unavailable';
    return {
        type: prerequisite.type,
        available,
        passed: available || needsConfirmation || (verifiedUnavailable && unavailableConclusion),
        reviewRequired: needsConfirmation,
        observation,
        label: available ? `存在 ${recipeName} 性能测试报告` : `明确说明 ${recipeName} 性能测试报告不可用`,
        detail: available
            ? '已找到目标配方的性能测试报告'
            : needsConfirmation
                ? '正式技术档案查询无法唯一定位目标配方，需要人工确认后复测'
                : verifiedUnavailable
                    ? unavailableConclusion
                        ? '正式技术档案查询已验证目标资料不可用，回答已明确说明'
                        : '正式技术档案查询已验证目标资料不可用，但回答没有明确说明'
                    : '没有取得针对目标配方的正式技术档案查询证据',
    };
}

function evaluateRuleCase(caseItem, answerText, toolResults, db) {
    const answer = String(answerText || '');
    const config = caseItem.config || {};
    const checks = [];
    const evidence = collectEvidence(toolResults);
    const toolNames = new Set(toolResults.map(item => item?.name).filter(Boolean));
    const prerequisite = evaluatePrerequisite(config, answer, db, toolResults);

    if (prerequisite) {
        addCheck(
            checks,
            `prerequisite:${prerequisite.type}`,
            prerequisite.label,
            prerequisite.passed,
            prerequisite.detail
        );
        if (!prerequisite.available) {
            addCheck(
                checks,
                `prerequisite-evidence:${prerequisite.type}`,
                '取得目标资料的正式查询证据',
                Boolean(prerequisite.observation),
                prerequisite.observation
                    ? `已通过 ${prerequisite.observation.toolName} 取得目标范围内的正式结果`
                    : '未调用要求的正式工具，或工具结果不属于当前检查目标'
            );
        }
    }
    const strictEvidenceRequired = !prerequisite || prerequisite.available;
    if (strictEvidenceRequired) {
        for (const terms of Array.isArray(config.requiredTerms) ? config.requiredTerms : []) {
            const group = Array.isArray(terms) ? terms : [terms];
            addCheck(checks, `required:${group.join('|')}`, `包含 ${group.join(' 或 ')}`, containsAny(answer, group), '回答必须包含至少一个指定词');
        }
    }
    for (const term of Array.isArray(config.forbiddenTerms) ? config.forbiddenTerms : []) {
        const forbiddenAssertion = containsForbiddenAssertion(answer, term);
        addCheck(
            checks,
            `forbidden:${term}`,
            `不得把 ${term} 作为肯定结论`,
            !forbiddenAssertion,
            forbiddenAssertion ? `发现禁用结论：${term}` : '未发现肯定性禁用结论'
        );
    }
    if (strictEvidenceRequired) {
        for (const toolName of Array.isArray(config.requiredTools) ? config.requiredTools : []) {
            addCheck(checks, `tool:${toolName}`, `调用 ${toolName}`, toolNames.has(toolName), toolNames.has(toolName) ? '已调用' : '未调用要求的工具');
        }
        for (const sourceTable of Array.isArray(config.requiredSourceTables) ? config.requiredSourceTables : []) {
            const matched = evidence.sources.some(source => source.sourceTable === sourceTable);
            addCheck(checks, `source:${sourceTable}`, `引用 ${sourceTable}`, matched, matched ? '已保存可追溯来源' : '没有保存要求的知识来源');
        }
    }
    if (config.expectedMode) {
        const matched = evidence.provenance.some(item => item.kind === config.expectedMode);
        addCheck(checks, `mode:${config.expectedMode}`, config.expectedMode === 'live_business' ? '使用实时业务数据' : '使用知识库快照', matched, matched ? '数据模式正确' : '数据模式不符合要求');
    }

    if (config.fact?.type === 'part_price') {
        const row = db.prepare(`
            SELECT price FROM parts
            WHERE deleted_at IS NULL AND model = ?
            ORDER BY id DESC LIMIT 1
        `).get(config.fact.model);
        if (!row) {
            const missingPartTerms = Array.isArray(config.fact.missingPartTerms)
                ? config.fact.missingPartTerms
                : [
                    '未找到该零件',
                    '未查到',
                    '未查询到',
                    '没有查询到',
                    '没有找到该零件',
                    '未找到这个零件',
                    '零件库没有',
                    '零件库中没有',
                    '未找到匹配',
                    '没有匹配',
                    '该型号不存在',
                    '没有该型号',
                    '返回 0 条',
                    '返回0条',
                    '没有该零件',
                ];
            const missingMatched = containsUnavailableConclusion(answer, missingPartTerms);
            addCheck(
                checks,
                'fact:part_missing',
                `明确说明零件库没有 ${config.fact.model}`,
                missingMatched,
                missingMatched ? '没有伪造零件价格' : `零件库没有 ${config.fact.model} 时必须明确说明未找到`
            );
        } else {
            const matched = numberPattern(row.price).test(answer);
            addCheck(checks, 'fact:part_price', `回答当前价格 ${Number(row.price)} 元`, matched, matched ? '与零件库当前价格一致' : `回答未包含当前价格 ${Number(row.price)} 元`);
        }
    }

    if (config.fact?.type === 'coil_winding_profile') {
        const spec = String(config.fact.spec || '').trim();
        const sheets = Number.parseInt(config.fact.sheets, 10);
        const profiles = db.prepare(`
            SELECT id, material, slot_type, scheme_name,
                   main_wire_gauge, main_wire_data, aux_wire_gauge, aux_wire_data
            FROM coils
            WHERE spec = ? AND sheets = ?
              AND COALESCE(scheme_status, 'official') = 'official'
            ORDER BY id
        `).all(spec, sheets);
        const observed = toolResults.some(tool => {
            if (tool?.name !== 'search_coils') return false;
            const result = tool.result && typeof tool.result === 'object' ? tool.result : {};
            const filters = result.filters && typeof result.filters === 'object'
                ? result.filters
                : result.queryReceipt?.appliedFilters || {};
            if (result.executionEvidence?.verified !== true) return false;
            if (normalizeTargetText(filters.spec) !== normalizeTargetText(spec)) return false;
            if (Number.parseInt(filters.sheets, 10) !== sheets) return false;
            if (!Array.isArray(result.data)) return profiles.length === 0
                && Number(result.count ?? result.queryReceipt?.totalCount) === 0;
            return profiles.every(profile => result.data.some(item => (
                Number(item.id) === Number(profile.id)
                && String(item.material || '') === String(profile.material || '')
                && String(item.slotType || '') === String(profile.slot_type || '')
                && String(item.mainWireGauge || '') === String(profile.main_wire_gauge || '')
                && String(item.mainWireData || '') === String(profile.main_wire_data || '')
                && String(item.auxWireGauge || '') === String(profile.aux_wire_gauge || '')
                && String(item.auxWireData || '') === String(profile.aux_wire_data || '')
            )));
        });
        addCheck(
            checks,
            'fact:coil_winding_evidence',
            `正式查询返回 ${spec}-${sheets} 已保存绕组档案`,
            observed,
            observed ? '工具结果与当前线圈档案一致' : '没有取得目标规格片数的已验证绕组档案'
        );
        if (profiles.length === 0) {
            const missingTerms = [
                ...(Array.isArray(config.unavailableTerms) ? config.unavailableTerms : []),
                ...(Array.isArray(config.fact.unavailableTerms)
                    ? config.fact.unavailableTerms
                    : ['未填写绕组数据', '未设置绕组数据', '暂无绕组数据']),
            ];
            const missingMatched = containsUnavailableConclusion(answer, missingTerms)
                || containsAny(answer, missingTerms);
            addCheck(
                checks,
                'fact:coil_winding_unavailable',
                `明确说明 ${spec}-${sheets} 当前方案未填写绕组值`,
                missingMatched,
                missingMatched ? '没有伪造绕组值' : '没有完整绕组值时必须说明该方案未填写或未设置'
            );
        } else {
            const answerSegments = profileAnswerSegments(answer, profiles);
            for (const profile of profiles) {
                const identity = [profile.material, profile.slot_type]
                    .map(value => String(value || '').trim())
                    .filter(Boolean);
                const answerSegment = answerSegments.get(Number(profile.id)) || '';
                const identityMatched = identity.every(value => containsAny(answerSegment, [value]));
                addCheck(
                    checks,
                    `fact:coil_winding_${profile.id}_identity`,
                    `回答方案 ${identity.join('/') || profile.id}`,
                    identityMatched,
                    identityMatched ? '已标明方案材质和槽眼' : '回答未标明当前方案的材质和槽眼'
                );
                let hasEmptyField = false;
                for (const [field, label] of [
                    ['main_wire_gauge', '主线线径'],
                    ['main_wire_data', '主线绕组数据'],
                    ['aux_wire_gauge', '副线线径'],
                    ['aux_wire_data', '副线绕组数据'],
                ]) {
                    const value = String(profile[field] || '').trim();
                    if (!value) {
                        hasEmptyField = true;
                        continue;
                    }
                    const matched = containsAny(answerSegment, [value]);
                    addCheck(
                        checks,
                        `fact:coil_winding_${profile.id}_${field}`,
                        `回答${identity.join('/') || profile.id}的${label} ${value}`,
                        matched,
                        matched ? '与线圈档案当前值一致' : `回答未包含当前${label} ${value}`
                    );
                }
                if (hasEmptyField) {
                    const missingTerms = Array.isArray(config.fact.unavailableTerms)
                        ? config.fact.unavailableTerms
                        : ['未填写绕组数据', '未设置绕组数据', '暂无绕组数据'];
                    const missingMatched = containsAny(answerSegment, missingTerms);
                    addCheck(
                        checks,
                        `fact:coil_winding_${profile.id}_empty`,
                        `说明 ${identity.join('/') || profile.id} 的空绕组字段未填写`,
                        missingMatched,
                        missingMatched ? '未把空字段误写成系统没有该字段' : '方案存在空绕组字段时必须说明未填写或未设置'
                    );
                }
            }
        }
    }

    if (config.fact?.type === 'customer_quotation_count') {
        const customer = db.prepare('SELECT id FROM customers WHERE deleted_at IS NULL AND name = ?').get(config.fact.customerName);
        const quotations = customer
            ? db.prepare('SELECT id FROM quotations WHERE deleted_at IS NULL AND customer_id = ? ORDER BY id').all(customer.id)
            : [];
        if (!customer) {
            const missingCustomerTerms = Array.isArray(config.fact.missingCustomerTerms)
                ? config.fact.missingCustomerTerms
                : ['未找到客户', '没有找到客户', '客户不存在', '未记录客户'];
            const missingMatched = containsMissingCustomerConclusion(answer, missingCustomerTerms);
            addCheck(
                checks,
                'fact:customer_missing',
                `明确说明未找到客户 ${config.fact.customerName}`,
                missingMatched,
                missingMatched ? '没有伪造客户或报价数量' : '客户不存在时必须明确说明未找到客户'
            );
        } else {
            const countMatched = new RegExp(`(?:共|现有|找到)?\\s*${quotations.length}\\s*(?:条|份|个)`).test(answer)
                || (quotations.length === 0 && containsZeroQuotationConclusion(answer));
            addCheck(checks, 'fact:quotation_count', `回答报价数量 ${quotations.length} 份`, countMatched, countMatched ? '数量正确' : `回答未明确当前共有 ${quotations.length} 份报价`);
        }
        if (config.fact.forbidInternalIds) {
            const exposedIds = quotations
                .map(item => item.id)
                .filter(id => new RegExp(`#\\s*${id}(?!\\d)`).test(answer));
            addCheck(checks, 'fact:no_internal_ids', '不把数据库 ID 当作报价顺序', exposedIds.length === 0, exposedIds.length ? `发现内部编号：${exposedIds.map(id => `#${id}`).join('、')}` : '未暴露内部报价编号');
        }
    }

    const checksPassed = checks.length > 0 && checks.every(check => check.passed);
    return {
        status: checksPassed
            ? prerequisite?.reviewRequired ? 'review' : 'passed'
            : 'failed',
        checks,
        sources: evidence.sources,
    };
}

function runForOwner(db, ownerKey, runId) {
    return db.prepare(`
        SELECT * FROM ai_evaluation_runs
        WHERE id = ? AND owner_key = ?
    `).get(runId, normalizeOwnerKey(ownerKey));
}

function listAiEvaluationCases(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const releaseGateOnly = options.scope === 'release';
    return accessors.db.prepare(`
        SELECT * FROM ai_evaluation_cases
        WHERE enabled = 1 AND review_status = 'approved'
          AND (? = 0 OR release_gate_enabled = 1)
        ORDER BY sort_order, id
    `).all(releaseGateOnly ? 1 : 0)
        .map(row => caseView(row, accessors.aiEvaluationCaseRow));
}

function listAiSystemEvaluationCases(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    return accessors.db.prepare(`
        SELECT * FROM ai_evaluation_cases
        WHERE source_type = 'system'
        ORDER BY sort_order, id
    `).all().map(row => caseView(row, accessors.aiEvaluationCaseRow));
}

function configureAiSystemEvaluationCase(caseIdValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate, aiEvaluationCaseRow } = accessors;
    const caseId = positiveId(caseIdValue, '系统检查项ID');
    if (typeof input.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
    const current = db.prepare(`
        SELECT * FROM ai_evaluation_cases
        WHERE id = ? AND source_type = 'system'
    `).get(caseId);
    if (!current) return null;
    const write = safeUpdate('ai_evaluation_cases', caseId, {
        enabled: input.enabled ? 1 : 0,
    }, options.auditContext || {});
    options.onWrite?.(write);
    return caseView(
        db.prepare('SELECT * FROM ai_evaluation_cases WHERE id = ?').get(caseId),
        aiEvaluationCaseRow
    );
}

function createAiEvaluationRun(ownerKey, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, safeUpdate, aiEvaluationRunRow } = accessors;
    const execute = () => {
        const cases = listAiEvaluationCases({
            dbAccessors: accessors,
            scope: options.scope,
        });
        if (cases.length === 0) throw new Error('没有启用的知识库检查用例');
        const now = new Date().toISOString();
        const owner = normalizeOwnerKey(ownerKey);
        const unfinished = db.prepare(`
            SELECT id, total_count FROM ai_evaluation_runs
            WHERE owner_key = ? AND status = 'running'
        `).all(owner);
        unfinished.forEach(run => {
            const write = safeUpdate('ai_evaluation_runs', run.id, {
                status: 'failed',
                review_count: Number(run.total_count || 0),
                completed_at: now,
            }, options.auditContext || {});
            options.onWrite?.(write);
        });
        const info = safeInsert('ai_evaluation_runs', {
            owner_key: owner,
            status: 'running',
            total_count: cases.length,
            passed_count: 0,
            failed_count: 0,
            review_count: 0,
            started_at: now,
            created_at: now,
            updated_at: now,
        }, options.auditContext || {});
        options.onWrite?.(info);
        const run = aiEvaluationRunRow(db.prepare('SELECT * FROM ai_evaluation_runs WHERE id = ?').get(Number(info.lastInsertRowid)));
        return {
            run,
            cases,
            supersededRunIds: unfinished.map(item => Number(item.id)),
        };
    };
    return db.transaction(execute).immediate();
}

function recordAiEvaluationResult(ownerKey, runIdValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, aiEvaluationCaseRow, aiEvaluationResultRow } = accessors;
    const runId = positiveId(runIdValue, '运行ID');
    const run = runForOwner(db, ownerKey, runId);
    if (!run) return null;
    if (run.status !== 'running') throw new Error('本次知识库检查已经结束');
    const caseId = positiveId(input.caseId, '用例ID');
    const caseRow = db.prepare('SELECT * FROM ai_evaluation_cases WHERE id = ? AND enabled = 1').get(caseId);
    if (!caseRow) throw new Error('检查用例不存在');
    if (db.prepare('SELECT 1 FROM ai_evaluation_results WHERE run_id = ? AND case_id = ?').get(runId, caseId)) {
        throw new Error('该检查用例已经记录结果');
    }
    const answerText = normalizeText(input.answerText, 100000, 'AI 回答');
    const errorText = normalizeText(input.errorText, 1000, '错误信息');
    const toolResults = Array.isArray(input.toolResults) ? input.toolResults : [];
    const toolResultsJson = JSON.stringify(toolResults);
    if (toolResultsJson.length > 200000) throw new Error('工具结果过大');
    const caseItem = caseView(caseRow, aiEvaluationCaseRow);
    const evaluated = errorText || !answerText
        ? {
            status: 'review',
            checks: [{ key: 'execution', label: 'AI 查询执行成功', passed: false, detail: errorText || '没有返回回答' }],
            sources: [],
        }
        : evaluateRuleCase(caseItem, answerText, toolResults, db);
    const now = new Date().toISOString();
    const info = safeInsert('ai_evaluation_results', {
        run_id: runId,
        case_id: caseId,
        status: evaluated.status,
        answer_text: answerText,
        tool_results_json: toolResultsJson,
        sources_json: JSON.stringify(evaluated.sources),
        checks_json: JSON.stringify(evaluated.checks),
        error_text: errorText,
        created_at: now,
        updated_at: now,
    }, options.auditContext || {});
    options.onWrite?.(info);
    return resultView(db.prepare('SELECT * FROM ai_evaluation_results WHERE id = ?').get(Number(info.lastInsertRowid)), aiEvaluationResultRow);
}

function completeAiEvaluationRun(ownerKey, runIdValue, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate, aiEvaluationRunRow } = accessors;
    const runId = positiveId(runIdValue, '运行ID');
    const run = runForOwner(db, ownerKey, runId);
    if (!run) return null;
    const counts = db.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS passed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS review
        FROM ai_evaluation_results WHERE run_id = ?
    `).get(runId);
    const expected = Number(run.total_count || 0);
    const missing = Math.max(expected - Number(counts.total || 0), 0);
    const write = safeUpdate('ai_evaluation_runs', runId, {
        status: missing > 0 ? 'failed' : 'completed',
        passed_count: Number(counts.passed || 0),
        failed_count: Number(counts.failed || 0),
        review_count: Number(counts.review || 0) + missing,
        completed_at: new Date().toISOString(),
    }, options.auditContext || {});
    options.onWrite?.(write);
    return aiEvaluationRunRow(db.prepare('SELECT * FROM ai_evaluation_runs WHERE id = ?').get(runId));
}

function getAiEvaluationOverview(ownerKey, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, aiEvaluationRunRow, aiEvaluationResultRow } = accessors;
    const cases = listAiEvaluationCases({ dbAccessors: accessors });
    const releaseCases = listAiEvaluationCases({
        dbAccessors: accessors,
        scope: 'release',
    });
    const systemCases = listAiSystemEvaluationCases({ dbAccessors: accessors });
    const feedbackCases = require('./aiRegressionCases.cjs').listFeedbackEvaluationCases({
        dbAccessors: accessors,
    });
    const caseStats = {
        enabled: cases.length,
        systemTotal: systemCases.length,
        systemEnabled: systemCases.filter(item => item.enabled).length,
        releaseEnabled: releaseCases.length,
        feedbackTotal: feedbackCases.length,
        feedbackApproved: feedbackCases.filter(item => item.reviewStatus === 'approved').length,
        feedbackPending: feedbackCases.filter(item => item.reviewStatus === 'pending').length,
        feedbackRejected: feedbackCases.filter(item => item.reviewStatus === 'rejected').length,
    };
    const latestRunRow = db.prepare(`
        SELECT * FROM ai_evaluation_runs
        WHERE owner_key = ?
        ORDER BY id DESC LIMIT 1
    `).get(normalizeOwnerKey(ownerKey));
    if (!latestRunRow) {
        return {
            cases,
            systemCases,
            feedbackCases,
            caseStats,
            latestRun: null,
            latestRunMatchesConfiguration: false,
            results: [],
        };
    }
    const latestRun = aiEvaluationRunRow(latestRunRow);
    const resultRows = db.prepare(`
        SELECT result.*, evaluation_case.title AS case_title,
               evaluation_case.category AS case_category,
               evaluation_case.updated_at AS case_updated_at
        FROM ai_evaluation_results AS result
        JOIN ai_evaluation_cases AS evaluation_case ON evaluation_case.id = result.case_id
        WHERE result.run_id = ?
        ORDER BY evaluation_case.sort_order, evaluation_case.id
    `).all(latestRun.id);
    const results = resultRows.map(row => ({
        ...resultView(row, aiEvaluationResultRow),
        caseTitle: row.case_title,
        caseCategory: row.case_category,
    }));
    const configuredCaseIds = new Set(cases.map(item => Number(item.id)));
    const resultCaseIds = new Set(results.map(item => Number(item.caseId)));
    const latestRunMatchesConfiguration = configuredCaseIds.size === resultCaseIds.size
        && [...configuredCaseIds].every(id => resultCaseIds.has(id))
        && resultRows.every(row => {
            const resultAt = Date.parse(row.created_at || '');
            const caseAt = Date.parse(row.case_updated_at || '');
            return !Number.isFinite(resultAt) || !Number.isFinite(caseAt) || resultAt >= caseAt;
        });
    return {
        cases,
        systemCases,
        feedbackCases,
        caseStats,
        latestRun,
        latestRunMatchesConfiguration,
        results,
    };
}

function getLatestAiEvaluationHealth(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, aiEvaluationRunRow, aiEvaluationResultRow } = accessors;
    const activeCases = db.prepare(`
        SELECT id, title, category
        FROM ai_evaluation_cases
        WHERE enabled = 1
          AND release_gate_enabled = 1
          AND review_status = 'approved'
        ORDER BY sort_order, id
    `).all();
    if (activeCases.length === 0) {
        return {
            status: 'not_configured',
            healthy: true,
            latestRun: null,
            issues: [],
            activeCaseCount: 0,
            evaluatedActiveCaseCount: 0,
            activeFailedCount: 0,
            activeReviewCount: 0,
        };
    }
    const latestRunRow = db.prepare(`
        SELECT * FROM ai_evaluation_runs
        WHERE owner_key = 'internal'
        ORDER BY id DESC LIMIT 1
    `).get();
    if (!latestRunRow) {
        return {
            status: 'not_run',
            healthy: true,
            latestRun: null,
            issues: [],
            activeCaseCount: activeCases.length,
            evaluatedActiveCaseCount: 0,
            activeFailedCount: 0,
            activeReviewCount: 0,
        };
    }
    const latestRun = aiEvaluationRunRow(latestRunRow);
    if (latestRun.status === 'running') {
        return {
            status: 'running',
            healthy: true,
            latestRun,
            issues: [],
            activeCaseCount: activeCases.length,
            evaluatedActiveCaseCount: 0,
            activeFailedCount: 0,
            activeReviewCount: 0,
        };
    }
    const activeResultRows = db.prepare(`
        SELECT result.*, evaluation_case.title AS case_title, evaluation_case.category AS case_category
        FROM ai_evaluation_results AS result
        JOIN ai_evaluation_cases AS evaluation_case ON evaluation_case.id = result.case_id
        WHERE result.run_id = ?
          AND evaluation_case.enabled = 1
          AND evaluation_case.release_gate_enabled = 1
          AND evaluation_case.review_status = 'approved'
        ORDER BY CASE result.status WHEN 'failed' THEN 0 ELSE 1 END,
                 evaluation_case.sort_order,
                 evaluation_case.id
    `).all(latestRun.id);
    const issues = activeResultRows
        .filter(row => ['failed', 'review'].includes(row.status))
        .map(row => ({
        ...resultView(row, aiEvaluationResultRow),
        caseTitle: row.case_title,
        caseCategory: row.case_category,
    }));
    const evaluatedCaseIds = new Set(activeResultRows.map(row => Number(row.case_id)));
    for (const evaluationCase of activeCases) {
        if (evaluatedCaseIds.has(Number(evaluationCase.id))) continue;
        issues.push({
            caseId: Number(evaluationCase.id),
            caseTitle: evaluationCase.title,
            caseCategory: evaluationCase.category,
            status: 'missing',
            errorText: '当前启用用例未包含在最近一次回归运行中',
            checks: [],
        });
    }
    const activeFailedCount = activeResultRows.filter(row => row.status === 'failed').length;
    const activeReviewCount = activeResultRows.filter(row => row.status === 'review').length;
    const healthy = latestRun.status === 'completed'
        && activeResultRows.length === activeCases.length
        && activeFailedCount === 0
        && activeReviewCount === 0;
    return {
        status: healthy ? 'healthy' : 'attention',
        healthy,
        latestRun,
        issues,
        activeCaseCount: activeCases.length,
        evaluatedActiveCaseCount: activeResultRows.length,
        activeFailedCount,
        activeReviewCount,
    };
}

module.exports = {
    configureAiSystemEvaluationCase,
    listAiEvaluationCases,
    listAiSystemEvaluationCases,
    createAiEvaluationRun,
    recordAiEvaluationResult,
    completeAiEvaluationRun,
    getAiEvaluationOverview,
    getLatestAiEvaluationHealth,
    evaluateRuleCase,
    reviewFeedbackEvaluationCase: require('./aiRegressionCases.cjs').reviewFeedbackEvaluationCase,
};
