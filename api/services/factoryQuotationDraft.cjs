const {
    getFactoryFile,
    getFactoryFileContent,
} = require('./factoryFileStore.cjs');

const HEADER_ALIASES = {
    model: ['产品型号', '水泵型号', '型号', '产品名称', '品名', '货号', 'model', 'product', 'item'],
    spec: ['规格', '技术规格', 'spec', 'specification'],
    qty: ['数量', '订购数量', '采购数量', '台数', 'qty', 'quantity', 'pcs'],
    unitPrice: ['单价', '报价', '报价单价', '出厂价', 'unitprice', 'price'],
    amount: ['金额', '合计金额', '总价', 'amount', 'total'],
    remark: ['备注', '说明', 'remark', 'note'],
    customer: ['客户', '客户名称', '买方', 'customer', 'buyer'],
    quoteNo: ['报价编号', '报价单号', '报价号', 'quoteno', 'quotationno'],
    quoteDate: ['报价日期', '日期', 'quotedate', 'date'],
    currency: ['币种', '货币', 'currency'],
};

function loadDbAccessors() {
    return require('../db.cjs');
}

function text(value) {
    return String(value ?? '').trim();
}

function normalize(value) {
    return text(value)
        .toLowerCase()
        .replace(/[\s_\-\/\\:：()（）[\]【】.,，。]/g, '');
}

function normalizeHeader(value) {
    return normalize(value).replace(/(?:元|rmb|cny|usd|美元|人民币|台|只|件|套|pcs)$/i, '');
}

function fieldForHeader(value) {
    const candidate = normalizeHeader(value);
    if (!candidate) return '';
    return Object.entries(HEADER_ALIASES).find(([, aliases]) => (
        aliases.some(alias => candidate === normalizeHeader(alias))
    ))?.[0] || '';
}

function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const candidate = text(value)
        .replace(/[,，\s]/g, '')
        .replace(/[￥¥$€£]/g, '')
        .replace(/(?:rmb|cny|usd|元|台|只|件|套|pcs)$/i, '');
    if (!candidate) return null;
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : null;
}

function rowMap(row) {
    return new Map((row?.cells || []).map(cell => [Number(cell.columnIndex), cell]));
}

function findHeaderCandidate(parsed) {
    let best = null;
    for (const sheet of (parsed?.sheets || [])) {
        for (const row of (sheet.rows || [])) {
            const fields = {};
            for (const cell of (row.cells || [])) {
                const field = fieldForHeader(cell.text);
                if (field && fields[field] === undefined) fields[field] = Number(cell.columnIndex);
            }
            const identifier = fields.model !== undefined || fields.spec !== undefined;
            const score = (fields.model !== undefined ? 4 : 0)
                + (fields.spec !== undefined ? 2 : 0)
                + (fields.qty !== undefined ? 2 : 0)
                + (fields.unitPrice !== undefined ? 2 : 0)
                + (fields.amount !== undefined ? 1 : 0)
                + (fields.remark !== undefined ? 1 : 0);
            if (identifier && score >= 6 && (!best || score > best.score)) {
                best = {
                    sheetName: sheet.name,
                    rowNumber: row.rowNumber,
                    fields,
                    score,
                };
            }
        }
    }
    return best;
}

function extractLabelValue(parsed, field) {
    const aliases = HEADER_ALIASES[field] || [];
    for (const sheet of (parsed?.sheets || [])) {
        for (const row of (sheet.rows || [])) {
            for (let index = 0; index < row.cells.length; index += 1) {
                const cell = row.cells[index];
                const raw = text(cell.text);
                for (const alias of aliases) {
                    const exact = normalizeHeader(raw) === normalizeHeader(alias);
                    const inline = raw.match(new RegExp(`^${alias}\\s*[:：]\\s*(.+)$`, 'i'));
                    if (inline?.[1]) {
                        return {
                            value: text(inline[1]),
                            source: { sheetName: sheet.name, cellRef: cell.cellRef },
                        };
                    }
                    if (exact) {
                        const next = row.cells[index + 1];
                        if (next?.text && !fieldForHeader(next.text)) {
                            return {
                                value: text(next.text),
                                source: { sheetName: sheet.name, cellRef: next.cellRef },
                            };
                        }
                    }
                }
            }
        }
    }
    return { value: '', source: null };
}

function candidateView(row) {
    return {
        id: Number(row.id ?? row.Id),
        name: text(row.name),
        spec: text(row.spec),
    };
}

