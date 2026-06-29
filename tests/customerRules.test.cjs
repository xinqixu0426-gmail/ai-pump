const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/customerRules.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '');
const helpers = `const DEFAULT_QUOTATION_MARGIN = 0.15;`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { defaultCustomerInput, customerInputFromCustomer, updateCustomerDefaultMargin, quotationsForCustomer, quotationCountByCustomer, calculateCustomerQuotationStats, quotationStatusColor };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const {
    defaultCustomerInput,
    customerInputFromCustomer,
    updateCustomerDefaultMargin,
    quotationsForCustomer,
    quotationCountByCustomer,
    calculateCustomerQuotationStats,
    quotationStatusColor,
} = moduleStub.exports;

test('客户规则生成默认表单并从客户回填', () => {
    assert.deepEqual(defaultCustomerInput(), { name: '', contactInfo: '', defaultMargin: 0.15, remark: '' });
    assert.deepEqual(customerInputFromCustomer({ name: '客户A', contactInfo: '', defaultMargin: 0.2 }), {
        name: '客户A',
        contactInfo: '',
        defaultMargin: 0.2,
        remark: '',
    });
    assert.equal(updateCustomerDefaultMargin(defaultCustomerInput(), '').defaultMargin, 0);
    assert.equal(updateCustomerDefaultMargin(defaultCustomerInput(), '0.18').defaultMargin, 0.18);
});

test('客户规则统计报价数量、总额和最近报价日期', () => {
    const quotations = [
        { Id: 1, customerId: 7, totalPrice: 100, CreatedAt: '2026-06-01T00:00:00.000Z' },
        { Id: 2, customerId: 7, totalPrice: 250, CreatedAt: '2026-06-20T00:00:00.000Z' },
        { Id: 3, customerId: 9, totalPrice: 99, CreatedAt: 'bad-date' },
    ];

    const customerQuotations = quotationsForCustomer(quotations, 7);
    const counts = quotationCountByCustomer(quotations);
    const stats = calculateCustomerQuotationStats(customerQuotations);

    assert.equal(customerQuotations.length, 2);
    assert.equal(counts.get(7), 2);
    assert.equal(counts.get(9), 1);
    assert.equal(stats.count, 2);
    assert.equal(stats.totalPrice, 350);
    assert.equal(stats.latest.toISOString(), '2026-06-20T00:00:00.000Z');
});

test('客户规则映射报价状态颜色', () => {
    assert.equal(quotationStatusColor('已接受'), 'success');
    assert.equal(quotationStatusColor('已转订单'), 'info');
    assert.equal(quotationStatusColor('报价中'), 'default');
});
