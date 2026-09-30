'use strict';

const { fetchAiProvider, decodeAiProviderResponse } = require('../../../api/services/aiProvider.cjs');
const { resolveProviderConfig } = require('../../../api/services/aiProviderRegistry.cjs');

async function callDeepSeek(messages, options = {}) {
    const config = resolveProviderConfig('deepseek', options.env || process.env);
    if (!config.apiKey) throw new Error('EXPERIMENT_DEEPSEEK_NOT_CONFIGURED');
    const response = await fetchAiProvider(messages, { config, tools: [], stream: false, timeoutMs: options.timeoutMs || 120_000 });
    const payload = await decodeAiProviderResponse(response);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('EXPERIMENT_MODEL_RESPONSE_INVALID');
    return content;
}

module.exports = { callDeepSeek };
