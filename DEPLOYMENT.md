# 水泵 BOM 管理系统 - 部署指南

本指南涵盖如何在本地电脑或云服务器上部署该项目，包括 Web 前端、Node.js 后端代理、NocoDB 数据库连接以及微信小程序的配置。

## 1. 环境准备

无论本地还是服务器部署，都需要以下基础环境：
- **Node.js**: v18+ (推荐 v20 LTS)
- **数据库**: NocoDB (需提前部署并创建好各个数据表)
- **包管理器**: npm 或 yarn

## 2. 环境变量配置

在项目根目录下创建一个 `.env` 文件，填入你的实际配置项。必须包含以下变量才能正常启动：

```env
# NocoDB 配置选项
VITE_NOCO_BASE_URL=http://localhost:8080   # NocoDB的访问地址
VITE_NOCO_API_TOKEN=你的NocoDB_API_Token     # API 鉴权用
VITE_NOCO_PARTS_TABLE=你的零件表ID           # Parts 表 ID
VITE_NOCO_RECIPES_TABLE=你的配方表ID         # Recipes 表 ID
VITE_NOCO_ORDERS_TABLE=你的订单表ID          # Orders 表 ID
VITE_NOCO_COILS_TABLE=你的线圈表ID           # 线圈表 ID
VITE_NOCO_CONFIG_TABLE=你的系统配置表ID       # 系统配置表 ID

# DeepSeek AI 配置
DEEPSEEK_API_KEY=你的DeepSeek_API密钥
DEEPSEEK_MODEL=deepseek-chat

# 阿里云 ASR (语音识别) 配置
ALIYUN_AK_ID=你的阿里云AccessKeyId
ALIYUN_AK_SECRET=你的阿里云AccessKeySecret
ALIYUN_APP_KEY=你的阿里云大模型AppKey
```

## 3. 本地开发与运行 (自己电脑部署)

如果你在自己电脑上运行，只需执行以下步骤即可同时启动前端与后端：

1. **安装依赖**
   ```bash
   npm install
   ```
2. **启动服务**
   项目预设了 `concurrently`，可以一键启动前后端：
   ```bash
   npm start
   ```
   > 启动后，Web 页面通常运行在 `http://localhost:5173` (Vite 默认端口，如果你改了配置也可能是 3000)，API 后端独立运行在 `http://localhost:3002`。前后端代理逻辑已经配置好。

## 4. 生产环境部署 (云服务器)

服务器部署推荐使用 **PM2** 守护 NodeJS 后端进程，并使用 **Nginx** 部署构建后的静态前端页面。

### 4.1 安装 PM2
```bash
npm install -g pm2
```

### 4.2 部署后端 API
进入项目目录，启动并持久化 `api.cjs` 后端代理：
```bash
npm install
pm2 start api.cjs --name "pump-api"
pm2 save
pm2 startup
```
后端现在已经在 `3002` 端口常驻运行。

### 4.3 构建前端文件
项目目录下打包前端代码：
```bash
npm run build
```
打包成功后，会生成一个 `dist` 目录。将此目录的内容放置到服务器指定的 Web 目录下供 Nginx 访问。

### 4.4 Nginx 配置示例
配置 Nginx 代理前端静态资源与后端接口 `/api`：

```nginx
server {
    listen 80;
    server_name yourdomain.com; # 替换为你的域名或 IP

    # 前端静态文件
    location / {
        root /path/to/your/project/dist;  # 替换成打包好的 dist 路径
        index index.html;
        try_files $uri $uri/ /index.html; # Vue/React 路由回退配置
    }

    # 后端接口代理
    location /api/ {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # 允许 SSE 取消缓存 (如果 AI 助手需要流式输出)
        proxy_set_header Connection '';
        chunked_transfer_encoding off;
        proxy_buffering off;
        proxy_cache off;
    }
}
```
配置完成后重启 Nginx: `systemctl restart nginx`。

## 5. 数据迁移（复刻到新电脑）

项目自带数据导出/导入脚本，通过 NocoDB REST API 操作，不需要碰 Docker 容器或 PostgreSQL。

### 5.1 在旧电脑上导出数据

确保 NocoDB 正在运行，然后执行：

```bash
node scripts/db-export.cjs
```

脚本会自动：
- 读取 `.env` 中的表ID和Token
- 分页拉取 5 张表（零件/配方/订单/线圈/系统配置）的全部数据
- 输出到 `scripts/db-backup/` 目录下（每张表一个 JSON 文件）
- 同时备份 `.env` 文件

### 5.2 在新电脑上导入数据

**第一步：部署基础环境**

1. 安装 Docker，启动 NocoDB（使用同样的 `docker-compose.yml`）
2. 打开 NocoDB 后台 `http://localhost:8080`，注册账号，创建一个新的 Base
3. 在新 Base 中**手动创建 5 张空表**，表结构需与旧表一致：
   - `Parts`（零件）：型号、类别、单价、供应商、库存
   - `Recipes`（配方）：配方名称、规格、配件JSON、保存时总成本、保存时成本明细
   - `Orders`（订单）：客户名称、合同号、备注、订单状态、型号列表JSON、采购清单JSON、采购TodoJSON
   - `Coils`（线圈）：规格、片数、成本、默认线径、单价、线重、铜价基数、线圈加工费用、转子加工费用
   - `Config`（系统配置）：根据实际使用的字段创建
4. 获取新 NocoDB 的 **API Token**（左下角头像 → API Tokens）
5. 记下每张新表的 **Table ID**（表设置中可见，或从 URL 中提取）

**第二步：配置 .env**

```env
VITE_NOCO_BASE_URL=http://localhost:8080
VITE_NOCO_API_TOKEN=新的Token
VITE_NOCO_PARTS_TABLE=新的零件表ID
VITE_NOCO_RECIPES_TABLE=新的配方表ID
VITE_NOCO_ORDERS_TABLE=新的订单表ID
VITE_NOCO_COILS_TABLE=新的线圈表ID
VITE_NOCO_CONFIG_TABLE=新的配置表ID
```

**第三步：导入数据**

将旧电脑的 `scripts/db-backup/` 文件夹拷贝到新电脑的同一位置，然后执行：

```bash
npm install
node scripts/db-import.cjs
```

脚本会自动批量插入所有记录（每批100条），完成后即可 `npm start` 启动使用。

> **注意事项**：
> - 导入后记录的 `Id` 会重新自增，但不影响系统运行（业务关联靠 `model`/`recipeName` 而非 ID）
> - 导入前请确保目标表为空，避免数据重复
> - 如果旧电脑的 NocoDB 版本和新电脑差异较大，建议保持一致

## 6. 微信小程序部署

小程序代码位于项目的 `wechat/` 目录下。

1. **打开项目**: 使用微信开发者工具导入 `wechat/` 文件夹。
2. **修改接口地址**: 打开 `wechat/app.js`，找到全局变量配置，将 `baseUrl` 改为服务器实际后端的地址：
   ```javascript
   // wechat/app.js
   globalData: {
     baseUrl: 'https://yourdomain.com' // 如果是本地测试填 http://局域网IP:3002
   }
   ```
3. **微信后台配置**: 
   - 登录微信公众平台配置服务器域名（`request` 合法域名填入你的后端域名）。
   - 注意：生产环境小程序强制要求 HTTPS 协议，请为服务器配置好 SSL 证书。
4. **编译并上传**: 在开发者工具中编译无误后，点击“上传”，并在微信公众平台中设置为体验版或提交审核。
