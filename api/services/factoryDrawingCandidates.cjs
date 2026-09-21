const REVIEW_CONFIDENCE = 85;
const MAX_CANDIDATES = 100;

function text(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function round(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    const factor = 10 ** digits;
    return Math.round(number * factor) / factor;
}

function candidate(type, label, value, unit, match, source) {
    const confidence = round(source.confidence);
    return {
        type,
        label,
        value,
        unit,
        rawText: text(match[0]),
        confidence,
        needsReview: confidence < REVIEW_CONFIDENCE,
        source: {
            pageNumber: Number(source.pageNumber || 1),
            lineNumber: Number(source.lineNumber || 0),
            bbox: source.bbox || null,
            lineText: text(source.text),
        },
    };
}

const PATTERNS = [
    {
        type: 'diameter',
        label: '直径',
        regex: /(?:[ΦφØ⌀]|(?:直径|diameter)\s*[:：]?\s*[ΦφØ⌀$]?)\s*(\d+(?:\.\d+)?)\s*(mm|毫米)?/giu,
        value: match => match[1],
        unit: match => match[2] || 'mm',
    },
    {
        type: 'dimension',
        label: '尺寸',
        regex: /(?<![Mｍ])(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?\s*(mm|毫米)?/giu,
        value: match => [match[1], match[2], match[3]].filter(Boolean).join('×'),
        unit: match => match[4] || 'mm',
    },
    {
        type: 'thread',
        label: '螺纹',
        regex: /\bM\s*(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?\b/giu,
        value: match => `M${match[1]}${match[2] ? `×${match[2]}` : ''}`,
        unit: () => '',
    },
    {
        type: 'bearing_model',
        label: '轴承型号',
        regex: /(?:轴承(?:型号)?\s*[:：]?\s*)?\b((?:60|62|63)\d{2}(?:[-/][A-Z0-9]+)?)\b(?!\s*(?:r\/?min|rpm|转\/分))/giu,
        value: match => match[1],
        unit: () => '',
    },
    {
        type: 'voltage',
        label: '电压',
        regex: /(\d+(?:\.\d+)?)\s*(V|伏)\b/giu,
        value: match => match[1],
        unit: () => 'V',
    },
    {
        type: 'frequency',
        label: '频率',
        regex: /(\d+(?:\.\d+)?)\s*(Hz|赫兹)\b/giu,
        value: match => match[1],
        unit: () => 'Hz',
    },
    {
        type: 'power',
        label: '功率',
        regex: /(\d+(?:\.\d+)?)\s*(kW|W|千瓦|瓦)\b/giu,
        value: match => match[1],
        unit: match => /^(?:kw|千瓦)$/iu.test(match[2]) ? 'kW' : 'W',
    },
    {
        type: 'current',
        label: '电流',
        regex: /(\d+(?:\.\d+)?)\s*(A|安)\b/giu,
        value: match => match[1],
        unit: () => 'A',
    },
    {
        type: 'speed',
        label: '转速',
        regex: /(\d+(?:\.\d+)?)\s*(?:r\/?min|rpm|转\/分)\b/giu,
        value: match => match[1],
        unit: () => 'r/min',
    },
];

function extractDrawingCandidates(pages, options = {}) {
    const limit = Math.max(1, Number(options.limit) || MAX_CANDIDATES);
    const candidates = [];
    const seen = new Set();

    for (const page of Array.isArray(pages) ? pages : []) {
        for (const line of Array.isArray(page.lines) ? page.lines : []) {
            const lineText = text(line.text);
            if (!lineText) continue;
            const source = {
                ...line,
                text: lineText,
                pageNumber: page.pageNumber,
            };
            for (const pattern of PATTERNS) {
                pattern.regex.lastIndex = 0;
                let match = pattern.regex.exec(lineText);
                while (match) {
                    const prefix = lineText.slice(Math.max(0, match.index - 4), match.index);
                    if (pattern.type === 'dimension' && /M\s*$/iu.test(prefix)) {
                        match = pattern.regex.exec(lineText);
                        continue;
                    }
                    const item = candidate(
                        pattern.type,
                        pattern.label,
                        pattern.value(match),
                        pattern.unit(match),
                        match,
                        source
                    );
                    const key = [
                        item.type,
                        item.value,
                        item.unit,
                        item.source.pageNumber,
                        item.source.lineNumber,
                    ].join('|');
                    if (!seen.has(key)) {
                        seen.add(key);
                        candidates.push(item);
                        if (candidates.length >= limit) return candidates;
                    }
                    match = pattern.regex.exec(lineText);
                }
            }
        }
    }
    return candidates;
}

module.exports = {
    MAX_CANDIDATES,
    REVIEW_CONFIDENCE,
    extractDrawingCandidates,
};
