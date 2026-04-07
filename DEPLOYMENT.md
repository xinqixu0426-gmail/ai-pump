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
ALI_ASR_APPKEY=你的阿里云AppKey
ALI_ACCESS_KEY_ID=你的阿里云AccessKeyId
ALI_ACCESS_KEY_SECRET=你的阿里云AccessKeySecret

# Siri 声音配置
# SIRI_API_TOKEN=（可选验证Token，若设置则 Siri 需带此请求头）
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
