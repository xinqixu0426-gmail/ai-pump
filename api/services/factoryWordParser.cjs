const WordExtractor = require('word-extractor');

const MAX_WORD_TEXT_CHARS = 200_000;

function cleanSection(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\t\u00a0]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function parseWordBuffer(buffer, options = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('Word 文件内容为空');
    }
    const extractor = options.extractor || new WordExtractor();
    const document = await extractor.extract(buffer);
    const sections = [
        ['正文', document.getBody()],
        ['页眉页脚', document.getHeaders()],
        ['脚注', document.getFootnotes()],
        ['尾注', document.getEndnotes()],
        ['批注', document.getAnnotations()],
        ['文本框', document.getTextboxes()],
    ].map(([title, value]) => [title, cleanSection(value)])
        .filter(([, value]) => value);
    const fullText = sections
        .map(([title, value]) => `【${title}】\n${value}`)
        .join('\n\n');
    const truncated = fullText.length > MAX_WORD_TEXT_CHARS;
    const extractedText = fullText.slice(0, MAX_WORD_TEXT_CHARS);
    return {
        parserStatus: extractedText ? 'parsed' : 'metadata_only',
        extractedText,
        parsed: {
            version: 'word-v1',
            parser: 'word-extractor',
            sectionCount: sections.length,
            paragraphCount: extractedText
                ? extractedText.split(/\n+/).filter(Boolean).length
                : 0,
            truncated,
            requiresOcr: false,
        },
    };
}

module.exports = {
    MAX_WORD_TEXT_CHARS,
    parseWordBuffer,
};
