'use strict';

const { fetchAiProvider, decodeAiProviderResponse } = require('../../../api/services/aiProvider.cjs');
const { resolveProviderConfig } = require('../../../api/services/aiProviderRegistry.cjs');

async function callModel(messages, options = {}) {
    const provider = options.provider || 'deepseek';
    const config = resolveProviderConfig(provider, options.env || process.env);
    if (!config.apiKey) throw new Error(`EXPERIMENT_${provider.toUpperCase()}_NOT_CONFIGURED`);
    const response = await fetchAiProvider(messages, { config, tools: [], stream: false, timeoutMs: options.timeoutMs || 120_000 });
    const payload = await decodeAiProviderResponse(response);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('EXPERIMENT_MODEL_RESPONSE_INVALID');
    return content.trim();
}

module.exports = { callModel };
