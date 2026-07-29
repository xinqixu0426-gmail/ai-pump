const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const Tesseract = require('tesseract.js');
const chiSimData = require('@tesseract.js-data/chi_sim');
const engData = require('@tesseract.js-data/eng');
const { extractDrawingCandidates } = require('./factoryDrawingCandidates.cjs');

const MAX_OCR_PAGES = 12;
const MAX_OCR_CHARS = 300_000;
const MAX_RENDER_PIXELS = 7_000_000;
const MAX_SOURCE_PIXELS = 40_000_000;
const OCR_RENDER_SCALE = 2;
const OCR_VERSION = 'ocr-v1';

let pdfJsPromise = null;
let workerPromise = null;
let workerQueue = Promise.resolve();

function text(value) {
    return String(value ?? '').replace(/\u0000/g, '').trim();
}

function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(number(value) * factor) / factor;
}

function packageAssetUrl(folder) {
    const packageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
    return pathToFileURL(`${path.join(packageRoot, folder)}${path.sep}`).href;
}

function loadPdfJs() {
    if (!pdfJsPromise) {
        const moduleUrl = pathToFileURL(
            require.resolve('pdfjs-dist/legacy/build/pdf.mjs')
        ).href;
        pdfJsPromise = import(moduleUrl);
    }
    return pdfJsPromise;
}

function ensureLanguagePath() {
    const target = path.join(os.tmpdir(), 'pump-factory-ocr-langs-v1');
    fs.mkdirSync(target, { recursive: true });
    for (const language of [chiSimData, engData]) {
        const source = path.join(language.langPath, `${language.code}.traineddata.gz`);
        const destination = path.join(target, `${language.code}.traineddata.gz`);
        if (!fs.existsSync(destination) || fs.statSync(destination).size !== fs.statSync(source).size) {
            fs.copyFileSync(source, destination);
        }
    }
    return target;
}

async function getWorker() {
    if (!workerPromise) {
        workerPromise = Tesseract.createWorker(
            ['chi_sim', 'eng'],
            Tesseract.OEM.LSTM_ONLY,
            {
                langPath: ensureLanguagePath(),
                gzip: true,
                cacheMethod: 'none',
            }
        ).then(async worker => {
            await worker.setParameters({
                tessedit_pageseg_mode: Tesseract.PSM.AUTO,
                preserve_interword_spaces: '1',
                user_defined_dpi: '300',
            });
            return worker;
        }).catch(error => {
            workerPromise = null;
            throw error;
        });
    }
    return workerPromise;
}

function runWorkerJob(job) {
    const current = workerQueue.then(async () => job(await getWorker()));
    workerQueue = current.catch(() => {});
    return current;
}

async function disposeOcrWorker() {
    await workerQueue.catch(() => {});
    if (!workerPromise) return;
    const worker = await workerPromise.catch(() => null);
    workerPromise = null;
    if (worker) await worker.terminate();
}

function scaleForDimensions(width, height, options = {}) {
    const maxPixels = Math.max(100_000, Number(options.maxPixels) || MAX_RENDER_PIXELS);
    const sourcePixels = Math.max(1, width * height);
    if (sourcePixels > MAX_SOURCE_PIXELS) {
        throw new Error('图片像素过大，请压缩到 4000 万像素以内后重试');
    }
    const minWidthScale = width < 1200 ? Math.min(2, 1200 / Math.max(1, width)) : 1;
    const pixelScale = Math.min(1, Math.sqrt(maxPixels / sourcePixels));
    return Math.min(minWidthScale, pixelScale);
}

async function normalizeImageBuffer(buffer, options = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('图片内容为空');
    let image;
    try {
        image = await loadImage(buffer);
    } catch {
        throw new Error('图片内容无效或已损坏');
    }
    const width = Number(image.width || 0);
    const height = Number(image.height || 0);
    if (!width || !height) throw new Error('无法读取图片尺寸');
    const scale = scaleForDimensions(width, height, options);
    const outputWidth = Math.max(1, Math.round(width * scale));
    const outputHeight = Math.max(1, Math.round(height * scale));
    const canvas = createCanvas(outputWidth, outputHeight);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, outputWidth, outputHeight);
    return {
        buffer: canvas.toBuffer('image/png'),
        width: outputWidth,
        height: outputHeight,
        sourceWidth: width,
        sourceHeight: height,
        resized: outputWidth !== width || outputHeight !== height,
    };
}

