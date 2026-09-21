const {
    estimateTextTokens,
    fitTextToTokenBudget,
} = require('./aiTokenBudget.cjs');

const DEFAULT_CHUNK_TOKENS = 700;
const DEFAULT_OVERLAP_TOKENS = 80;

function queryTerms(query) {
    const normalized = String(query || '').normalize('NFKC').toLocaleLowerCase('zh-CN');
    const terms = new Set(normalized.match(/[a-z0-9_]+|[\p{Script=Han}]{2,}/gu) || []);
    for (const sequence of normalized.match(/[\p{Script=Han}]{3,}/gu) || []) {
        for (let index = 0; index < sequence.length - 1; index += 1) {
            terms.add(sequence.slice(index, index + 2));
        }
    }
    return [...terms].filter(term => term.length >= 2).slice(0, 40);
}

function chunkText(value, options = {}) {
    const source = String(value || '');
    if (!source) return [];
    const maxChunkTokens = Math.max(64, Number(options.maxChunkTokens) || DEFAULT_CHUNK_TOKENS);
    const overlapTokens = Math.min(
        Math.max(0, Number(options.overlapTokens) || DEFAULT_OVERLAP_TOKENS),
        Math.floor(maxChunkTokens / 3)
    );
    const characters = [...source];
    const chunks = [];
    const tokenWeight = character => {
        if (/\s/u.test(character)) return 0;
        if (/[A-Za-z0-9_]/.test(character)) return 0.25;
        return 1;
    };
    let start = 0;
    while (start < characters.length) {
        let end = start;
        let estimatedWeight = 0;
        while (end < characters.length) {
            const nextWeight = tokenWeight(characters[end]);
            if (end > start && estimatedWeight + nextWeight > maxChunkTokens) break;
            estimatedWeight += nextWeight;
            end += 1;
        }
        if (end === start) end += 1;
        const content = characters.slice(start, end).join('');
        chunks.push({
            chunkIndex: chunks.length,
            charStart: start,
            charEnd: end,
            content,
            estimatedTokens: estimateTextTokens(content),
        });
        if (end >= characters.length) break;
        if (overlapTokens === 0) {
            start = end;
            continue;
        }
        let overlapStart = end;
        let overlapWeight = 0;
        while (overlapStart > start) {
            const nextWeight = tokenWeight(characters[overlapStart - 1]);
            if (overlapStart < end && overlapWeight + nextWeight > overlapTokens) break;
            overlapWeight += nextWeight;
            overlapStart -= 1;
        }
        start = Math.max(start + 1, overlapStart);
    }
    return chunks;
}

function scoreChunk(chunk, query, terms) {
    const haystack = String(chunk.content || '').normalize('NFKC').toLocaleLowerCase('zh-CN');
    const phrase = String(query || '').normalize('NFKC').toLocaleLowerCase('zh-CN').trim();
    let score = phrase.length >= 2 && haystack.includes(phrase) ? 100 : 0;
    for (const term of terms) {
        let offset = 0;
        let occurrences = 0;
        while (occurrences < 5) {
            const found = haystack.indexOf(term, offset);
            if (found < 0) break;
            occurrences += 1;
            offset = found + term.length;
        }
        score += occurrences * Math.min(12, term.length + 2);
    }
    return score;
}

function selectRelevantTextChunks(value, query, options = {}) {
    const maxTokens = Math.max(0, Math.trunc(Number(options.maxTokens) || 0));
    const maxChunks = Math.max(1, Math.min(Math.trunc(Number(options.maxChunks) || 6), 20));
    if (maxTokens === 0) return [];
    const terms = queryTerms(query);
    const ranked = chunkText(value, options)
        .map(chunk => ({ ...chunk, relevanceScore: scoreChunk(chunk, query, terms) }))
        .sort((left, right) => (
            right.relevanceScore - left.relevanceScore
            || left.chunkIndex - right.chunkIndex
        ));
    const selected = [];
    let usedTokens = 0;
    for (const chunk of ranked) {
        if (selected.length >= maxChunks || usedTokens >= maxTokens) break;
        const remaining = maxTokens - usedTokens;
        const fitted = fitTextToTokenBudget(chunk.content, remaining);
        if (!fitted.text) continue;
        selected.push({
            chunkIndex: chunk.chunkIndex,
            charStart: chunk.charStart,
            charEnd: chunk.charStart + [...fitted.text].length,
            content: fitted.text,
            estimatedTokens: fitted.tokens,
            relevanceScore: chunk.relevanceScore,
        });
        usedTokens += fitted.tokens;
    }
    return selected;
}

function formatRelevantTextChunks(chunks = []) {
    return chunks.map(chunk => (
        `[片段 ${chunk.chunkIndex + 1}，字符 ${chunk.charStart}-${chunk.charEnd}]\n${chunk.content}`
    )).join('\n\n');
}

module.exports = {
    DEFAULT_CHUNK_TOKENS,
    DEFAULT_OVERLAP_TOKENS,
    chunkText,
    formatRelevantTextChunks,
    queryTerms,
    selectRelevantTextChunks,
};
