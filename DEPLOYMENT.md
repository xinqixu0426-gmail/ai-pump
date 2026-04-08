# 水泵 BOM 管理系统 - 部署指南

## 1. 环境准备

- **Node.js**: v18+ (推荐 v20 LTS)
- **数据库**: 无需额外安装，使用嵌入式 SQLite (`better-sqlite3`)

## 2. 环境变量配置

在项目根目录下创建 `.env` 文件（**勿提交到 Git**）：

```env
# DeepSeek AI 配置
DEEPSEEK_API_KEY=你的DeepSeek_API密钥
DEEPSEEK_MODEL=deepseek-chat

# 阿里云 ASR (语音识别) 配置
ALIYUN_AK_ID=你的阿里云AccessKeyId
ALIYUN_AK_SECRET=你的阿里云AccessKeySecret
ALIYUN_APP_KEY=你的阿里云NLS项目AppKey

# Siri 声音配置
# SIRI_API_TOKEN=（可选验证Token，若设置则 Siri 需带此请求头）

# 认证系统（必填）
ACCESS_PASSWORD=你的访问密码
JWT_SECRET=随机字符串_用于JWT签名
```

## 3. 本地运行

```bash
npm install
npm start          # 并行启动前端(3000) + API(3002)
```

可选：初始化演示数据 `node scripts/seed-demo-data.cjs`

## 4. 生产部署 (云服务器)

```bash
# 后端
npm install
pm2 start api.cjs --name "pump-api"
pm2 save && pm2 startup

# 前端
npm run build      # 生成 dist/ 目录
```

### Nginx 配置
```nginx
server {
    listen 80;
    server_name 118.31.32.227;

    location / {
        root /var/www/pump-cost-accounting-system/dist; # 这里改为你在服务器上实际的路径
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
    }
}
```

## 5. 数据迁移

只需拷贝 `pump.db` 和 `.env` 到新环境，然后 `npm install && npm start`。

## 6. 更新与维护 (常见踩坑)

当修改了本地代码并通过 Git 同步到服务器后，**务必注意以下两点，否则极易引发故障**：

1. **前端必须重新编译**：执行 `npm run build`。因为服务器上由 Nginx 承接流量，直接读取 `/dist` 里的静态产物。如果只重启了 API 但不构建前端，就可能遇到 **401 Unauthorized 报错且界面无反应**、没有登录路由等情况（旧版网页试图调用新版带锁 API）。
2. **`.env` 文件不在 Git 内**：出于安全机制，`.env` 被标记在 `.gitignore` 里，**你在本地的推送绝不会包含该文件**。因此，在服务器里肯定是看不到它的！你必须在服务器项目根目录下**手动新建并编辑** `.env` 文件。缺失它会导致后端读不到 `ACCESS_PASSWORD`，在使用密码登录时就会立即触发 `500 (Internal Server Error)`。