function bbox(value) {
    if (!value) return null;
    return {
        x: round(value.x0),
        y: round(value.y0),
        width: round(Math.max(0, number(value.x1) - number(value.x0))),
        height: round(Math.max(0, number(value.y1) - number(value.y0))),
    };
}

function ocrLines(data) {
    const lines = [];
    for (const block of Array.isArray(data?.blocks) ? data.blocks : []) {
        for (const paragraph of Array.isArray(block.paragraphs) ? block.paragraphs : []) {
            for (const line of Array.isArray(paragraph.lines) ? paragraph.lines : []) {
                const lineText = text(line.text);
                if (!lineText) continue;
                lines.push({
                    lineNumber: lines.length + 1,
                    text: lineText,
                    confidence: round(line.confidence),
                    bbox: bbox(line.bbox),
                    words: (Array.isArray(line.words) ? line.words : [])
                        .map(word => ({
                            text: text(word.text),
                            confidence: round(word.confidence),
                            bbox: bbox(word.bbox),
                        }))
                        .filter(word => word.text),
                });
            }
        }
    }
    if (lines.length === 0) {
        for (const lineText of text(data?.text).split(/\r?\n/).map(text).filter(Boolean)) {
            lines.push({
                lineNumber: lines.length + 1,
                text: lineText,
                confidence: round(data?.confidence),
                bbox: null,
                words: [],
            });
        }
    }
    return lines;
}

async function recognizeImage(buffer, options = {}) {
    const normalized = options.normalized
        ? {
            buffer,
            width: Number(options.width || 0),
            height: Number(options.height || 0),
            sourceWidth: Number(options.sourceWidth || options.width || 0),
            sourceHeight: Number(options.sourceHeight || options.height || 0),
            resized: false,
        }
        : await normalizeImageBuffer(buffer, options);
    const recognizer = options.recognizer || (image => runWorkerJob(
        worker => worker.recognize(image, { rotateAuto: true }, { text: true, blocks: true })
    ));
    const result = await recognizer(normalized.buffer);
    const data = result?.data || result || {};
    const lines = ocrLines(data);
    return {
        text: lines.map(line => line.text).join('\n').trim(),
        confidence: round(data.confidence),
        lines,
        image: {
            width: normalized.width,
            height: normalized.height,
            sourceWidth: normalized.sourceWidth,
            sourceHeight: normalized.sourceHeight,
            resized: normalized.resized,
        },
    };
}

async function renderPdfPages(buffer, options = {}) {
    const pdfjs = options.pdfjs || await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        disableWorker: true,
        isEvalSupported: false,
        useSystemFonts: true,
        cMapUrl: packageAssetUrl('cmaps'),
        cMapPacked: true,
        standardFontDataUrl: packageAssetUrl('standard_fonts'),
        wasmUrl: packageAssetUrl('wasm'),
    });
    let document = null;
    try {
        document = await loadingTask.promise;
        const requested = Array.isArray(options.pageNumbers)
            ? options.pageNumbers.map(Number).filter(page => page >= 1 && page <= document.numPages)
            : Array.from({ length: document.numPages }, (_, index) => index + 1);
        const pageNumbers = [...new Set(requested)].slice(
            0,
            Math.max(1, Number(options.maxPages) || MAX_OCR_PAGES)
        );
        const rendered = [];
        for (const pageNumber of pageNumbers) {
            const page = await document.getPage(pageNumber);
            const baseViewport = page.getViewport({ scale: OCR_RENDER_SCALE });
            const pixelScale = Math.min(
                1,
                Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, baseViewport.width * baseViewport.height))
            );
            const viewport = page.getViewport({ scale: OCR_RENDER_SCALE * pixelScale });
            const width = Math.max(1, Math.ceil(viewport.width));
            const height = Math.max(1, Math.ceil(viewport.height));
            const canvas = createCanvas(width, height);
            const context = canvas.getContext('2d');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
            await page.render({
                canvasContext: context,
                viewport,
                canvas,
                background: '#ffffff',
            }).promise;
            rendered.push({
                pageNumber,
                width,
                height,
                buffer: canvas.toBuffer('image/png'),
            });
            page.cleanup();
        }
        return {
            totalPages: Number(document.numPages || 0),
            pages: rendered,
            truncated: requested.length > pageNumbers.length,
        };
    } finally {
        if (document) await document.destroy();
        else if (loadingTask?.destroy) await loadingTask.destroy();
    }
}