function matchCustomer(value, customers) {
    const query = normalize(value);
    if (!query) return { status: 'missing', confidence: 0, candidates: [] };
    const exact = (customers || []).filter(row => normalize(row.name) === query);
    if (exact.length === 1) {
        return {
            status: 'matched',
            confidence: 1,
            customer: candidateView(exact[0]),
            candidates: [],
        };
    }
    if (exact.length > 1) {
        return {
            status: 'ambiguous',
            confidence: 0,
            candidates: exact.slice(0, 5).map(candidateView),
        };
    }
    const similar = (customers || []).filter(row => {
        const name = normalize(row.name);
        return query.length >= 2 && (name.includes(query) || query.includes(name));
    });
    if (similar.length === 1) {
        return {
            status: 'review',
            confidence: 0.75,
            customer: candidateView(similar[0]),
            candidates: [],
        };
    }
    return {
        status: similar.length > 1 ? 'ambiguous' : 'unmatched',
        confidence: 0,
        candidates: similar.slice(0, 5).map(candidateView),
    };
}

function recipeKeys(recipe) {
    const name = normalize(recipe.name);
    const spec = normalize(recipe.spec);
    return new Set([
        name,
        spec,
        normalize(`${recipe.name || ''}${recipe.spec || ''}`),
        normalize(`${recipe.name || ''}-${recipe.spec || ''}`),
    ].filter(Boolean));
}

function matchRecipe(model, spec, recipes) {
    const queries = [normalize(model), normalize(spec), normalize(`${model}${spec}`)].filter(Boolean);
    const exact = (recipes || []).filter(recipe => (
        queries.some(query => recipeKeys(recipe).has(query))
    ));
    if (exact.length === 1) {
        return {
            status: 'matched',
            confidence: 1,
            recipe: candidateView(exact[0]),
            candidates: [],
        };
    }
    if (exact.length > 1) {
        return {
            status: 'ambiguous',
            confidence: 0,
            candidates: exact.slice(0, 5).map(candidateView),
        };
    }
    const source = normalize(`${model}${spec}`);
    const similar = source.length >= 3
        ? (recipes || []).filter(recipe => (
            [...recipeKeys(recipe)].some(key => key.length >= 3 && (
                key.includes(source) || source.includes(key)
            ))
        ))
        : [];
    if (similar.length === 1) {
        return {
            status: 'review',
            confidence: 0.7,
            recipe: candidateView(similar[0]),
            candidates: [],
        };
    }
    return {
        status: similar.length > 1 ? 'ambiguous' : 'unmatched',
        confidence: 0,
        candidates: similar.slice(0, 5).map(candidateView),
    };
}

