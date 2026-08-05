const WRITE_SUCCESS_CLAIM_RE = /(?:录入|写入|新增|创建|修改|更新|删除|提交|执行)(?:操作|请求)?(?:已经|已)?成功|(?:已经|已)(?:通过.{0,20})?(?:录入|写入|新增|创建|修改|更新|删除|提交|执行)(?:完成|成功|到|至|数据库|操作)?|已调用.{0,20}(?:API|接口).{0,16}(?:执行|写入|录入)/;
const PSEUDO_CONFIRMATION_RE = /确认卡片|确认无误后.{0,40}(?:回复|点击|输入).{0,20}确认|回复.{0,12}确认(?:录入|执行|提交)|我将.{0,24}(?:提交|调用).{0,20}(?:API|接口)/;
const FALSE_WRITE_DENIAL_RE = /当前(?:会话|工具集|可用工具).{0,30}(?:没有|不包含).{0,20}(?:写入|录入|新增)|(?:没有权限|无权限).{0,16}(?:写入|录入|新增)|未提供.{0,20}(?:写入接口|标准\s*API)|没有.{0,20}(?:新增零件|零件写入|零件录入).{0,12}(?:工具|接口|API)|无法直接写入数据库/;

function unverifiedWriteClaimType(content = '') {
    const text = String(content || '').trim();
    if (!text) return '';
    if (WRITE_SUCCESS_CLAIM_RE.test(text)) return 'success';
    if (PSEUDO_CONFIRMATION_RE.test(text)) return 'confirmation';
    if (FALSE_WRITE_DENIAL_RE.test(text)) return 'denial';
    return '';
}

function availableWriteToolNames(toolRoute = {}, writeTools = new Set()) {
    return (toolRoute.toolNames || []).filter(name => writeTools.has(name));
}

function shouldRetryUnverifiedWriteReply({
    content,
    toolRoute,
    writeTools,
} = {}) {
    if (!toolRoute?.writeIntent) return false;
    if (availableWriteToolNames(toolRoute, writeTools).length === 0) return false;
    return Boolean(unverifiedWriteClaimType(content));
}

function buildWriteToolCorrection(toolRoute = {}, writeTools = new Set()) {
    const names = availableWriteToolNames(toolRoute, writeTools);
    return [
        '【服务端写操作校正】',
        '上一条回复不能发送给用户：它在没有正式工具回执时生成了文字确认或声称写入成功。',
        `当前可用写工具：${names.join('、') || '无'}。`,
        '如果参数足够，立即调用最匹配的写工具，由服务端生成真实确认卡片；如果参数不足，只询问缺失字段。',
        '不得自行生成确认卡片，不得让用户仅靠文字“确认”触发写入，也不得在取得 operation receipt 前声称成功。',
    ].join('\n');
}

function safeUnverifiedWriteReply() {
    return '本轮尚未取得正式写入确认或执行回执，因此没有写入业务数据。请重新发起该操作，我会通过可核对的确认卡片执行。';
}

module.exports = {
    availableWriteToolNames,
    buildWriteToolCorrection,
    safeUnverifiedWriteReply,
    shouldRetryUnverifiedWriteReply,
    unverifiedWriteClaimType,
};
