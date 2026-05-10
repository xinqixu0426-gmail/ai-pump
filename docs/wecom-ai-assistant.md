# 企业微信 AI 助理接入说明

## 目标

企业微信负责“聊天入口 + 主动提醒”，小程序/网页负责复杂业务页面。后端统一调用现有 PumpDB API 和数据库。

## 环境变量

在 `.env` 中增加以下配置：

```env
WECOM_CORP_ID=
WECOM_AGENT_ID=
WECOM_SECRET=
WECOM_TOKEN=
WECOM_ENCODING_AES_KEY=
WECOM_DEFAULT_TOUSER=
WECOM_APP_URL=
WECOM_ADMIN_TOKEN=
WECOM_DAILY_BRIEF_ENABLED=true
WECOM_DAILY_BRIEF_TIME=08:30
```

说明：

- `WECOM_CORP_ID`: 企业 ID。
- `WECOM_AGENT_ID`: 自建应用 AgentId。
- `WECOM_SECRET`: 自建应用 Secret。
- `WECOM_TOKEN`: 企业微信回调 Token。
- `WECOM_ENCODING_AES_KEY`: 企业微信回调 EncodingAESKey。
- `WECOM_DEFAULT_TOUSER`: 默认接收人企业微信 UserId，测试推送可省略请求里的 `touser`。
- `WECOM_APP_URL`: 卡片点击打开的系统地址，比如生产后台地址。
- `WECOM_ADMIN_TOKEN`: 手动测试推送用的管理 token。也可以用 `x-internal-secret`。
- `WECOM_DAILY_BRIEF_ENABLED`: 是否启用每日主动简报，默认 `true`，设为 `false` 可关闭。
- `WECOM_DAILY_BRIEF_TIME`: 每日简报推送时间，北京时间 `HH:mm`，默认 `08:30`。

## 企业微信后台配置

自建应用的接收消息服务器 URL：

```text
https://你的域名/api/wecom/webhook
```

把企业微信后台生成或填写的 `Token`、`EncodingAESKey` 同步到 `.env`。

## 已实现接口

### 健康检查

```http
GET /api/wecom/health
```

返回企业微信发送配置、回调配置是否齐全，不暴露密钥。

### 发送测试文本

```http
POST /api/wecom/test-message
Content-Type: application/json
x-internal-secret: <INTERNAL_SECRET>

{
  "touser": "企业微信UserId",
  "text": "PumpDB 企业微信通道测试"
}
```

如果配置了 `WECOM_DEFAULT_TOUSER`，可以不传 `touser`。

### 发送业务简报卡片

```http
POST /api/wecom/send-daily-brief
Content-Type: application/json
x-internal-secret: <INTERNAL_SECRET>

{
  "touser": "企业微信UserId"
}
```

简报数据来自：

```http
GET /api/dashboard/brief
```

### 发送订单摘要卡片

```http
POST /api/wecom/send-order-summary
Content-Type: application/json
x-internal-secret: <INTERNAL_SECRET>

{
  "keyword": "订单ID、合同号或客户名",
  "touser": "企业微信UserId"
}
```

如果配置了 `WECOM_DEFAULT_TOUSER`，可以不传 `touser`。

订单摘要数据来自通用服务 `api/services/orderAssistant.cjs`，不是企业微信专属逻辑。

## 聊天框行为

在企业微信自建应用聊天框里：

- 输入 `ping`，返回 `pong`。
- 输入 `简报`、`今日`，返回业务简报卡片。
- 输入 `查订单 订单ID/合同号/客户名`，返回订单摘要卡片。
- 输入其他业务问题，进入现有 AI 处理流程，并返回企业微信卡片。

## 主动简报

服务启动时会根据 `WECOM_DAILY_BRIEF_ENABLED`、`WECOM_DAILY_BRIEF_TIME`、`WECOM_DEFAULT_TOUSER` 安排下一次每日简报。

如果不希望自动推送，设置：

```env
WECOM_DAILY_BRIEF_ENABLED=false
```

手动测试仍然可以调用：

```http
POST /api/wecom/send-daily-brief
```

## 弃用企业微信的方法

企业微信只作为入口层，不承载核心业务逻辑。后续如果改回微信小程序或网页 AI 助手，按以下方式处理：

1. 关闭企业微信后台的接收消息服务器，或把 `WECOM_DAILY_BRIEF_ENABLED=false` 并移除 `WECOM_*` 环境变量。
2. 停用路由挂载：`api.cjs` 中的 `/api/wecom`。
3. 保留通用业务服务，例如 `api/services/dashboardBrief.cjs`、`api/services/orderAssistant.cjs`，小程序可直接复用这些服务背后的 API。
4. 小程序聊天页或网页 AI 助手继续调用通用接口，例如 `/api/dashboard/brief`、订单查询接口、AI 工具调用接口。

原则：企业微信路由只负责收发消息和卡片渲染，业务查询、简报生成、订单摘要都放在通用 service 中。这样弃用企业微信时只换入口，不重做业务能力。

## 下一步建议

1. 卡片按钮跳转到小程序或网页订单详情。
2. 缺料分析和采购建议先做只读，再做写操作确认。
3. 稳定后降低 POST 消息诊断日志噪音。