function buildOcrResult(pages, metadata = {}) {
    const maxChars = Math.max(1, Number(metadata.maxChars) || MAX_OCR_CHARS);
    const outputPages = [];
    const sections = [];
    let usedChars = 0;
    let truncated = Boolean(metadata.truncated);
    for (const page of pages) {
        const header = metadata.kind === 'image' ? '【图片 OCR】' : `【第 ${page.pageNumber} 页 OCR】`;
        const remaining = maxChars - usedChars;
        if (remaining <= 0) {
            truncated = true;
            break;
        }
        const pageText = page.text.slice(0, remaining);
        if (pageText.length < page.text.length) truncated = true;
        usedChars += pageText.length;
        outputPages.push({
            pageNumber: page.pageNumber,
            width: page.image.width,
            height: page.image.height,
            sourceWidth: page.image.sourceWidth,
            sourceHeight: page.image.sourceHeight,
            confidence: page.confidence,
            text: pageText,
            lines: page.lines,
        });
        if (pageText) sections.push(`${header}\n${pageText}`);
    }
    const extractedText = sections.join('\n\n').trim();
    const candidates = extractDrawingCandidates(outputPages);
    const confidence = outputPages.length
        ? round(outputPages.reduce((sum, page) => sum + page.confidence, 0) / outputPages.length)
        : 0;
    return {
        parserStatus: extractedText ? 'parsed' : 'metadata_only',
        extractedText,
        parsed: {
            version: metadata.version,
            parser: `tesseract.js@${require('tesseract.js/package.json').version}`,
            pageCount: Number(metadata.pageCount || outputPages.length),
            parsedPageCount: outputPages.length,
            truncated,
            requiresOcr: false,
            noTextDetected: !extractedText,
            ocrApplied: true,
            confidence,
            needsReview: confidence < 85 || candidates.some(item => item.needsReview),
            pages: outputPages,
            drawingCandidates: candidates,
            drawingCandidateCount: candidates.length,
            tableCount: 0,
        },
    };
}

async function parseImageBuffer(buffer, options = {}) {
    const page = await recognizeImage(buffer, options);
    return buildOcrResult([{ pageNumber: 1, ...page }], {
        kind: 'image',
        version: 'image-ocr-v1',
        pageCount: 1,
        maxChars: options.maxChars,
    });
}

async function parseScannedPdfBuffer(buffer, options = {}) {
    const rendered = options.rendered || await renderPdfPages(buffer, options);
    const pages = [];
    for (const page of rendered.pages) {
        pages.push({
            pageNumber: page.pageNumber,
            ...await recognizeImage(page.buffer, {
                ...options,
                normalized: true,
                width: page.width,
                height: page.height,
                sourceWidth: page.width,
                sourceHeight: page.height,
            }),
        });
    }
    return buildOcrResult(pages, {
        kind: 'pdf',
        version: 'pdf-ocr-v1',
        pageCount: rendered.totalPages,
        truncated: rendered.truncated,
        maxChars: options.maxChars,
    });
}

module.exports = {
    MAX_OCR_CHARS,
    MAX_OCR_PAGES,
    OCR_VERSION,
    buildOcrResult,
    disposeOcrWorker,
    normalizeImageBuffer,
    parseImageBuffer,
    parseScannedPdfBuffer,
    recognizeImage,
    renderPdfPages,
};
