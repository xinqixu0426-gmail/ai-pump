const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createCanvas,
    loadImage,
    PDFDocument,
} = require('@napi-rs/canvas');
const { extractDrawingCandidates } = require('../api/services/factoryDrawingCandidates.cjs');
const { parsePdfWithOcr } = require('../api/services/factoryFileParser.cjs');
const {
    disposeOcrWorker,
    parseImageBuffer,
} = require('../api/services/factoryOcrParser.cjs');

test.after(async () => {
    await disposeOcrWorker();
});

function buildTechnicalImage() {
    const canvas = createCanvas(1600, 600);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111111';
    context.font = 'bold 72px sans-serif';
    context.fillText('PUMP DRAWING', 70, 120);
    context.font = '60px sans-serif';
    context.fillText('Voltage: 220V  Frequency: 60Hz', 70, 270);
    context.fillText('Diameter: 35 mm', 70, 410);
    return canvas.toBuffer('image/png');
}

async function buildScannedPdf() {
    const image = await loadImage(buildTechnicalImage());
    const document = new PDFDocument();
    const context = document.beginPage(800, 300);
    context.drawImage(image, 0, 0, 800, 300);
    document.endPage();
    return document.close();
}

test('V9.4 图纸候选：保留原文、页码、坐标和低置信度复核标记', () => {
    const candidates = extractDrawingCandidates([{
        pageNumber: 2,
        lines: [{
            lineNumber: 7,
            text: '轴承 6203  直径 Φ35 mm  螺纹 M8×1.25',
            confidence: 72,
            bbox: { x: 10, y: 20, width: 300, height: 20 },
        }],
    }]);

    assert.ok(candidates.some(item => item.type === 'bearing_model' && item.value === '6203'));
    assert.ok(candidates.some(item => item.type === 'diameter' && item.value === '35'));
    assert.ok(candidates.some(item => item.type === 'thread' && item.value === 'M8×1.25'));
    assert.ok(candidates.every(item => item.needsReview));
    assert.ok(candidates.every(item => item.source.pageNumber === 2));
    assert.ok(candidates.every(item => item.source.lineNumber === 7));
    assert.equal(extractDrawingCandidates([{
        pageNumber: 1,
        lines: [{ lineNumber: 1, text: '转速 6000 rpm', confidence: 95 }],
    }]).some(item => item.type === 'bearing_model'), false);
});

test('V9.4 图片 OCR：离线识别英文数字并生成可追溯参数候选', async () => {
    const result = await parseImageBuffer(buildTechnicalImage());

    assert.equal(result.parserStatus, 'parsed');
    assert.equal(result.parsed.version, 'image-ocr-v1');
    assert.equal(result.parsed.ocrApplied, true);
    assert.equal(result.parsed.requiresOcr, false);
    assert.match(result.extractedText, /220V/);
    assert.ok(result.parsed.confidence > 0);
    assert.ok(result.parsed.drawingCandidates.some(
        item => item.type === 'voltage' && item.value === '220'
    ));
});

test('V9.4 扫描 PDF：渲染扫描页、执行 OCR 并保留页码', async () => {
    const result = await parsePdfWithOcr(await buildScannedPdf());

    assert.equal(result.parserStatus, 'parsed');
    assert.equal(result.parsed.version, 'pdf-ocr-v1');
    assert.equal(result.parsed.ocrApplied, true);
    assert.deepEqual(result.parsed.ocrPageNumbers, [1]);
    assert.match(result.extractedText, /【第 1 页 OCR】/);
    assert.match(result.extractedText, /60Hz/);
    assert.equal(result.parsed.pages[0].source, 'ocr');
});
