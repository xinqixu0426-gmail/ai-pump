const express = require('express');
const xml2js = require('xml2js');
const { decrypt, getSignature } = require('@wecom/crypto');
const { processAiChat } = require('./ai.cjs');
const { buildDashboardBrief, buildBriefText } = require('../services/dashboardBrief.cjs');
const { findOrderByKeyword, summarizeOrder, buildOrderText } = require('../services/orderAssistant.cjs');

const router = express.Router();
const xmlParser = new xml2js.Parser({ explicitArray: false });

// Only parse WeCom XML/text callbacks here. JSON test endpoints are parsed by api.cjs.
router.use(express.text({ type: ['text/xml', 'application/xml', 'text/plain'] }));

let accessTokenCache = { token: null, expireTime: 0 };

function getWecomConfig() {
    return {
        corpId: (process.env.WECOM_CORP_ID || '').trim(),
        secret: (process.env.WECOM_SECRET || '').trim(),
        agentId: (process.env.WECOM_AGENT_ID || '').trim(),
        token: (process.env.WECOM_TOKEN || '').trim(),
        encodingAESKey: (process.env.WECOM_ENCODING_AES_KEY || '').trim(),
        defaultTouser: (process.env.WECOM_DEFAULT_TOUSER || '').trim(),
        appUrl: (process.env.WECOM_APP_URL || process.env.CORS_ORIGIN || 'http://localhost:3000').trim(),
        adminToken: (process.env.WECOM_ADMIN_TOKEN || '').trim(),
        dailyBriefEnabled: (process.env.WECOM_DAILY_BRIEF_ENABLED || 'true').trim() !== 'false',
        dailyBriefTime: (process.env.WECOM_DAILY_BRIEF_TIME || '08:30').trim(),
    };
}

function truncateForLog(value, len = 12) {
    if (value === undefined || value === null) return null;
    const text = String(value);
    return text.length > len ? `${text.slice(0, len)}...` : text;
}

function getRawQueryParam(req, name) {
    const query = String(req.originalUrl || '').split('?')[1] || '';
    const prefix = `${name}=`;
    const part = query.split('&').find(item => item.startsWith(prefix));
    if (!part) return undefined;
    try {
        return decodeURIComponent(part.slice(prefix.length));
    } catch {
        return part.slice(prefix.length);
    }
}

function uniqueTruthy(values) {
    return [...new Set(values.filter(value => value !== undefined && value !== null && value !== ''))];
}

function hasAdminAccess(req) {
    const cfg = getWecomConfig();
    const internalSecret = process.env.INTERNAL_SECRET;
    if (internalSecret && req.headers['x-internal-secret'] === internalSecret) return true;
    if (!cfg.adminToken) return false;
    return req.headers['x-wecom-admin-token'] === cfg.adminToken
        || req.query.adminToken === cfg.adminToken
        || req.body?.adminToken === cfg.adminToken;
}

function requireAdmin(req, res, next) {
    if (hasAdminAccess(req)) return next();
    return res.status(401).json({ success: false, error: 'Unauthorized' });
}

function assertSendConfig() {
    const cfg = getWecomConfig();
    const missing = [];
    if (!cfg.corpId) missing.push('WECOM_CORP_ID');
    if (!cfg.secret) missing.push('WECOM_SECRET');
    if (!cfg.agentId) missing.push('WECOM_AGENT_ID');
    if (missing.length > 0) throw new Error(`Missing WeCom config: ${missing.join(', ')}`);
    return cfg;
}

function assertCallbackConfig() {
    const cfg = getWecomConfig();
    const missing = [];
    if (!cfg.token) missing.push('WECOM_TOKEN');
    if (!cfg.encodingAESKey) missing.push('WECOM_ENCODING_AES_KEY');
    if (missing.length > 0) throw new Error(`Missing WeCom callback config: ${missing.join(', ')}`);
    return cfg;
}

