const { parsePositiveId } = require('./validation.cjs');
const {
    normalizeOptionalLimit,
    normalizeQueryText,
} = require('./queryValidation.cjs');

const MAX_CONTEXT_LIMIT = 50;

class CustomerQueryError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'CustomerQueryError';
        this.statusCode = statusCode;
    }
}

function normalizeText(value) {
    return String(value || '').trim();
}

function includesText(source, keyword) {
    const needle = normalizeText(keyword);
    if (!needle) return false;
    return normalizeText(source).includes(needle);
}

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeContextLimit(value) {
    return normalizeOptionalLimit(value, { max: MAX_CONTEXT_LIMIT });
}

function createCustomerQueries({
    listCustomers,
    listOrders,
    listQuotations,
} = {}) {
    if (typeof listCustomers !== 'function') {
        throw new Error('客户查询服务缺少客户列表依赖');
    }
    if (typeof listOrders !== 'function') {
        throw new Error('客户查询服务缺少订单列表依赖');
    }
    if (typeof listQuotations !== 'function') {
        throw new Error('客户查询服务缺少报价列表依赖');
    }

    function getAllCustomers(options = {}) {
        const name = normalizeQueryText(options.name, 'name').toLocaleLowerCase();
        const hasId = options.id !== undefined && options.id !== '';
        const id = hasId ? parsePositiveId(options.id) : null;
        if (hasId && !id) throw new CustomerQueryError('非法客户ID');
        const limit = normalizeOptionalLimit(options.limit);
        const customers = listCustomers().filter(customer => (
            (!id || Number(customer.id ?? customer.Id) === id)
            && (!name || normalizeText(customer.name).toLocaleLowerCase().includes(name))
        ));
        return limit ? customers.slice(0, limit) : customers;
    }

    function getCustomerContext(rawCustomerId, options = {}) {
        const customerId = parsePositiveId(rawCustomerId);
        if (!customerId) {
            throw new CustomerQueryError('非法客户ID');
        }
        const customer = listCustomers().find(
            row => Number(row.id ?? row.Id) === customerId
        );
        if (!customer) {
            throw new CustomerQueryError('客户不存在', 404);
        }

        const keyword = normalizeText(
            options.keyword || options.recipeName || options.model
        );
        const limit = normalizeContextLimit(options.limit);
        const quotations = listQuotations()
            .filter(row => Number(row.customerId ?? row.customer_id) === customerId)
            .map(row => ({
                ...row,
                items: parseJsonArray(row.itemsJson || row.items_json),
            }))
            .filter(row => (
                !keyword
                || row.items.some(item => includesText(
                    item.baseRecipeName || item.recipeName,
                    keyword
                ))
            ))
            .sort((left, right) => {
                const leftTime = Date.parse(left.createdAt || left.created_at || '') || 0;
                const rightTime = Date.parse(right.createdAt || right.created_at || '') || 0;
                return leftTime - rightTime
                    || Number(left.id || left.Id || 0) - Number(right.id || right.Id || 0);
            })
            .map((row, index) => {
                const quotation = { ...row };
                delete quotation.id;
                delete quotation.Id;
                return {
                    ...quotation,
                    displaySequence: index + 1,
                };
            });
        const customerName = normalizeText(customer.name);
        const orders = listOrders()
            .filter(row => (
                normalizeText(row.customerName || row.customer_name) === customerName
            ))
            .map(row => ({
                ...row,
                items: parseJsonArray(row.itemsJson || row.items_json),
            }))
            .filter(row => (
                !keyword
                || row.items.some(item => includesText(
                    item.recipeName || item.baseRecipeName,
                    keyword
                ))
            ));
        const sourceOfTruth = ['customers', 'quotations', 'orders'];

        return {
            customer,
            quotations: limit ? quotations.slice(0, limit) : quotations,
            orders: limit ? orders.slice(0, limit) : orders,
            summary: `找到 ${customer.name} 的历史报价 ${quotations.length} 条、订单 ${orders.length} 条。`,
            query: {
                keyword,
                limit,
            },
            sourceOfTruth,
            asOf: new Date().toISOString(),
            provenance: {
                kind: 'live_business',
                sourceOfTruth,
            },
        };
    }

    return {
        getAllCustomers,
        getCustomerContext,
    };
}

module.exports = {
    CustomerQueryError,
    createCustomerQueries,
    normalizeContextLimit,
};
