const { QUOTATION_STATUSES } = require('./orderWorkflow.cjs');
const {
    normalizeOptionalEnum,
    normalizeOptionalLimit,
    normalizeQueryText,
} = require('./queryValidation.cjs');

class QuotationQueryError extends Error {
    constructor(message, code = 'INVALID_QUOTATION_QUERY') {
        super(message);
        this.name = 'QuotationQueryError';
        this.statusCode = 400;
        this.code = code;
    }
}

function normalizeLimit(value) {
    return normalizeOptionalLimit(value);
}

function normalizeStatus(value) {
    try {
        return normalizeOptionalEnum(value, '报价状态', QUOTATION_STATUSES);
    } catch (error) {
        throw new QuotationQueryError(error.message, 'INVALID_QUOTATION_STATUS');
    }
}

function normalizeCustomerName(value) {
    try {
        return normalizeQueryText(value, 'customerName');
    } catch (error) {
        throw new QuotationQueryError(error.message);
    }
}

function createQuotationQueries({ listQuotations, listCustomers } = {}) {
    if (typeof listQuotations !== 'function') {
        throw new Error('报价查询服务缺少报价列表依赖');
    }
    if (typeof listCustomers !== 'function') {
        throw new Error('报价查询服务缺少客户列表依赖');
    }

    function list(options = {}) {
        const status = normalizeStatus(options.status);
        const customerName = normalizeCustomerName(options.customerName);
        const normalizedCustomerName = customerName.toLocaleLowerCase();
        const limit = normalizeLimit(options.limit);
        const customerNames = new Map(
            listCustomers().map(customer => [
                Number(customer.id ?? customer.Id),
                String(customer.name || '').trim(),
            ])
        );
        const quotations = listQuotations()
            .map(quotation => ({
                ...quotation,
                customerName: customerNames.get(
                    Number(quotation.customerId ?? quotation.CustomerId)
                ) || '',
            }))
            .filter(quotation => (
                (!status || String(quotation.status || '').trim() === status)
                && (
                    !normalizedCustomerName
                    || quotation.customerName.toLocaleLowerCase().includes(normalizedCustomerName)
                )
            ))
            .sort((left, right) => Number(right.id ?? right.Id ?? 0) - Number(left.id ?? left.Id ?? 0));
        return limit ? quotations.slice(0, limit) : quotations;
    }

    return { list };
}

module.exports = {
    QuotationQueryError,
    createQuotationQueries,
    normalizeCustomerName,
    normalizeLimit,
    normalizeStatus,
};