async function getWecomToken() {
    const cfg = assertSendConfig();
    if (accessTokenCache.token && Date.now() < accessTokenCache.expireTime) {
        return accessTokenCache.token;
    }
    const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(cfg.corpId)}&corpsecret=${encodeURIComponent(cfg.secret)}`;
    const res = await fetch(tokenUrl);
    const data = await res.json();
    if (data.errcode !== 0) {
        throw new Error('Get WeCom token failed: ' + JSON.stringify(data));
    }
    accessTokenCache.token = data.access_token;
    accessTokenCache.expireTime = Date.now() + (Number(data.expires_in || 7200) - 100) * 1000;
    return data.access_token;
}

async function sendWecomApiMessage(payload) {
    const token = await getWecomToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json();
    const logMeta = {
        msgtype: payload?.msgtype,
        touser: truncateForLog(payload?.touser, 24),
        errcode: data.errcode,
        errmsg: data.errmsg,
        invaliduser: data.invaliduser,
    };
    if (data.errcode !== 0) {
        console.error('[WECOM] send message failed:', logMeta);
        throw new Error('Send WeCom message failed: ' + JSON.stringify(data));
    }
    console.log('[WECOM] send message result:', {
        ...logMeta,
        msgid: truncateForLog(data.msgid, 24),
    });
    return data;
}

async function sendWecomTextMessage(touser, text) {
    const cfg = assertSendConfig();
    return sendWecomApiMessage({
        touser,
        agentid: Number(cfg.agentId),
        msgtype: 'text',
        text: { content: text },
    });
}

async function sendWecomTemplateCard(touser, card) {
    const cfg = assertSendConfig();
    return sendWecomApiMessage({
        touser,
        agentid: Number(cfg.agentId),
        msgtype: 'template_card',
        template_card: card,
    });
}

function buildBriefCard(brief) {
    const cfg = getWecomConfig();
    const s = brief.summary;
    const detailsUrl = `${cfg.appUrl.replace(/\/$/, '')}/`;
    return {
        card_type: 'text_notice',
        source: { desc: 'PumpDB AI', desc_color: 1 },
        main_title: {
            title: `业务简报 ${brief.date}`,
            desc: `缺货 ${s.outOfStockCount} | 低库存 ${s.lowStockCount} | 未完成订单 ${s.pendingOrderCount}`,
        },
        sub_title_text: buildBriefText(brief),
        horizontal_content_list: [
            { keyname: '今日新增', value: `零件 ${s.newPartCount} / 配方 ${s.newRecipeCount} / 模板 ${s.newTemplateCount}` },
            { keyname: '采购关注', value: `${s.purchaseOrderCount} 个订单` },
            { keyname: '生成时间', value: brief.generatedAtText || '-' },
        ],
        jump_list: [
            { type: 1, title: '打开系统', url: detailsUrl },
        ],
        card_action: { type: 1, url: detailsUrl },
    };
}

function buildAiResultCard(finalContent, speech, toolResults) {
    const cfg = getWecomConfig();
    const detailsUrl = `${cfg.appUrl.replace(/\/$/, '')}/`;
    const horizontalList = [];
    if (Array.isArray(toolResults) && toolResults.length > 0) {
        horizontalList.push({ keyname: '调用工具', value: toolResults.map(t => t.name).join(', ').slice(0, 200) });
    }
    return {
        card_type: 'text_notice',
        source: { desc: 'PumpDB AI', desc_color: 1 },
        main_title: {
            title: 'AI 处理结果',
            desc: speech || '请求已处理完成',
        },
        sub_title_text: (finalContent || '已完成操作').slice(0, 500),
        horizontal_content_list: horizontalList,
        jump_list: [
            { type: 1, title: '打开系统', url: detailsUrl },
        ],
        card_action: { type: 1, url: detailsUrl },
    };
}

function buildOrderCard(summary) {
    const cfg = getWecomConfig();
    const baseUrl = cfg.appUrl.replace(/\/$/, '');
    const detailsUrl = `${baseUrl}/orders`;
    const title = summary.contractNo || `订单${summary.id}`;
    const horizontalList = [
        { keyname: '客户', value: summary.customerName || '-' },
        { keyname: '状态', value: summary.status || '-' },
        { keyname: '产品', value: `${summary.itemCount} 项` },
        { keyname: '采购', value: `${summary.purchasedCount}/${summary.needToBuyCount} 已采购` },
    ];
    if (summary.updatedAtText) {
        horizontalList.push({ keyname: '更新时间', value: summary.updatedAtText });
    }
    return {
        card_type: 'text_notice',
        source: { desc: 'PumpDB 订单', desc_color: 1 },
        main_title: {
            title,
            desc: `${summary.customerName || '未填写客户'} | ${summary.status}`,
        },
        sub_title_text: buildOrderText(summary).slice(0, 500),
        horizontal_content_list: horizontalList,
        jump_list: [
            { type: 1, title: '打开订单管理', url: detailsUrl },
        ],
        card_action: { type: 1, url: detailsUrl },
    };
}

async function sendDailyBrief(touser) {
    const brief = buildDashboardBrief();
    const card = buildBriefCard(brief);
    const result = await sendWecomTemplateCard(touser, card);
    return { result, brief };
}

function parseOrderQuery(content) {
    const text = String(content || '').trim();
    const match = text.match(/^(?:查|查看|查询)?\s*(?:订单|合同)\s*[:：#]?\s*(.+)$/);
    if (match?.[1]) return match[1].trim();
    return '';
}

async function sendOrderSummary(touser, keyword) {
    const { order, matches } = findOrderByKeyword(keyword);
    if (!order) {
        await sendWecomTextMessage(touser, `没有找到订单：${keyword}`);
        return { found: false, keyword, matchCount: 0 };
    }
    const summary = summarizeOrder(order);
    const result = await sendWecomTemplateCard(touser, buildOrderCard(summary));
    return { found: true, keyword, matchCount: matches.length, order: summary, result };
}

function parseDailyBriefTime(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return { hour: 8, minute: 30 };
    const hour = Math.min(Math.max(Number(match[1]), 0), 23);
    const minute = Math.min(Math.max(Number(match[2]), 0), 59);
    return { hour, minute };
}

function nextBjtTimeDelay(timeText) {
    const { hour, minute } = parseDailyBriefTime(timeText);
    const now = new Date();
    const bjtNowText = now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' });
    const bjtNow = new Date(bjtNowText);
    const target = new Date(bjtNow);
    target.setHours(hour, minute, 0, 0);
    if (target <= bjtNow) target.setDate(target.getDate() + 1);
    return target.getTime() - bjtNow.getTime();
}

let dailyBriefTimer = null;
function scheduleDailyBrief() {
    const cfg = getWecomConfig();
    if (!cfg.dailyBriefEnabled || !cfg.defaultTouser || !cfg.corpId || !cfg.secret || !cfg.agentId) {
        console.log('[WECOM] daily brief scheduler skipped:', {
            enabled: cfg.dailyBriefEnabled,
            hasDefaultTouser: Boolean(cfg.defaultTouser),
            sendConfigured: Boolean(cfg.corpId && cfg.secret && cfg.agentId),
        });
        return;
    }
    const delay = nextBjtTimeDelay(cfg.dailyBriefTime);
    const hours = (delay / 3600000).toFixed(1);
    console.log(`[WECOM] 下次主动简报: ${cfg.dailyBriefTime} BJT (${hours}h 后)`);
    dailyBriefTimer = setTimeout(async () => {
        try {
            await sendDailyBrief(cfg.defaultTouser);
        } catch (error) {
            console.error('[WECOM] daily brief push failed:', error);
        } finally {
            scheduleDailyBrief();
        }
    }, delay);
}

const TOOL_NAMES_CN = {
    query_recipe_cost_by_name: '正在计算配方成本...',
    query_recipe_cost_by_id: '正在按编号测算成本...',
    full_calculate: '正在做综合成本计算...',
    get_recent_orders: '正在调阅订单记录...',
    generate_purchase_list: '正在生成采购清单...',
    create_order: '正在创建订单...',
    get_copper_price: '正在获取铜价...',
    compare_recipes: '正在对比配方...',
    calculate_coil_cost: '正在计算线圈转子成本...',
    dynamic_config_cost: '正在计算动态配置成本...',
    get_dashboard_summary: '正在读取运营概况...',
};

router.get('/health', (req, res) => {
    const cfg = getWecomConfig();
    res.json({
        success: true,
        data: {
            callbackConfigured: Boolean(cfg.token && cfg.encodingAESKey),
            sendConfigured: Boolean(cfg.corpId && cfg.secret && cfg.agentId),
            defaultTouserConfigured: Boolean(cfg.defaultTouser),
            appUrl: cfg.appUrl,
        },
    });
});

router.post('/test-message', requireAdmin, async (req, res) => {
    try {
        const cfg = getWecomConfig();
        const touser = req.body?.touser || cfg.defaultTouser;
        if (!touser) return res.status(400).json({ success: false, error: 'touser or WECOM_DEFAULT_TOUSER is required' });
        const result = await sendWecomTextMessage(touser, req.body?.text || 'PumpDB 企业微信通道已连通');
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/send-daily-brief', requireAdmin, async (req, res) => {
    try {
        const cfg = getWecomConfig();
        const touser = req.body?.touser || cfg.defaultTouser;
        if (!touser) return res.status(400).json({ success: false, error: 'touser or WECOM_DEFAULT_TOUSER is required' });
        const data = await sendDailyBrief(touser);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/send-order-summary', requireAdmin, async (req, res) => {
    try {
        const cfg = getWecomConfig();
        const touser = req.body?.touser || cfg.defaultTouser;
        const keyword = String(req.body?.keyword || req.body?.orderId || req.body?.contractNo || '').trim();
        if (!touser) return res.status(400).json({ success: false, error: 'touser or WECOM_DEFAULT_TOUSER is required' });
        if (!keyword) return res.status(400).json({ success: false, error: 'keyword/orderId/contractNo is required' });
        const data = await sendOrderSummary(touser, keyword);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/webhook', (req, res) => {
    const { msg_signature, timestamp, nonce, echostr } = req.query;
    try {
        const cfg = assertCallbackConfig();
        if (!msg_signature || !timestamp || !nonce || !echostr) {
            console.warn('[WECOM] GET validation missing params:', {
                hasSignature: Boolean(msg_signature),
                hasTimestamp: Boolean(timestamp),
                hasNonce: Boolean(nonce),
                hasEchoStr: Boolean(echostr),
            });
            return res.status(400).send('Missing callback params');
        }

        const rawEchoStr = getRawQueryParam(req, 'echostr');
        const echoCandidates = uniqueTruthy([echostr, rawEchoStr]);
        const matchedEcho = echoCandidates.find(candidate => getSignature(cfg.token, timestamp, nonce, candidate) === msg_signature);
        if (!matchedEcho) {
            const calculated = echoCandidates.map(candidate => ({
                signature: truncateForLog(getSignature(cfg.token, timestamp, nonce, candidate)),
                echoPrefix: truncateForLog(candidate),
                hasSpace: String(candidate).includes(' '),
                hasPlus: String(candidate).includes('+'),
            }));
            console.warn('[WECOM] GET signature mismatch:', {
                actual: truncateForLog(msg_signature),
                calculated,
                tokenLength: cfg.token.length,
                aesKeyLength: cfg.encodingAESKey.length,
                rawEchoPrefix: truncateForLog(rawEchoStr),
                queryEchoPrefix: truncateForLog(echostr),
            });
            return res.status(401).send('Signature mismatch');
        }

        const decrypted = decrypt(cfg.encodingAESKey, matchedEcho);
        console.log('[WECOM] GET validation success:', {
            message: truncateForLog(decrypted.message, 24),
            corpId: truncateForLog(decrypted.id),
        });
        res.type('text/plain').send(decrypted.message);
    } catch (error) {
        console.error('[WECOM] GET validation failed:', error);
        res.status(500).send(error.message);
    }
});

router.post('/webhook', async (req, res) => {
    const { msg_signature, timestamp, nonce } = req.query;
    try {
        const cfg = assertCallbackConfig();
        console.log('[WECOM] POST message callback received:', {
            hasSignature: Boolean(msg_signature),
            hasTimestamp: Boolean(timestamp),
            hasNonce: Boolean(nonce),
            bodyPrefix: truncateForLog(req.body, 32),
        });
        const outerXml = await xmlParser.parseStringPromise(req.body || '');
        const encryptStr = outerXml?.xml?.Encrypt;
        if (!encryptStr) {
            console.warn('[WECOM] POST missing Encrypt:', {
                bodyPrefix: truncateForLog(req.body, 80),
            });
            return res.status(400).send('Missing Encrypt');
        }

        const signature = getSignature(cfg.token, timestamp, nonce, encryptStr);
        if (signature !== msg_signature) {
            console.warn('[WECOM] POST signature mismatch:', {
                actual: truncateForLog(msg_signature),
                calculated: truncateForLog(signature),
                encryptPrefix: truncateForLog(encryptStr),
            });
            return res.status(401).send('');
        }

        const decrypted = decrypt(cfg.encodingAESKey, encryptStr);
        const innerXml = await xmlParser.parseStringPromise(decrypted.message);
        const msg = innerXml.xml || {};
        console.log('[WECOM] POST message decrypted:', {
            msgType: msg.MsgType,
            fromUser: truncateForLog(msg.FromUserName, 24),
            toUser: truncateForLog(msg.ToUserName, 24),
            agentId: msg.AgentID,
            contentPrefix: truncateForLog(msg.Content, 32),
            event: msg.Event,
        });
        const content = String(msg.Content || '').trim();
        const fromUser = msg.FromUserName;

        res.send('success');

        if (!content || !fromUser) {
            console.warn('[WECOM] POST ignored message:', {
                hasContent: Boolean(content),
                hasFromUser: Boolean(fromUser),
                msgType: msg.MsgType,
                event: msg.Event,
            });
            return;
        }
        handleIncomingText(fromUser, content).catch(error => {
            console.error('[WECOM] async message handling failed:', error);
        });
    } catch (error) {
        console.error('[WECOM] POST parsing failed:', error);
        res.status(500).send('Error');
    }
});

async function handleIncomingText(fromUser, content) {
    console.log('[WECOM] handling text message:', {
        fromUser: truncateForLog(fromUser, 24),
        contentPrefix: truncateForLog(content, 32),
    });
    if (/^(ping|测试|test)$/i.test(content)) {
        console.log('[WECOM] matched ping command');
        await sendWecomTextMessage(fromUser, 'pong');
        return;
    }

    if (/简报|今日|今天有什么|今天有啥/.test(content)) {
        console.log('[WECOM] matched daily brief command');
        await sendDailyBrief(fromUser);
        return;
    }

    const orderKeyword = parseOrderQuery(content);
    if (orderKeyword) {
        console.log('[WECOM] matched order query command:', { keyword: truncateForLog(orderKeyword, 24) });
        await sendOrderSummary(fromUser, orderKeyword);
        return;
    }

    await sendWecomTextMessage(fromUser, '已收到，正在分析业务意图...');
    try {
        const aiData = await processAiChat(content, {
            promptSuffix: '\n\n【企业微信环境】回答直接给最核心部分。长结果会放在企业微信卡片里，复杂操作应提示用户打开系统查看。',
            onToolCall: async (funcName) => {
                const cnName = TOOL_NAMES_CN[funcName] || `正在执行: ${funcName}...`;
                await sendWecomTextMessage(fromUser, cnName);
            },
        });
        await sendWecomTemplateCard(fromUser, buildAiResultCard(aiData.finalContent, aiData.speech, aiData.toolResults));
    } catch (error) {
        console.error('[WECOM] AI chat failed:', error);
        await sendWecomTemplateCard(fromUser, buildAiResultCard(`AI 处理失败: ${error.message}`, '发生错误', []));
    }
}

module.exports = router;
module.exports.getWecomToken = getWecomToken;
module.exports.sendWecomTextMessage = sendWecomTextMessage;
module.exports.sendWecomTemplateCard = sendWecomTemplateCard;
module.exports.sendDailyBrief = sendDailyBrief;
module.exports.sendOrderSummary = sendOrderSummary;
module.exports.scheduleDailyBrief = scheduleDailyBrief;
