const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const authMiddleware = require('../../authMiddleware.cjs');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const { fetchWithPolicy } = require('../../services/httpClient.cjs');

function voiceAuth(req, res, next) {
    if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) {
        return next();
    }
    return authMiddleware(req, res, next);
}

// ── 阿里云 NLS Token 自动获取与缓存 ──
let nlsTokenCache = { token: '', expireTime: 0 };

/**
 * 使用 AccessKey 签名调用阿里云 CreateToken API
 * 自动缓存，过期前 1 小时自动刷新
 */
async function getNlsToken() {
    const now = Date.now();
    // 未过期且距过期还有 1 小时以上，直接用缓存
    if (nlsTokenCache.token && nlsTokenCache.expireTime - now > 3600000) {
        return nlsTokenCache.token;
    }

    const accessKeyId = process.env.ALI_ACCESS_KEY_ID;
    const accessKeySecret = process.env.ALI_ACCESS_KEY_SECRET;
    if (!accessKeyId || !accessKeySecret) {
        throw new Error('未配置 ALI_ACCESS_KEY_ID / ALI_ACCESS_KEY_SECRET');
    }

    // 构造签名参数
    const params = {
        Action: 'CreateToken',
        Version: '2019-02-28',
        Format: 'JSON',
        AccessKeyId: accessKeyId,
        SignatureMethod: 'HMAC-SHA1',
        Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        SignatureVersion: '1.0',
        SignatureNonce: crypto.randomUUID(),
    };

    // 按 key 排序
    const sortedKeys = Object.keys(params).sort();
    const canonicalized = sortedKeys
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join('&');

    // 待签名字符串: GET&%2F&<url-encoded canonicalized>
    const stringToSign = `GET&${encodeURIComponent('/')}&${encodeURIComponent(canonicalized)}`;

    // HMAC-SHA1 签名
    const signature = crypto
        .createHmac('sha1', accessKeySecret + '&')
        .update(stringToSign)
        .digest('base64');

    const url = `https://nls-meta.cn-shanghai.aliyuncs.com/?${canonicalized}&Signature=${encodeURIComponent(signature)}`;

    console.log('[ASR] 正在获取 NLS Token...');
    const response = await fetchWithPolicy(url, {}, {
        timeoutMs: 10000,
        retries: 1,
        label: '阿里云语音 Token',
    });
    const result = await response.json();

    if (result.Token) {
        nlsTokenCache = {
            token: result.Token.Id,
            expireTime: result.Token.ExpireTime * 1000, // 秒转毫秒
        };
        const expiresIn = Math.round((nlsTokenCache.expireTime - Date.now()) / 3600000);
        console.log(`[ASR] NLS Token 获取成功, 有效期约 ${expiresIn} 小时`);
        return nlsTokenCache.token;
    } else {
        console.error('[ASR] Token 获取失败:', result);
        throw new Error(result.Message || 'NLS Token 获取失败');
    }
}

/**
 * POST /api/voice/asr
 * 语音识别端点 — 接收音频文件，调阿里云一句话识别 REST API
 * 自动获取和刷新 NLS Token
 */
router.post('/api/voice/asr', voiceAuth, upload.single('audio'), async (req, res) => {
    try {
        const appKey = process.env.ALI_ASR_APPKEY;
        if (!appKey) {
            return res.json({ success: false, error: '未配置 ALI_ASR_APPKEY' });
        }

        if (!req.file) {
            return res.json({ success: false, error: '未收到音频文件' });
        }

        const token = await getNlsToken();
        const audioBuffer = req.file.buffer;
        const format = req.body.format || 'pcm';
        const sampleRate = parseInt(req.body.sampleRate) || 16000;

        console.log(`[ASR] 收到音频: ${req.file.originalname}, 大小: ${audioBuffer.length} bytes, 格式: ${format}`);

        // 阿里云一句话识别 REST API (非 Flash 版本)
        const url = `https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/asr?appkey=${appKey}&format=${format}&sample_rate=${sampleRate}&enable_punctuation_prediction=true&enable_inverse_text_normalization=true`;

        const response = await fetchWithPolicy(url, {
            method: 'POST',
            headers: {
                'X-NLS-Token': token,
                'Content-Type': 'application/octet-stream',
            },
            body: audioBuffer,
        }, { timeoutMs: 30000, retries: 0, label: '阿里云语音识别' });

        const result = await response.json();

        if (result.status === 20000000) {
            const text = result.result || '';
            console.log(`[ASR] 识别结果: "${text}"`);
            res.json({ success: true, text });
        } else {
            console.error('[ASR] 阿里云返回错误:', result);
            res.json({ success: false, error: result.message || '识别失败', detail: result });
        }
    } catch (err) {
        console.error('[ASR] 错误:', err.message);
        res.json({ success: false, error: err.message });
    }
});

// ── Siri + 快捷指令专用端点 ──────────────────────────────


module.exports = router;
