function safeUnverifiedWriteReply() {
    return '本轮尚未取得正式写入确认或执行回执，因此没有写入业务数据。请重新发起该操作，我会通过可核对的确认卡片执行。';
}

module.exports = { safeUnverifiedWriteReply };
