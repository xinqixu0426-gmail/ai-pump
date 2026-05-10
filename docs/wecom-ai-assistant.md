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

## 聊天框行为

在企业微信自建应用聊天框里：

- 输入 `ping`，返回 `pong`。
- 输入 `简报`、`今日`，返回业务简报卡片。
- 输入其他业务问题，进入现有 AI 处理流程，并返回企业微信卡片。

## 下一步建议

1. 加定时任务，每天早上推送 `/api/wecom/send-daily-brief`。
2. 增加订单查询卡片：`查看订单 xxx`。
3. 卡片按钮跳转到小程序或网页订单详情。
4. 缺料分析和采购建议先做只读，再做写操作确认。
