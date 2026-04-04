# 水泵 BOM 管理系统 - 部署指南

本指南涵盖如何在本地电脑或云服务器上部署该项目，包括 Web 前端、Node.js 后端 API、SQLite 数据库以及微信小程序的配置。

## 1. 环境准备

- **Node.js**: v18+ (推荐 v20 LTS)
- **包管理器**: npm
- **数据库**: 无需额外安装，使用嵌入式 SQLite (`better-sqlite3`)

## 2. 环境变量配置

在项目根目录下创建 `.env` 文件：

```env
# DeepSeek AI 配置
DEEPSEEK_API_KEY=你的DeepSeek_API密钥
DEEPSEEK_MODEL=deepseek-chat

# 阿里云 ASR (语音识别) 配置
ALIYUN_AK_ID=你的阿里云AccessKeyId
ALIYUN_AK_SECRET=你的阿里云AccessKeySecret
ALIYUN_APP_KEY=你的阿里云AppKey
```

> 数据库使用本地 SQLite 文件 `pump.db`，无需配置连接信息。

## 3. 本地开发与运行

```bash
# 1. 安装依赖
npm install

# 2. 初始化数据库（首次部署时）
# 如果有备份数据：把 JSON 文件放到 scripts/db-backup/ 目录
node scripts/migrate-to-sqlite.cjs

# 3. 启动前后端（并行）
npm start
```

启动后：
- Web 页面：`http://localhost:3000`
- API 后端：`http://localhost:3002`

## 4. 生产环境部署 (云服务器)

### 4.1 安装 PM2
```bash
npm install -g pm2
```

### 4.2 部署后端 API
```bash
npm install
pm2 start api.cjs --name "pump-api"
pm2 save
pm2 startup
```

### 4.3 构建前端
```bash
npm run build
```
生成 `dist/` 目录，放到 Nginx Web 目录下。

### 4.4 Nginx 配置示例
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # 前端静态文件
    location / {
        root /path/to/your/project/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # 后端接口代理
    location /api/ {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # SSE 支持 (AI 助手流式输出)
        proxy_set_header Connection '';
        chunked_transfer_encoding off;
        proxy_buffering off;
        proxy_cache off;
    }
}
```

## 5. 数据迁移（复刻到新电脑）

### 5.1 备份数据
只需拷贝以下文件到新电脑：
- `pump.db` — SQLite 数据库文件（包含所有业务数据）
- `.env` — 环境变量配置

### 5.2 在新电脑上部署
```bash
# 1. 克隆代码
git clone <仓库地址>

# 2. 安装依赖
npm install

# 3. 放入备份的 pump.db 和 .env 到项目根目录

# 4. 启动
npm start
```

> 如果没有 `pump.db` 但有 JSON 备份文件，可以用迁移脚本重建：
> ```bash
> # 把 JSON 文件放到 scripts/db-backup/ 目录
> node scripts/migrate-to-sqlite.cjs
> ```

## 6. 微信小程序部署

小程序代码位于 `wechat/` 目录下。

1. **打开项目**: 使用微信开发者工具导入 `wechat/` 文件夹
2. **修改接口地址**: `wechat/app.js` 中将 `baseUrl` 改为后端地址：
   ```javascript
   globalData: {
     baseUrl: 'https://yourdomain.com' // 本地测试: http://局域网IP:3002
   }
   ```
3. **微信后台配置**: 登录微信公众平台配置 `request` 合法域名
4. **编译并上传**: 开发者工具中编译无误后上传
