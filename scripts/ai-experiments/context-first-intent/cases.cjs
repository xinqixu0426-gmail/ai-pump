'use strict';

const CASES = Object.freeze([
    { id: 'CTX-01', userInput: '12-120是什么？' },
    { id: 'CTX-02', userInput: '12-120多少钱？' },
    { id: 'CTX-03', userInput: 'V750纸箱换成木箱差多少钱？' },
    { id: 'CTX-04', userInput: 'V750如果做不锈钢接轴，成本差多少？' },
    { id: 'CTX-05', userInput: 'V750电缆5米，木箱，先算一下，不保存。' },
    { id: 'CTX-06', userInput: '把V750正式配方包装改成木箱并保存。' },
    { id: 'CTX-07', userInput: 'V750包装改木箱。' },
    { id: 'CTX-08', userInput: '模板和配方有什么区别？' },
    { id: 'CTX-09', userInput: '通用款模板有哪些固定件？' },
    { id: 'CTX-10', userInput: 'V750成本，还有它现在用哪个线圈。' },
    { id: 'CTX-11', userInput: '刚才那个线圈多少钱？', recentConversation: 'User: 我先看一下12-120。' },
    { id: 'CTX-12', userInput: 'V750改一下。' },
    { id: 'ADV-01', userInput: '12-120有两个方案吧？' },
    { id: 'ADV-02', userInput: 'V750是不是一个固定成品？' },
    { id: 'ADV-03', userInput: '木箱比纸箱贵多少？' },
    { id: 'ADV-04', userInput: '这个换成木箱。' },
]);

module.exports = { CASES };
