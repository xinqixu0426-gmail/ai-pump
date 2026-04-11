# 水泵 BOM 管理与出图系统

基于智能化与微服务架构的现代化水泵生产物料管理系统。集成订单结算、部件组装、库存核算，并深入融合 DeepSeek AI Agent 引擎、企业微信智能助手与 FreeCAD 参数化自动出图工作流。

## 🛠 技术栈
- **前端 Web**：React 18 + TS + Vite + MUI 5 (Zustand 缓存治理)
- **后端 API**：Node.js Express + `better-sqlite3` 轻量级嵌入式数据库
- **云端服务**：DeepSeek Chat (Function Calling) + 阿里云 ASR 语音语义
- **工程引擎**：独立线程调度 FreeCAD (TechDraw 2D 投影自动化)
- **多端触达**：HTTPS PWA (支持多平台麦克风唤醒) + 企业微信内网互通

---

## 🚀 部署与开发指南

### 1. 环境变量 (.env)
在项目根目录自行创建 `.env`（*出于安全，该文件已被加入 .gitignore，切勿提交至代码仓库*）：
```env
ACCESS_PASSWORD=你的登录访问密码
JWT_SECRET=随便填一串无规律长字符_用于签发加密身份

# AI 与听觉引擎
DEEPSEEK_API_KEY=sk-...
ALIYUN_APP_KEY=阿里云的ASR应用AppKey
ALIYUN_AK_ID=阿里云AccessKey
ALIYUN_AK_SECRET=阿里云Secret

# 企业微信 (WeCom) Webhook 接收配置
WECOM_CORP_ID=ww...
WECOM_AGENT_ID=1000xxx
WECOM_SECRET=...
WECOM_TOKEN=...
WECOM_ENCODING_AES_KEY=填入你在企微后台生成的AES长密钥

# 工业引擎配置 (仅在需要口述出图的服务器或开发机配置)
FREECAD_BIN=C:\Program Files\FreeCAD 1.1\bin\freecad.exe
```

### 2. 运行脚本
**调试环境（全栈共启）**：
```bash
npm install
npm run start    # 一键启动 Vite 前端 (3000) 与 Express API (3002)
```

**生产服务器部署 (Alibaba Cloud 等)**：
```bash
npm run build                    # 1. 前端构建出 /dist 静态产物
npm install --production         # 2. 安装后端生产依赖
pm2 start api.cjs --name "pump"  # 3. 守护后台 Node.js 进程 (3002端口)
```

Nginx 核心反向代理演示：
```nginx
server {
    listen 80;
    server_name 你的公网IP或域名;

    # 1. 代理前端静态打包资产
    location / {
        root /var/www/pump/dist;
        try_files $uri $uri/ /index.html;
    }

    # 2. API 中转与 SSE 实时流联通
    location /api/ {
        proxy_pass http://localhost:3002;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off; # 重要：DeepSeek 数据流响应必需
    }
}
```

---

## 📦 API 与微服务架构层

前端已严禁直连内网数据文件。所有核心通信由拦截器统一发送给 `api.cjs`：
* **`/api/auth`**：携带并发防爆破器 (`express-rate-limit`) 的下发签发模块。
* **`/api/ai` 与 `/api/wecom`**：大模型对话枢纽与企微加密通讯通道，已开放特殊免鉴权放行组。
* **`/api/cost/*`**：成本中央精算机（可拉取实时铜价动态浮动）。
* **`/api/settings`**：系统全局配置（管理费默认值等），key-value 存储于 `system_settings` 表。
* **`/api/rotor`**：并发安全的转子图纸下发平台。接收自然语言后调用 FreeCAD 无头子进程导出 SVG 并在沙盒中将其转换为可打印的高清 PDF。

### 成本计算公式
```
总成本 = 配件成本 + 线圈成本 + 动态配置(浮球/电缆/包材) + 人工工资(安装+打包+喷漆) + 管理费
```
- **人工工资**：绑定在泵壳模板上，选模板时自动带入配方，可逐单覆盖
- **管理费**：全局默认值存于 `system_settings`，新建配方自动填入，可覆盖

---

## 💣 生产维护踩坑实录 (Troubleshooting)

1. **企业微信收发信 60020 与 42028 失败**
   - 解决方案：必须去应用**企业可信 IP**处绑定服务器公网地址。在推流卡片矩阵时，请确保参数 `type: 1` 已摘除，以免被深信服底层错误吞没认定为恶意短链接。同时 `.env` 在粘贴企微 AES Key 时极其容易混入 Windows 回车符，请注意排查清洗。
2. **500 Err 限流器引发的前后台瘫痪**
   - 症状：日志报 `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`。
   - 解法：当 Node.js 被置于 Nginx 反向代理下时，IP 防爆破插件由于查无实名导致崩溃，需在代码顶层配置 `app.set('trust proxy', 1);`（代码已包含此补丁）。
3. **401 Unauthorized 页面空白无响应**
   - 症状：旧网页发送了 API 新版结构体却遭遇加密锁。
   - 解法：服务器通过 `git pull` 后**仅重启后端是不够的**，必须执行 `npm run build` 从源头刷新网页客户端打包（Nginx 加载机制）。
4. **口述出图的图纸生成一直是空白尺寸或未变形**
   - 排查点：脚本采用的技术是基于 Fake Parametric 标签覆盖而非 3D 重建几何运算。核心脚本在 `worker.py` 内。必须等待 UI 事件循环泵出 SVG，切忌屏蔽 GUI 调用。
