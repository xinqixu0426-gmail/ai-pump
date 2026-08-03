const { CommandExecutionError } = require('./commandExecution.cjs');

const COPPER_VARIETY_ID = 746;
const ALUMINUM_VARIETY_ID = 544;
const MARKET_TIMEOUT_MS = 10_000;
const MARKET_SOURCES = Object.freeze({
    copper: 'quheqihuo.spot.copper',
    aluminum: 'quheqihuo.spot.aluminum',
    exchangeRate: 'exchangerate-api.usd-cny',
});

function marketDependencyError(message, cause) {
    const error = new CommandExecutionError(
        'market_data_unavailable',
        message,
        502
    );
    if (cause) error.cause = cause;
    return error;
}

function requirePositiveMarketNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw marketDependencyError(`${label}数据格式无效`);
    }
    return number;
}

async function fetchSpotMetalPrice(fetchWithPolicy, varietyId, label) {
    const url = `https://m.quheqihuo.com/dz/ajax/js_data_history.html?id=${varietyId}&size=1`;
    try {
        const response = await fetchWithPolicy(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                Referer: 'https://m.quheqihuo.com/dz/js-d746.html',
            },
        }, {
            timeoutMs: MARKET_TIMEOUT_MS,
            retries: 1,
            label,
        });
        const json = await response.json();
        if (json?.code !== 0 || !Array.isArray(json?.data) || json.data.length === 0) {
            throw new Error('响应不包含有效行情');
        }
        return requirePositiveMarketNumber(json.data[0]?.price, label);
    } catch (error) {
        if (error instanceof CommandExecutionError) throw error;
        throw marketDependencyError(`${label}获取失败: ${error.message}`, error);
    }
}

function fetchCopperPrice(fetchWithPolicy) {
    return fetchSpotMetalPrice(
        fetchWithPolicy,
        COPPER_VARIETY_ID,
        '铜价'
    );
}

function fetchAluminumPrice(fetchWithPolicy) {
    return fetchSpotMetalPrice(
        fetchWithPolicy,
        ALUMINUM_VARIETY_ID,
        '铝价'
    );
}

async function fetchUsdCnyRate(fetchWithPolicy) {
    try {
        const response = await fetchWithPolicy(
            'https://api.exchangerate-api.com/v4/latest/USD',
            {
                headers: { 'User-Agent': 'pump-bom-manager/1.0' },
            },
            {
                timeoutMs: MARKET_TIMEOUT_MS,
                retries: 1,
                label: '美元汇率',
            }
        );
        const json = await response.json();
        return {
            rate: requirePositiveMarketNumber(
                json?.rates?.CNY,
                '美元兑人民币汇率'
            ),
            date: json?.date || null,
        };
    } catch (error) {
        if (error instanceof CommandExecutionError) throw error;
        throw marketDependencyError(
            `美元兑人民币汇率获取失败: ${error.message}`,
            error
        );
    }
}

async function fetchMarketSnapshot(fetchWithPolicy, now = new Date()) {
    const [copperPricePerTon, aluminumPricePerTon, exchangeRate] =
        await Promise.all([
            fetchCopperPrice(fetchWithPolicy),
            fetchAluminumPrice(fetchWithPolicy),
            fetchUsdCnyRate(fetchWithPolicy),
        ]);
    return {
        copperPricePerTon,
        aluminumPricePerTon,
        usdCnyRate: exchangeRate.rate,
        exchangeRateSourceDate: exchangeRate.date,
        fetchedAt: new Date(now).toISOString(),
        sources: MARKET_SOURCES,
    };
}

module.exports = {
    ALUMINUM_VARIETY_ID,
    COPPER_VARIETY_ID,
    MARKET_SOURCES,
    MARKET_TIMEOUT_MS,
    fetchAluminumPrice,
    fetchCopperPrice,
    fetchMarketSnapshot,
    fetchSpotMetalPrice,
    fetchUsdCnyRate,
    marketDependencyError,
    requirePositiveMarketNumber,
};
