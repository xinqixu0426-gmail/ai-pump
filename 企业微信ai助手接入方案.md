# 企业微信 AI 助手接入与部署方案 (MVP)

> **状态更新 (2026.04.08)**: 核心功能 MVP 测试已全面通过！微信端已成功打通 DeepSeek 并实现高级数据卡片（Template Card）的异步渲染下发。

本文档现已整理为企业微信助手接入的**架构说明及排坑指南**，专为后续维护提供参考。

---

## 1. 核心架构与请求流

系统现已支持 Siri 和 企业微信 的双端免唤醒交互。请求流转过程如下：
1. **企微事件推送**：用户在微信客户端发文字，企微服务器通过 `POST /api/wecom/webhook` 推送 XML 加密报文。
2. **解密验证**：Node.js 后端通过 `@wecom/crypto` 基于 `.env` 中的 `WECOM_ENCODING_AES_KEY` 实时破译密文。
3. **AI 路由处理**：抽离出的通用核心逻辑 `processAiChat(text)` 并发调用外部模型及 Function Calling，组装 BOM 参数。
4. **异步下发**：因为长文本与 AI 计算耗时极易超过微信的被动响应 5 秒钟限制，我们采用直接返回空成功 (`success`) 并在后台异步调取 `https://qyapi.weixin.qq.com/cgi-bin/message/send` 主动推送 `text_notice` 类型卡片的方案。

---

## 2. 环境与配置参数准备

部署至服务器时，必须确保以下环境变量成功填入 `.env` 文件。**核心注意：出于安全规范，`.env` 被写在 `.gitignore` 内，必定不会提交到代码仓库。请直接在远端服务器上执行 `nano .env` 手动粘贴配置。** 没有它不仅企微失效，连访问系统的密码验证都会因获取不到环境变量爆出 500 错误。

```env
# 企业微信 (WeCom) API
WECOM_CORP_ID=你的企业ID
WECOM_AGENT_ID=你的自建应用AgentId
WECOM_SECRET=应用Secret
WECOM_TOKEN=接收消息服务器配置的Token
WECOM_ENCODING_AES_KEY=接收消息服务器配置的AESKey
```

---

## 3. 血泪踩坑纪实 (Troubleshooting)

以下为此次 MVP 接入在通过内网穿透及服务器部署时，真实踩坑和排查的完整记录。

### 坑 1：后端 500 (Internal Server Error) 导致无法登录
- **表现**：重新在服务器部署并在浏览器登录时，控制台狂报 `500` 错误。`pm2 logs` 显示 `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`。
- **原因**：Nginx 的反向代理自带了 `X-Forwarded-For` 头，而 `express-rate-limit` （我们加在 `/login` 保护路由上的限流组件）对伪造 IP 异常敏感。由于原 Express 没有声明信赖反向代理，它拒绝读取 IP 导致崩溃。
- **解决**：在 `api.cjs` 顶部声明 `app.set('trust proxy', 1);`。

### 坑 2：企微 Webhook `GET` 验证失败（签名不匹配）
- **表现**：企业微信后台点击“保存（验证回调URL）”时报错。
- **原因与解决**：
  1. **响应类型苛刻**：企微只接受最纯净的文本格式，需改用 `res.type('text/plain').send(...)`。
  2. **脏数据（隐秘的回车符）**：从 Windows 往 Linux 的 `.env` 里粘贴长秘钥时，末尾极易混入肉眼不可见的 `\r` 甚至空格字符串，此时计算出的 Hash 签名永远都不匹配。代码现已通过加上强力的 `.trim()` 清洗解决。

### 坑 3：新页面全屏 401 报错 (Unauthorized)
- **表现**：启动后，访问前端时网络疯狂打出 `401` 调用失败。页面卡死或没有登录入口。
- **原因**：只在服务器通过 `pm2` 重启了 Node API，却忘记执行**前端打包构建**！Nginx 一直读取老旧没有鉴权拦截体系的旧版前端文件（`/dist`）。
- **解决**：拉代码后切记加一句 `npm run build`！之后强刷浏览器即可出现加密锁页面。

### 坑 4：企微报错 `60020` (not allow to access from your ip)
- **表现**：`pm2 logs` 里企微异步消息外发接口直接打印 `errcode: 60020`。
- **原因**：企微拒绝接收来路不明服务器推来的消息。
- **解决**：必须去自建应用管控台的 **“企业可信 IP”** 里填入服务器的公网 IP `118.31.32.227` 并保存。

### 坑 5：卡片丢失与 `42028` (Template_Card Missing Url)
- **表现**：发了消息，工具生效，但是没有收到最终卡片回复。`pm2 logs` 提示 `errcode: 42028`。
- **原因**：企微组件有变态的隐式关联检查。我们在注入辅助小横条信息（`horizontal_content_list`）时本意是普通文本，但多加了一句配置 `type: 1`。而在企微生态里一旦带上该 type 标记，就认定是链接，强制追讨其内置的 `url` 参数，引发校验抛锚。
- **解决**：将数组里的 `type: 1` 摘除，让他降级识别为普通文本，即可完全打通渲染。