function buildQuotationFileDraft(fileId, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const file = getFactoryFile(fileId, { dbAccessors: accessors });
    const content = getFactoryFileContent(fileId, { dbAccessors: accessors });
    if (!file) throw new Error('文件不存在');
    if (file.detectedType !== 'spreadsheet') throw new Error('报价文件草稿只支持 Excel 或 CSV');
    if (content?.parserStatus !== 'parsed' || content.parsed?.version !== 'spreadsheet-v1') {
        throw new Error('表格尚未完成 V9.3 解析');
    }

    const customers = options.customers || accessors.db.prepare(`
        SELECT id, name, default_margin
        FROM customers
        WHERE deleted_at IS NULL
        ORDER BY id
    `).all();
    const recipes = options.recipes || accessors.db.prepare(`
        SELECT id, name, spec, saved_total_cost
        FROM recipes
        WHERE deleted_at IS NULL
        ORDER BY id
    `).all().map(row => ({
        id: row.id,
        name: row.name,
        spec: row.spec,
        savedTotalCost: row.saved_total_cost,
    }));
    const header = findHeaderCandidate(content.parsed);
    if (!header) throw new Error('没有识别到报价明细表头，请确认包含型号/规格、数量或单价列');

    let customerSource = text(input.customerName)
        ? { value: text(input.customerName), source: { type: 'user_override' } }
        : extractLabelValue(content.parsed, 'customer');
    const quoteNo = extractLabelValue(content.parsed, 'quoteNo');
    const quoteDate = extractLabelValue(content.parsed, 'quoteDate');
    const currency = extractLabelValue(content.parsed, 'currency');
    const targetSheet = content.parsed.sheets.find(sheet => sheet.name === header.sheetName);
    if (!customerSource.value && header.fields.customer !== undefined) {
        const customerRow = (targetSheet?.rows || []).find(row => (
            row.rowNumber > header.rowNumber
            && text(rowMap(row).get(header.fields.customer)?.text)
        ));
        const customerCell = customerRow
            ? rowMap(customerRow).get(header.fields.customer)
            : null;
        if (customerCell?.text) {
            customerSource = {
                value: text(customerCell.text),
                source: {
                    sheetName: header.sheetName,
                    cellRef: customerCell.cellRef,
                },
            };
        }
    }
    const customerMatch = matchCustomer(customerSource.value, customers);
    const items = [];
    const warnings = [];

    let lastItemRow = header.rowNumber;
    for (const row of (targetSheet?.rows || [])) {
        if (row.rowNumber <= header.rowNumber) continue;
        if (items.length > 0 && row.rowNumber > lastItemRow + 3) break;
        const cells = rowMap(row);
        const value = field => text(cells.get(header.fields[field])?.text);
        const model = value('model');
        const spec = value('spec');
        if (!model && !spec) continue;
        if (/^(合计|总计|total)$/i.test(normalizeHeader(model || spec))) continue;
        if (fieldForHeader(model) === 'model' || fieldForHeader(spec) === 'spec') continue;

        const qtyValue = parseNumber(value('qty'));
        const unitPriceValue = parseNumber(value('unitPrice'));
        const amountValue = parseNumber(value('amount'));
        const recipeMatch = matchRecipe(model, spec, recipes);
        const itemWarnings = [];
        const qty = qtyValue && qtyValue > 0 ? qtyValue : 1;
        if (!(qtyValue && qtyValue > 0)) itemWarnings.push('数量缺失或无效，草稿暂按 1');
        if (unitPriceValue !== null && unitPriceValue < 0) itemWarnings.push('单价不能为负数');
        if (
            unitPriceValue !== null
            && amountValue !== null
            && Math.abs(unitPriceValue * qty - amountValue) > 0.02
        ) {
            itemWarnings.push('文件中的数量×单价与金额不一致');
        }
        if (recipeMatch.status !== 'matched') {
            itemWarnings.push(
                recipeMatch.status === 'review'
                    ? '配方仅为近似匹配，需要确认'
                    : recipeMatch.status === 'ambiguous'
                        ? '匹配到多个配方，需要选择'
                        : '系统中未找到对应配方'
            );
        }
        const draftItem = recipeMatch.recipe ? {
            baseRecipeId: recipeMatch.recipe.id,
            baseRecipeName: recipeMatch.recipe.name,
            spec: recipeMatch.recipe.spec || spec,
            qty,
            unitPrice: unitPriceValue !== null && unitPriceValue >= 0 ? unitPriceValue : undefined,
        } : null;
        items.push({
            source: {
                sheetName: header.sheetName,
                rowNumber: row.rowNumber,
                model,
                spec,
                qty: qtyValue,
                unitPrice: unitPriceValue,
                amount: amountValue,
                remark: value('remark'),
            },
            recipeMatch,
            draftItem,
            warnings: itemWarnings,
        });
        lastItemRow = row.rowNumber;
    }

    if (items.length === 0) throw new Error('报价表头下没有识别到产品明细');
    if (customerMatch.status !== 'matched') {
        warnings.push(
            customerMatch.status === 'missing'
                ? '文件中没有识别到客户名称'
                : customerMatch.status === 'review'
                    ? '客户仅为近似匹配，需要确认'
                    : customerMatch.status === 'ambiguous'
                        ? '客户名称匹配到多个候选'
                        : '系统中未找到该客户'
        );
    }
    const exactItems = items.filter(item => item.recipeMatch.status === 'matched');
    const readyForSaveDraft = customerMatch.status === 'matched'
        && exactItems.length === items.length
        && items.every(item => item.draftItem);
    const quotationDraftInput = readyForSaveDraft ? {
        customerId: customerMatch.customer.id,
        status: '草稿',
        items: items.map(item => item.draftItem),
        remark: [
            `来源文件：${file.originalName}`,
            quoteNo.value ? `报价编号：${quoteNo.value}` : '',
            quoteDate.value ? `报价日期：${quoteDate.value}` : '',
            currency.value ? `币种：${currency.value}` : '',
        ].filter(Boolean).join('；'),
    } : null;

    return {
        file: {
            id: file.id,
            originalName: file.originalName,
            downloadPath: file.downloadPath,
        },
        document: {
            customerName: customerSource.value,
            customerSource: customerSource.source,
            quoteNo: quoteNo.value,
            quoteDate: quoteDate.value,
            currency: currency.value,
        },
        header,
        customerMatch,
        items,
        warnings,
        summary: {
            totalItems: items.length,
            exactMatchedItems: exactItems.length,
            reviewItems: items.filter(item => item.recipeMatch.status === 'review').length,
            ambiguousItems: items.filter(item => item.recipeMatch.status === 'ambiguous').length,
            unmatchedItems: items.filter(item => item.recipeMatch.status === 'unmatched').length,
            readyForSaveDraft,
        },
        quotationDraftInput,
        boundary: '只读解析和映射草稿；未创建或修改客户、配方、报价。',
    };
}

module.exports = {
    HEADER_ALIASES,
    buildQuotationFileDraft,
    fieldForHeader,
    findHeaderCandidate,
    matchCustomer,
    matchRecipe,
    parseNumber,
};
