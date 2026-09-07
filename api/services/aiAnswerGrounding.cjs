function addFinite(values, value) {
    const number = Number(value);
    if (Number.isFinite(number)) values.add(Number(number.toFixed(4)));
}

function numericCostValuesFromPreview(data = {}) {
    const preview = data.costPreview || {};
    const values = new Set();
    for (const value of [preview.currentTotalCost, preview.partsCost, preview.laborCost, data.shellPrice]) {
        addFinite(values, value);
    }
    for (const part of Array.isArray(data.parts) ? data.parts : []) {
        addFinite(values, part?.snapshotPrice);
        addFinite(values, Number(part?.snapshotPrice) * Number(part?.qty));
    }
    for (const match of String(preview.details || '').matchAll(/¥\s*(-?\d+(?:\.\d+)?)/g)) {
        addFinite(values, match[1]);
    }
    return values;
}

function claimedCostValues(answer) {
    const values = [];
    const add = value => {
        const number = Number(value);
        if (Number.isFinite(number)) values.push(number);
    };
    const text = String(answer || '');
    for (const match of text.matchAll(/(?:¥\s*(-?\d+(?:\.\d+)?)|(-?\d+(?:\.\d+)?)\s*元)/g)) {
        add(match[1] ?? match[2]);
    }
    const lines = text.split(/\r?\n/);
    let amountTable = false;
    for (const line of lines) {
        if (!line.includes('|')) {
            amountTable = false;
            continue;
        }
        if (/(?:金额|成本).{0,8}(?:元|¥)/.test(line)) {
            amountTable = true;
            continue;
        }
        if (!amountTable || /^\s*\|?\s*:?-+/.test(line)) continue;
        const cells = line.split('|').map(value => value.trim()).filter(Boolean);
        const value = cells.at(-1)?.match(/^-?\d+(?:\.\d+)?$/)?.[0];
        if (value !== undefined) add(value);
    }
    return [...new Set(values.map(value => Number(value.toFixed(4))))];
}

function configuredBomResult(toolResults = []) {
    return toolResults.find(tool => (
        tool?.name === 'build_recipe_bom_draft'
        && tool?.result?.executionEvidence?.verified === true
        && tool?.result?.data?.costPreview
        && Array.isArray(tool?.result?.data?.parts)
    ))?.result?.data || null;
}

function ungroundedConfiguredBomAmounts(answer, toolResults = []) {
    const data = configuredBomResult(toolResults);
    if (!data) return [];
    const allowed = numericCostValuesFromPreview(data);
    return claimedCostValues(answer).filter(value => (
        ![...allowed].some(expected => Math.abs(expected - value) < 0.005)
    ));
}

function containsFalseReadConfirmationClaim(answer) {
    return /(?:正式)?确认卡片.{0,12}(?:已生成|生成完成|已经生成)|(?:请|需要).{0,8}确认后(?:执行|保存|生效)/.test(
        String(answer || '').replace(/\s+/g, '')
    );
}

function formatMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(2)} 元` : '';
}

function buildGroundedConfiguredBomReply(toolResults = []) {
    const data = configuredBomResult(toolResults);
    if (!data) return '';
    const parts = data.parts;
    const preview = data.costPreview;
    const template = parts.find(part => (
        part?.costRole === 'stainlessShellBundle' || part?.source === 'pump_shell_template'
    ));
    const coil = parts.find(part => part?.costRole === 'coil');
    const hasFloat = parts.some(part => part?.costRole === 'float');
    const packing = parts.filter(part => part?.costRole === 'packing').map(part => part.model);
    const configuration = [
        template?.model,
        coil?.model,
        hasFloat ? '带浮球' : '',
        ...packing,
    ].filter(Boolean).join('，');
    const totals = [
        Number.isFinite(Number(preview.partsCost)) ? `配件和材料 ${formatMoney(preview.partsCost)}` : '',
        Number.isFinite(Number(preview.laborCost)) ? `人工及管理 ${formatMoney(preview.laborCost)}` : '',
    ].filter(Boolean).join('，');
    return [
        `**${configuration}，当前正式总成本 ${formatMoney(preview.currentTotalCost)}。**`,
        `正式 BOM 共 ${parts.length} 项${totals ? `；${totals}` : ''}。`,
    ].join('\n\n');
}

module.exports = {
    buildGroundedConfiguredBomReply,
    claimedCostValues,
    configuredBomResult,
    containsFalseReadConfirmationClaim,
    numericCostValuesFromPreview,
    ungroundedConfiguredBomAmounts,
};
