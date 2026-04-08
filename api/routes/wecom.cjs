const express = require('express');
const router = express.Router();
const xml2js = require('xml2js');
const { decrypt, getSignature } = require('@wecom/crypto');
const { processAiChat } = require('./ai.cjs');

// 需要解析 text/xml 的 body
router.use(express.text({ type: '*/*' }));

// 获取 token
let accessTokenCache = { token: null, expireTime: 0 };
async function getWecomToken() {
    if (accessTokenCache.token && Date.now() < accessTokenCache.expireTime) {
        return accessTokenCache.token;
    }
    const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${process.env.WECOM_CORP_ID}&corpsecret=${process.env.WECOM_SECRET}`;
    const res = await fetch(tokenUrl);
    const data = await res.json();
    if (data.errcode === 0) {
        accessTokenCache.token = data.access_token;
        accessTokenCache.expireTime = Date.now() + (data.expires_in - 100) * 1000;
        return data.access_token;
    } else {
        throw new Error('Get wecom token failed: ' + JSON.stringify(data));
    }
}

// 异步发送企微消息
async function sendWecomMessage(touser, finalContent, speech, toolResults) {
    try {
        const token = await getWecomToken();
        const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
        
        let horizontalList = [];
        if (toolResults && toolResults.length > 0) {
            horizontalList.push({ type: 1, keyname: "调用工具", value: toolResults.map(t => t.name).join(', ') });
        }

        const payload = {
            touser: touser,
            agentid: process.env.WECOM_AGENT_ID,
            msgtype: "template_card",
            template_card: {
                card_type: "text_notice",
                source: { desc: "PumpDB AI", desc_color: 1 },
                main_title: { title: "计算结果", desc: speech ? speech : "您的请求已处理完毕" },
                sub_title_text: finalContent ? finalContent.substring(0, 500) : "已完成操作",
                horizontal_content_list: horizontalList,
                jump_list: [
                    { type: 1, title: "查看系统", url: "http://pump.test.com" } // 此URL后续可配置
                ],
                card_action: { type: 1, url: "http://pump.test.com" }
            }
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        console.log('[WECOM] 发送消息结果:', result);
    } catch (err) {
        console.error('[WECOM] 异步发送消息失败:', err);
    }
}

/**
 * 验证企业微信回调 URL (GET)
 */
router.get('/webhook', (req, res) => {
    const { msg_signature, timestamp, nonce, echostr } = req.query;
    const token = (process.env.WECOM_TOKEN || '').trim();
    const encodingAESKey = (process.env.WECOM_ENCODING_AES_KEY || '').trim();

    console.log('[WECOM] 收到 GET 验证请求:', { msg_signature, timestamp, nonce, echostr: echostr?.substring(0, 20) + '...' });

    if (!token || !encodingAESKey) {
        console.error('[WECOM] 失败: Token 或 AESKey 未配置');
        return res.status(500).send('WeCom config missing');
    }

    try {
        const signature = getSignature(token, timestamp, nonce, echostr);
        if (signature !== msg_signature) {
            console.error('[WECOM] 验证失败: 签名不匹配', { expect: signature, actual: msg_signature });
            return res.status(401).send('Signature mismatch');
        }

        const decrypted = decrypt(encodingAESKey, echostr);
        console.log('[WECOM] 验证成功，解密后的消息:', decrypted.message);
        res.type('text/plain').send(decrypted.message);
    } catch (err) {
        console.error('[WECOM] GET Validation Error:', err);
        res.status(500).send('Error');
    }
});

/**
 * 接收真实聊天信息 (POST)
 */
router.post('/webhook', async (req, res) => {
    const { msg_signature, timestamp, nonce } = req.query;
    const bodyStr = req.body;
    const token = (process.env.WECOM_TOKEN || '').trim();
    const encodingAESKey = (process.env.WECOM_ENCODING_AES_KEY || '').trim();

    if (!token || !encodingAESKey) {
        return res.status(500).send('WeCom config missing');
    }

    try {
        // 先解析外层 XML
        const parser = new xml2js.Parser({ explicitArray: false });
        const outerXml = await parser.parseStringPromise(bodyStr);
        const encryptStr = outerXml.xml.Encrypt;

        // 验证签名
        const signature = getSignature(token, timestamp, nonce, encryptStr);
        if (signature !== msg_signature) {
            return res.status(401).send('');
        }

        // 解密内层信息
        const decrypted = decrypt(encodingAESKey, encryptStr);
        const innerXml = await parser.parseStringPromise(decrypted.message);
        
        const content = innerXml.xml.Content;
        const fromUser = innerXml.xml.FromUserName;

        if (content) {
            // 异步处理 AI
            (async () => {
                try {
                    const aiData = await processAiChat(content, { promptSuffix: '\n\n【企微环境】回答直接给最核心部分，不要包含寒暄，结果会在卡片展示。' });
                    await sendWecomMessage(fromUser, aiData.finalContent, aiData.speech, aiData.toolResults);
                } catch (e) {
                    console.error('[WECOM] AI Chat failed:', e);
                    await sendWecomMessage(fromUser, "AI 处理失败: " + e.message, "发生错误", []);
                }
            })();
        }

        // 企微要求在 5 秒内返回，直接返回空字符串成功处理
        res.send('success');
    } catch (err) {
        console.error('[WECOM] POST Parsing Error:', err);
        res.status(500).send('Error');
    }
});

module.exports = router;
