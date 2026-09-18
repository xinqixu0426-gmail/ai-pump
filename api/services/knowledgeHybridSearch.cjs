const { createLogger } = require('../logger.cjs');
const { embeddingProvider } = require('./embeddingProvider.cjs');
const { searchKnowledgeEntries } = require('./knowledge.cjs');
const { searchStoredEmbeddings } = require('./knowledgeVectorStore.cjs');
const { estimateTextTokens, resolveAiTokenBudgets } = require('./aiTokenBudget.cjs');
const { selectRelevantTextChunks } = require('./aiTextChunks.cjs');

const DEFAULT_CANDIDATE_LIMIT = 20;
const RRF_OFFSET = 60;

function envBoolean(value, defaultValue) {
    if (value == null || String(value).trim() === '') return defaultValue;
    return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function normalizeLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(Math.max(Math.trunc(parsed), 1), 50);
}

function canonicalText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase('zh-CN')
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function parseJson(value, fallback) {
    try {
        const parsed = JSON.parse(value || '');
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function listItemFromRow(row, rowAdapter) {
    const entry = rowAdapter(row);
    return {
        id: entry.id,
        entryType: entry.entryType,
        sourceTable: entry.sourceTable,
        sourceId: entry.sourceId,
        title: entry.title,
        summary: entry.summary,
        content: entry.content,
        tags: parseJson(entry.tagsJson, []),
        metadata: parseJson(entry.metadataJson, {}),
        syncedAt: entry.syncedAt,
        updatedAt: entry.updatedAt,
    };
}

function decorateRelevantChunks(items, query, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const totalBudget = options.maxTokens !== undefined
        ? Math.max(0, Math.trunc(Number(options.maxTokens) || 0))
        : resolveAiTokenBudgets(options.env).knowledgeExcerptTokens;
    let remainingBudget = Math.max(0, totalBudget);
    return list.map((item, index) => {
        const source = String(item.content || item.summary || '');
        const remainingItems = Math.max(1, list.length - index);
        const perItemBudget = remainingBudget > 0
            ? Math.max(1, Math.floor(remainingBudget / remainingItems))
            : 0;
        const relevantChunks = query && source && perItemBudget > 0
            ? selectRelevantTextChunks(source, query, {
                maxTokens: perItemBudget,
                maxChunks: 3,
                maxChunkTokens: 500,
                overlapTokens: 50,
            }).map(chunk => ({
                chunkIndex: chunk.chunkIndex,
                charStart: chunk.charStart,
                charEnd: chunk.charEnd,
                content: chunk.content,
                relevanceScore: chunk.relevanceScore,
            }))
            : [];
        remainingBudget = Math.max(
            0,
            remainingBudget - relevantChunks.reduce(
                (sum, chunk) => sum + estimateTextTokens(chunk.content),
                0
            )
        );
        const { content: _content, ...metadata } = item;
        return { ...metadata, relevantChunks };
    });
}

function loadKnowledgeItems(database, ids, options = {}) {
    const uniqueIds = [...new Set(ids.map(Number).filter(Number.isInteger))];
    if (uniqueIds.length === 0) return [];
    const rowAdapter = options.knowledgeEntryRow || require('../db.cjs').knowledgeEntryRow;
    const placeholders = uniqueIds.map(() => '?').join(', ');
    return database.prepare(
        `SELECT * FROM knowledge_entries WHERE id IN (${placeholders})`
    ).all(...uniqueIds).map(row => listItemFromRow(row, rowAdapter));
}

function searchableExactValues(item) {
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    const preferredKeys = /(name|model|spec|code|number|no|contract|customer|quotation|order|title|型号|规格|编号|合同|客户|报价|订单)/i;
    return [
        item?.title,
        item?.sourceId,
        ...Object.entries(metadata)
            .filter(([key, value]) => preferredKeys.test(key) && ['string', 'number'].includes(typeof value))
            .map(([, value]) => value),
    ].map(canonicalText).filter(Boolean);
}

function isExactMatch(item, query) {
    const normalizedQuery = canonicalText(query);
    if (normalizedQuery.length < 2) return false;
    return searchableExactValues(item).some(value => (
        value === normalizedQuery || value.includes(normalizedQuery)
    ));
}

function roundScore(value) {
    return Number(value.toFixed(6));
}

function evidenceLevelForMatchMode(matchMode) {
    if (matchMode === 'exact') return 'exact_text';
    if (matchMode === 'vector') return 'semantic_candidate';
    return 'text_match';
}

function decorateKeywordResults(items, query, limit) {
    return items.slice(0, limit).map((item, index) => {
        const exactMatch = isExactMatch(item, query);
        const matchMode = exactMatch ? 'exact' : 'keyword';
        return {
            ...item,
            matchMode,
            evidenceLevel: evidenceLevelForMatchMode(matchMode),
            exactMatch,
            keywordRank: index + 1,
            vectorDistance: null,
            finalScore: roundScore((exactMatch ? 1 : 0) + (1 / (RRF_OFFSET + index + 1))),
        };
    });
}

function mergeCandidates(keywordItems, vectorResults, loadedItems, query, limit) {
    const candidates = new Map();
    const fullItems = new Map([
        ...keywordItems.map(item => [Number(item.id), item]),
        ...loadedItems.map(item => [Number(item.id), item]),
    ]);

    keywordItems.forEach((item, index) => {
        candidates.set(Number(item.id), {
            item,
            keywordRank: index + 1,
            vectorRank: null,
            vectorDistance: null,
        });
    });

    vectorResults.forEach((result, index) => {
        const id = Number(result.id);
        const item = fullItems.get(id);
        if (!item) return;
        const existing = candidates.get(id) || {
            item,
            keywordRank: null,
            vectorRank: null,
            vectorDistance: null,
        };
        existing.vectorRank = index + 1;
        existing.vectorDistance = Number.isFinite(Number(result.vectorDistance))
            ? Number(result.vectorDistance)
            : null;
        candidates.set(id, existing);
    });

    const hasExactKeywordMatch = keywordItems.some(item => isExactMatch(item, query));
    return [...candidates.values()]
        .map(candidate => {
            const exactMatch = isExactMatch(candidate.item, query);
            const keywordScore = candidate.keywordRank
                ? 1 / (RRF_OFFSET + candidate.keywordRank)
                : 0;
            const vectorScore = candidate.vectorRank
                ? 1 / (RRF_OFFSET + candidate.vectorRank)
                : 0;
            const matchMode = exactMatch
                ? 'exact'
                : candidate.keywordRank && candidate.vectorRank
                    ? 'hybrid'
                    : candidate.vectorRank
                        ? 'vector'
                        : 'keyword';
            return {
                ...candidate.item,
                matchMode,
                evidenceLevel: evidenceLevelForMatchMode(matchMode),
                exactMatch,
                keywordRank: candidate.keywordRank,
                vectorDistance: candidate.vectorDistance == null
                    ? null
                    : Number(candidate.vectorDistance.toFixed(6)),
                finalScore: roundScore((exactMatch ? 1 : 0) + keywordScore + vectorScore),
            };
        })
        .filter(item => !hasExactKeywordMatch || item.keywordRank != null)
        .sort((left, right) => (
            right.finalScore - left.finalScore
            || Number(right.exactMatch) - Number(left.exactMatch)
            || (left.keywordRank ?? Number.MAX_SAFE_INTEGER) - (right.keywordRank ?? Number.MAX_SAFE_INTEGER)
            || (left.vectorDistance ?? Number.MAX_SAFE_INTEGER) - (right.vectorDistance ?? Number.MAX_SAFE_INTEGER)
            || left.id - right.id
        ))
        .slice(0, limit);
}

async function searchFactoryKnowledge(params = {}, options = {}) {
    const query = String(params.query || params.keyword || '').trim();
    const limit = normalizeLimit(params.limit ?? 10);
    const candidateLimit = Math.min(50, Math.max(DEFAULT_CANDIDATE_LIMIT, limit * 3));
    const keywordSearch = options.keywordSearch || searchKnowledgeEntries;
    const keywordItems = keywordSearch(
        { ...params, limit: candidateLimit },
        options.keywordOptions
    );
    const enabled = options.enabled ?? envBoolean(process.env.KNOWLEDGE_HYBRID_SEARCH_ENABLED, true);
    const provider = options.provider || embeddingProvider;

    if (!query || !enabled) {
        return decorateRelevantChunks(
            decorateKeywordResults(keywordItems, query, limit),
            query,
            options
        );
    }

    const vectorSearch = options.vectorSearch || searchStoredEmbeddings;
    const itemLoader = options.itemLoader || loadKnowledgeItems;
    const logger = options.logger || createLogger('knowledge-hybrid-search');

    try {
        const status = provider.getStatus();
        if (!status.enabled) {
            return decorateRelevantChunks(
                decorateKeywordResults(keywordItems, query, limit),
                query,
                options
            );
        }
        const queryVector = await provider.embedQuery(query);
        const database = options.db || require('../db.cjs').db;
        const vectorResult = vectorSearch(database, queryVector, {
            model: status.model,
            dimensions: status.dimensions,
            limit: candidateLimit,
            entryType: params.entryType || params.type,
            sourceTable: params.sourceTable,
        });
        if (!vectorResult.extension?.available) {
            throw new Error(vectorResult.extension?.error || 'sqlite-vec 不可用');
        }
        const vectorIds = vectorResult.results.map(item => item.id);
        const knownIds = new Set(keywordItems.map(item => Number(item.id)));
        const missingIds = vectorIds.filter(id => !knownIds.has(Number(id)));
        const loadedItems = itemLoader(database, missingIds);
        return decorateRelevantChunks(
            mergeCandidates(keywordItems, vectorResult.results, loadedItems, query, limit),
            query,
            options
        );
    } catch (error) {
        logger.warn('向量查询失败，已自动回退到 FTS/LIKE', {
            error: String(error?.message || error),
        });
        return decorateRelevantChunks(
            decorateKeywordResults(keywordItems, query, limit),
            query,
            options
        );
    }
}

module.exports = {
    canonicalText,
    decorateKeywordResults,
    decorateRelevantChunks,
    evidenceLevelForMatchMode,
    isExactMatch,
    loadKnowledgeItems,
    mergeCandidates,
    searchFactoryKnowledge,
};
