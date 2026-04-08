# 企业微信 AI 助手接入方案

这是为你接入“企业微信”所定制的技术开发计划。我们将开发一个能够直接接收你聊天消息、调用内部数据库与 AI 进行计算，并最终将复杂的 BOM、成本等格式化为漂亮“卡片”推送给你的机器人后台。

## User Review Required

> [!IMPORTANT]
> 这是一个较大的架构升级，需要获得你的许可才能执行。
> 实施完毕后，你需要在服务器的 `.env` 文件中填写你自己企业微信的凭据（我们会在代码中留好位置），**请不要在聊天框里发给我这些密钥以防泄露**。所需凭据包括：
> - `WECOM_CORP_ID`
> - `WECOM_AGENT_ID`
> - `WECOM_SECRET`
> - `WECOM_TOKEN` 
> - `WECOM_ENCODING_AES_KEY`
> 
> **如何获取这些凭证（操作指南）：**
> 1. **获取 CorpID**：登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)，进入“我的企业”->“企业信息”，在最底部即可看到 **企业 ID**。
> 2. **获取 AgentId & Secret**：进入“应用管理”-> 并在最下方“自建”分类中点击“创建应用”。创建完成后，在应用详情页即可看到 **AgentId** 和 **Secret**。
> 3. **获取 Token & AESKey**：在自建应用详情页往下划，找到“接收消息”-> 点击“启用(设置 API 接收)”。在这里，你可以点击“随机获取”生成 **Token** 和 **EncodingAESKey**。
> 
> *注意：获取到 Token 和 AESKey 后请把它写进 `.env`，**先不要在企微后台点“保存”**。因为必须等我们的代码启动后，企微测试能通过才会让你保存。*

## Proposed Changes

### 后端依赖
#### [MODIFY] [package.json](file:///c:/Users/dan_z/Desktop/pump-manbot/pump-cost-accounting-system/package.json)
- 安装 `@wecom/crypto`：用于企业微信官方推荐的消息加解密库，处理 AES-256-CBC。
- 安装 `xml2js`：因为企业微信下发的 Webhook 消息和被动响应必须是严格的 XML 格式。

### 核心路由建设
#### [NEW] [api/routes/wecom.cjs](file:///c:/Users/dan_z/Desktop/pump-manbot/pump-cost-accounting-system/api/routes/wecom.cjs)
- **`GET /api/wecom/webhook`**：专门处理首次接入企业微信时，微信发来的验证签名请求。
- **`POST /api/wecom/webhook`**：接收真实聊天信息。收到后调用 `processAiChat`，得到数据后进行解析映射，封装成 `template_card`（带彩色标题、分条目、点击操作的卡片样式），随后异步调用企微发送接口。

### 现存 AI 逻辑抽离
#### [MODIFY] [api/routes/ai.cjs](file:///c:/Users/dan_z/Desktop/pump-manbot/pump-cost-accounting-system/api/routes/ai.cjs)
由于目前的 DeepSeek 循环逻辑是写死在 `/api/siri/chat` 里的，这导致企微无法复用。我们要：
- 将通过大模型调用 `Function Calling` 获取成本和配方数据的循环抽象成 `async function processAiChat(text)`，并对外导出（Export）。
- 原有 Siri 的逻辑不受影响。

### 入口与配置
#### [MODIFY] [api.cjs](file:///c:/Users/dan_z/Desktop/pump-manbot/pump-cost-accounting-system/api.cjs)
注入挂载点 `app.use('/api/wecom', require('./api/routes/wecom.cjs'));`

#### [MODIFY] [.env](file:///c:/Users/dan_z/Desktop/pump-manbot/pump-cost-accounting-system/.env)
在末尾增加一组关于 WECOM_XXX 的空白配置项。

---

## Open Questions

> [!NOTE]
> 1. 你是否已经在企业微信后台建好了“自建应用”？
> 2. 系统在企业微信端发送卡片时，你希望用什么主色调，或者有没有某些你常用的操作应该默认放在卡片底部按钮？（例如：“查看明细” 或 “建单” 按钮）

## Verification Plan
1. 完成后端开发后运行 `npm start` 确保代码没有异常错误。
2. 我会测试 `processAiChat` 抽离是否影响原来的逻辑。
3. （这步需要你协助）我会教你在企业微信后台填写回调 URL （`http://你的阿里云IP:3002/api/wecom/webhook`）。如果能顺畅保存成功，则解密与验证代码宣告通过！
