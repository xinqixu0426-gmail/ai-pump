# 转子出图 API 文档

供 AI 助手、小程序等外部系统调用。

**Base URL**: `http://<服务器IP>:3000/api/rotor`

---

## 快速上手：出图 + 打印 完整流程

```
1. POST /draw   → 提交参数，拿到 jobId
2. GET  /status → 轮询 jobId 直到 status=success
3. POST /print  → 打印 PDF
```

---

## 接口列表

### 1. 结构化出图（推荐 AI 助手使用）

```
POST /api/rotor/draw
Content-Type: application/json
```

#### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `upper_bearing` | string | 否 | 上轴承型号（如 `"6202"`、`"6202-2RS"`、`"202"`） |
| `lower_bearing` | string | 否 | 下轴承型号 |
| `piece_count` | number | 否 | 转子片数（如 160） |
| `rotor_dia` | number | 否 | 转子直径（mm） |
| `bearing_span` | number | 否 | 开档/轴承间距（mm） |
| `stack_offset` | number | 否 | 定位/叠片偏移（mm） |
| `oil_seal_dia` | number | 否 | 油封直径（mm） |
| `impeller_dia` | number | 否 | 叶轮直径（mm） |
| `impeller_depth` | number | 否 | 叶轮厚度（mm） |
| `bearing_to_impeller` | number | 否 | 叶轮开档（mm） |
| `thread_dia` | number | 否 | 螺纹直径（mm） |
| `thread_length` | number | 否 | 螺纹长度（mm） |

> 至少提供一项参数。不提供的参数将使用模板默认值。

#### 示例请求

```json
{
  "upper_bearing": "6202",
  "lower_bearing": "6203",
  "piece_count": 160,
  "bearing_span": 165,
  "stack_offset": 24,
  "oil_seal_dia": 14,
  "bearing_to_impeller": 77,
  "impeller_depth": 9,
  "impeller_dia": 10,
  "thread_dia": 10,
  "thread_length": 14
}
```

#### 成功响应（200）

```json
{
  "status": "success",
  "message": "出图任务已启动",
  "jobId": "5088b858-e3a4-41ba-913a-2da3e8286663",
  "params": { ... }
}
```

#### 错误响应

| 状态码 | 原因 |
|--------|------|
| 400 | 参数为空、轴承型号未识别 |
| 429 | 并发出图已满（最多2个） |
| 500 | 内部错误 |

---

### 2. 自然语言出图

```
POST /api/rotor/chat
Content-Type: application/json
```

#### 请求体

```json
{
  "message": "上轴承202下轴承203，片数160片，开档165，定位24，油封孔径14，叶轮开档77厚度9孔径10，螺纹直径10长度14",
  "force": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `message` | string | 自然语言描述（必填） |
| `force` | boolean | 跳过安全警告直接出图 |
| `supplements` | object | 补充缺失参数（如 `{"thread_length": 14}`） |

#### 响应格式

```json
// 任务启动
{ "status": "success", "jobId": "xxx", "extracted": {...} }

// 需要更多参数
{ "status": "need_params", "message": "...", "extracted": {...} }

// 安全警告（需要 force=true 重新提交）
{ "status": "warning", "stator_clearance": {...}, "missing_length": {...} }
```

---

### 3. 查询任务状态

```
GET /api/rotor/status/:jobId
```

#### 响应

```json
// 进行中
{ "status": "processing" }

// 成功
{ "status": "success", "fileUrl": "/drawings/output_xxx.pdf" }

// 失败
{ "status": "failed", "error": "..." }
```

> **轮询建议**: 每 2 秒查一次，出图通常 15~30 秒完成。

---

### 4. 打印图纸

```
POST /api/rotor/print/:jobId
```

发送 PDF 到服务器默认打印机（静默打印，无弹窗）。

#### 响应

```json
// 成功
{ "ok": true, "message": "打印指令已发送到默认打印机" }

// 失败
{ "error": "PDF 文件不存在: ..." }
```

> **前提条件**: 服务器必须已安装打印机驱动，且设为默认打印机。

---

### 5. 查看出图历史

```
GET /api/rotor/history
```

返回最近 100 条出图记录（按时间倒序）。

```json
[
  {
    "id": 1,
    "job_id": "xxx",
    "nl_input": "上轴承202...",
    "params_json": "{...}",
    "status": "success",
    "file_url": "/drawings/output_xxx.pdf",
    "created_at": "2026-04-11T06:00:00.000Z"
  }
]
```

---

### 6. 删除出图记录

```
DELETE /api/rotor/history/:id
```

同时删除对应的 PDF 文件。

---

## AI 助手调用示例

### 完整出图 + 打印 流程（伪代码）

```python
import requests, time

BASE = "http://192.168.1.x:3000/api/rotor"

# 1. 提交出图
resp = requests.post(f"{BASE}/draw", json={
    "upper_bearing": "6202",
    "lower_bearing": "6203",
    "piece_count": 160,
    "bearing_span": 165,
    "stack_offset": 24,
    "bearing_to_impeller": 77,
    "impeller_depth": 9,
    "thread_length": 14
})
job_id = resp.json()["jobId"]

# 2. 轮询状态
while True:
    status = requests.get(f"{BASE}/status/{job_id}").json()
    if status["status"] == "success":
        print(f"✅ 图纸已生成: {status['fileUrl']}")
        break
    elif status["status"] == "failed":
        print(f"❌ 出图失败: {status['error']}")
        break
    time.sleep(2)

# 3. 打印
if status["status"] == "success":
    print_resp = requests.post(f"{BASE}/print/{job_id}")
    print(print_resp.json())
```

---

## 支持的轴承型号

| 输入格式 | 标准化后 | 直径(mm) | 深度(mm) |
|----------|----------|----------|----------|
| `6201` / `201` / `6201-2RS` | 6201 | 12.0 | 10.0 |
| `6202` / `202` / `6202-ZZ` | 6202 | 15.0 | 11.0 |
| `6203` / `203` | 6203 | 17.0 | 12.0 |
| `6204` / `204` | 6204 | 20.0 | 14.0 |
| `6205` / `205` | 6205 | 25.0 | 15.0 |
