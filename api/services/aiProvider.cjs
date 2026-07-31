const {
    getFactoryFile,
    getFactoryFileBlob,
    getFactoryFileContent,
} = require('./factoryFileStore.cjs');

const MAX_CHAT_ATTACHMENTS = 4;
const MAX_INLINE_TEXT_BYTES = 100 * 1024;
const MAX_VISION_BYTES = 20 * 1024 * 1024;

function text(value) {
    return String(value ?? '').trim();
}

function booleanEnv(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveProviderConfig(provider, env = process.env) {
    if (provider === 'kimi') {
        const model = text(env.KIMI_MODEL) || 'kimi-k2.7-code';
        return {
            provider,
            displayName: 'Kimi 开放平台',
            apiKey: text(env.KIMI_API_KEY || env.MOONSHOT_API_KEY),
            baseUrl: (text(env.KIMI_BASE_URL) || 'https://api.moonshot.cn/v1').replace(/\/+$/, ''),
            model,
            supportsImages: booleanEnv(env.AI_VISION_ENABLED, /kimi-k2\.(?:5|6|7)|kimi-k3|vision/i.test(model)),
        };
    }
    if (provider !== 'deepseek') {
        throw new Error(`不支持的 AI_PROVIDER: ${provider}`);
    }
    return {
        provider: 'deepseek',
        displayName: 'DeepSeek',
        apiKey: text(env.DEEPSEEK_API_KEY),
        baseUrl: (text(env.DEEPSEEK_BASE_URL) || 'https://api.deepseek.com').replace(/\/+$/, ''),
        model: text(env.DEEPSEEK_MODEL) || 'deepseek-v4-flash',
        supportsImages: false,
    };
}

function resolveAiProviderConfig(env = process.env) {
    const mode = text(env.AI_PROVIDER).toLowerCase() || 'deepseek';
    if (mode === 'auto') {
        return {
            ...resolveProviderConfig('deepseek', env),
            routingMode: 'auto',
            routeReason: 'default',
        };
    }
    return resolveProviderConfig(mode, env);
}

function messageAttachmentIds(messages) {
    const ids = [];
    for (const message of Array.isArray(messages) ? messages : []) {
        if (message?.role !== 'user') continue;
        for (const id of normalizeAttachmentIds(message.attachments)) {
            if (!ids.includes(id)) ids.push(id);
        }
    }
    return ids;
}

function requiresVisionProvider(messages, options = {}) {
    const dbAccessors = options.dbAccessors;
    return messageAttachmentIds(messages).some((id) => {
        const file = getFactoryFile(id, { dbAccessors });
        return file?.detectedType === 'image';
    });
}

function resolveAiProviderRoute(messages, options = {}) {
    const env = options.env || process.env;
    const mode = text(env.AI_PROVIDER).toLowerCase() || 'deepseek';
    if (mode !== 'auto') return resolveProviderConfig(mode, env);

    const deepseek = resolveProviderConfig('deepseek', env);
    const needsVision = requiresVisionProvider(messages, options);
    if (!needsVision) {
        return {
            ...deepseek,
            routingMode: 'auto',
            routeReason: 'default',
        };
    }

    const kimi = resolveProviderConfig('kimi', env);
    if (kimi.apiKey && kimi.supportsImages) {
        return {
            ...kimi,
            routingMode: 'auto',
            routeReason: 'image',
        };
    }
    return {
        ...deepseek,
        routingMode: 'auto',
        routeReason: 'vision_unavailable',
    };
}

function aiProviderCapabilities(env = process.env) {
    const mode = text(env.AI_PROVIDER).toLowerCase() || 'deepseek';
    if (mode === 'auto') {
        const deepseek = resolveProviderConfig('deepseek', env);
        const kimi = resolveProviderConfig('kimi', env);
        const visionAvailable = Boolean(kimi.apiKey && kimi.supportsImages);
        return {
            provider: 'auto',
            displayName: '智能路由',
            model: `${deepseek.model} / ${kimi.model}`,
            supportsImages: visionAvailable,
            supportsFiles: true,
            acceptedFileTypes: ['pdf', 'spreadsheet', 'image', 'text'],
            maxAttachments: MAX_CHAT_ATTACHMENTS,
            maxFileSize: 10 * 1024 * 1024,
            defaultProvider: 'deepseek',
            visionProvider: visionAvailable ? 'kimi' : null,
        };
    }
    const config = resolveAiProviderConfig(env);
    return {
        provider: config.provider,
        displayName: config.displayName,
        model: config.model,
        supportsImages: config.supportsImages,
        supportsFiles: true,
        acceptedFileTypes: ['pdf', 'spreadsheet', 'image', 'text'],
        maxAttachments: MAX_CHAT_ATTACHMENTS,
        maxFileSize: 10 * 1024 * 1024,
    };
}

function normalizeAttachmentIds(attachments) {
    if (!Array.isArray(attachments)) return [];
    const unique = [];
    for (const attachment of attachments) {
        const id = Number(attachment?.id ?? attachment?.fileId);
        if (!Number.isSafeInteger(id) || id <= 0 || unique.includes(id)) continue;
        unique.push(id);
        if (unique.length >= MAX_CHAT_ATTACHMENTS) break;
    }
    return unique;
}

function attachmentNote(file, note) {
    return `附件《${file.originalName}》（统一文件ID ${file.id}，${file.detectedType}，${file.fileSize} 字节）：${note}`;
}

function truncateUtf8(value, maxBytes) {
    const source = Buffer.from(String(value || ''), 'utf8');
    if (source.length <= maxBytes) return { text: source.toString('utf8'), truncated: false };
    let end = Math.max(0, maxBytes);
    while (end > 0 && (source[end] & 0xc0) === 0x80) end -= 1;
    return { text: source.subarray(0, end).toString('utf8'), truncated: true };
}

function ocrCandidateNote(content) {
    const candidates = Array.isArray(content?.parsed?.drawingCandidates)
        ? content.parsed.drawingCandidates.slice(0, 30)
        : [];
    if (candidates.length === 0) return '';
    return [
        '【OCR 技术参数候选】',
        ...candidates.map(item => {
            const source = item.source || {};
            const location = content.parsed?.pageCount > 1
                ? `第 ${source.pageNumber || 1} 页第 ${source.lineNumber || '?'} 行`
                : `图片第 ${source.lineNumber || '?'} 行`;
            return `- ${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ''}；置信度 ${Number(item.confidence || 0)}%；来源 ${location}；${item.needsReview ? '需要人工复核' : '仍作为候选，不自动写入'}`;
        }),
    ].join('\n');
}

function prepareAiProviderMessages(messages, options = {}) {
    const config = options.config || resolveAiProviderConfig();
    const dbAccessors = options.dbAccessors;
    let visionBytes = 0;
    let inlineTextBytes = 0;

    return (Array.isArray(messages) ? messages : []).map((message) => {
        if (message?.role !== 'user') {
            const { attachments: _attachments, ...plainMessage } = message || {};
            return plainMessage;
        }

        const attachmentIds = normalizeAttachmentIds(message.attachments);
        if (attachmentIds.length === 0) {
            const { attachments: _attachments, ...plainMessage } = message;
            return plainMessage;
        }

        const notes = [];
        const imageParts = [];
        for (const id of attachmentIds) {
            const file = getFactoryFile(id, { dbAccessors });
            const blob = file ? getFactoryFileBlob(id, { dbAccessors }) : null;
            if (!file || !blob?.file_blob) {
                notes.push(`附件 #${id} 已不存在，不能读取。`);
                continue;
            }

            if (file.detectedType === 'image') {
                const content = getFactoryFileContent(id, { dbAccessors });
                if (content?.parserStatus === 'parsed' && content.parsedText) {
                    const remaining = Math.max(0, MAX_INLINE_TEXT_BYTES - inlineTextBytes);
                    if (remaining > 0) {
                        const clipped = truncateUtf8(content.parsedText, remaining);
                        inlineTextBytes += Buffer.byteLength(clipped.text, 'utf8');
                        const candidateCount = Number(content.parsed?.drawingCandidateCount || 0);
                        notes.push([
                            attachmentNote(
                                file,
                                `以下是本地 OCR 结果${candidateCount ? `，包含 ${candidateCount} 个可追溯技术参数候选` : ''}。OCR 结果可能有误，低置信度内容必须请用户核对，不得自动写入技术档案。`
                            ),
                            clipped.text,
                            ocrCandidateNote(content),
                        ].join('\n'));
                    }
                } else if (content?.parserStatus === 'metadata_only' && content.parsed?.ocrApplied) {
                    notes.push(attachmentNote(file, '本地 OCR 已执行，但没有识别到可靠文字；不得推断图片参数。'));
                } else if (content?.parserStatus === 'failed') {
                    notes.push(attachmentNote(file, `图片 OCR 失败：${content.parserError || '未知错误'}`));
                } else {
                    notes.push(attachmentNote(file, '图片尚未完成 OCR。'));
                }
                if (!config.supportsImages) {
                    notes.push(attachmentNote(file, `${config.displayName} 不支持直接识图，本轮仅使用上述本地 OCR 文字。`));
                } else if (visionBytes + blob.file_blob.length > MAX_VISION_BYTES) {
                    notes.push(attachmentNote(file, '图片总大小超过本轮视觉输入上限，文件已保存但本轮未传入模型。'));
                } else {
                    visionBytes += blob.file_blob.length;
                    imageParts.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${file.mimeType};base64,${blob.file_blob.toString('base64')}`,
                        },
                    });
                    notes.push(attachmentNote(file, '原图已传入当前多模态模型；回答仍须区分原图观察与 OCR 候选。'));
                }
                continue;
            }

            if (file.detectedType === 'pdf') {
                const content = getFactoryFileContent(id, { dbAccessors });
                if (content?.parserStatus === 'parsed' && content.parsedText) {
                    const remaining = Math.max(0, MAX_INLINE_TEXT_BYTES - inlineTextBytes);
                    if (remaining === 0) {
                        notes.push(attachmentNote(file, '本轮附件文字总量已达到上限，PDF 内容未继续加入模型上下文。'));
                        continue;
                    }
                    const clipped = truncateUtf8(content.parsedText, remaining);
                    inlineTextBytes += Buffer.byteLength(clipped.text, 'utf8');
                    const isOcr = Boolean(content.parsed?.ocrApplied);
                    notes.push([
                        attachmentNote(
                            file,
                            clipped.truncated
                                ? `以下是按页码提取的部分${isOcr ? '解析内容（含 OCR）' : '文字层内容'}，超出本轮上限的内容已截断。`
                                : `以下是按页码提取的 PDF ${isOcr ? '解析内容（含 OCR）' : '文字层内容'}。`
                        ),
                        clipped.text,
                        ocrCandidateNote(content),
                    ].join('\n'));
                    continue;
                }
                if (content?.parserStatus === 'metadata_only' && content.parsed?.requiresOcr) {
                    notes.push(attachmentNote(file, 'PDF 没有可读取的文字层，需要 OCR；本轮不能推断扫描图片中的内容。'));
                    continue;
                }
                if (content?.parserStatus === 'metadata_only' && content.parsed?.ocrApplied) {
                    notes.push(attachmentNote(file, '扫描 PDF 已执行 OCR，但没有识别到可靠文字；不得推断扫描页中的参数。'));
                    continue;
                }
                if (content?.parserStatus === 'failed') {
                    notes.push(attachmentNote(file, `PDF 解析失败：${content.parserError || '未知错误'}`));
                    continue;
                }
                notes.push(attachmentNote(file, 'PDF 尚未完成文字层解析。'));
                continue;
            }

            if (file.detectedType === 'text') {
                const remaining = Math.max(0, MAX_INLINE_TEXT_BYTES - inlineTextBytes);
                const clipped = truncateUtf8(blob.file_blob.toString('utf8'), remaining);
                inlineTextBytes += Buffer.byteLength(clipped.text, 'utf8');
                notes.push([
                    attachmentNote(
                        file,
                        clipped.truncated
                            ? '以下是部分文本内容，超出本轮上限的内容已截断。'
                            : '以下是可读取的文本内容。'
                    ),
                    clipped.text,
                ].join('\n'));
                continue;
            }

            if (file.detectedType === 'spreadsheet') {
                const content = getFactoryFileContent(id, { dbAccessors });
                if (content?.parserStatus === 'parsed') {
                    if (!content.parsedText) {
                        notes.push(attachmentNote(file, '表格已解析，但没有可读取的非空单元格。'));
                        continue;
                    }
                    const remaining = Math.max(0, MAX_INLINE_TEXT_BYTES - inlineTextBytes);
                    if (remaining === 0) {
                        notes.push(attachmentNote(file, '本轮附件文字总量已达到上限，表格内容未继续加入模型上下文。'));
                        continue;
                    }
                    const clipped = truncateUtf8(content.parsedText, remaining);
                    inlineTextBytes += Buffer.byteLength(clipped.text, 'utf8');
                    notes.push([
                        attachmentNote(
                            file,
                            clipped.truncated
                                ? '以下是带工作表、行号和列号的部分表格内容，超出本轮上限的内容已截断。'
                                : '以下是带工作表、行号和列号的表格内容。分析报价时应使用该文件ID调用 inspect_quotation_file 核对客户和配方。'
                        ),
                        clipped.text,
                    ].join('\n'));
                    continue;
                }
                if (content?.parserStatus === 'failed') {
                    notes.push(attachmentNote(file, `表格解析失败：${content.parserError || '未知错误'}`));
                    continue;
                }
                notes.push(attachmentNote(file, '表格尚未完成解析。'));
                continue;
            }

            notes.push(attachmentNote(file, '文件已保存，但当前模型不能读取其内容。'));
        }

        const prompt = [
            text(message.content) || '请查看我上传的附件。',
            notes.length > 0 ? `\n【本轮附件】\n${notes.join('\n\n')}` : '',
        ].join('');
        const { attachments: _attachments, ...plainMessage } = message;
        if (imageParts.length === 0) {
            return { ...plainMessage, content: prompt };
        }
        return {
            ...plainMessage,
            content: [
                { type: 'text', text: prompt },
                ...imageParts,
            ],
        };
    });
}

async function fetchAiProvider(messages, options = {}) {
    const fetchImpl = options.fetchImpl || fetch;
    const selectedConfig = options.config || resolveAiProviderRoute(messages, {
        env: options.env,
        dbAccessors: options.dbAccessors,
    });
    const notifyProvider = (config, extra = {}) => {
        if (typeof options.onProvider !== 'function') return;
        options.onProvider({
            provider: config.provider,
            displayName: config.displayName,
            model: config.model,
            routeReason: config.routeReason || 'manual',
            ...extra,
        });
    };
    const requestProvider = async (config) => {
        if (!config.apiKey) {
            const keyName = config.provider === 'kimi' ? 'KIMI_API_KEY' : 'DEEPSEEK_API_KEY';
            throw new Error(`未配置 ${keyName}`);
        }
        const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model,
                messages: prepareAiProviderMessages(messages, {
                    config,
                    dbAccessors: options.dbAccessors,
                }),
                tools: options.tools,
                stream: Boolean(options.stream),
            }),
        });
        if (!response.ok) {
            const responseText = await response.text();
            throw new Error(`${config.displayName} API 错误: ${response.status} ${responseText.slice(0, 200)}`);
        }
        return response;
    };

    notifyProvider(selectedConfig);
    try {
        return await requestProvider(selectedConfig);
    } catch (error) {
        if (selectedConfig.routingMode !== 'auto' || selectedConfig.provider !== 'kimi') {
            throw error;
        }
        const fallback = {
            ...resolveProviderConfig('deepseek', options.env || process.env),
            routingMode: 'auto',
            routeReason: 'vision_fallback',
        };
        notifyProvider(fallback, {
            fallback: true,
            fallbackFrom: 'kimi',
        });
        return requestProvider(fallback);
    }
}

module.exports = {
    MAX_CHAT_ATTACHMENTS,
    aiProviderCapabilities,
    fetchAiProvider,
    normalizeAttachmentIds,
    ocrCandidateNote,
    prepareAiProviderMessages,
    resolveAiProviderConfig,
    resolveAiProviderRoute,
    resolveProviderConfig,
    requiresVisionProvider,
    truncateUtf8,
};
