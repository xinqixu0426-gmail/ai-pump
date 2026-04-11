# 姘存车 BOM 绠＄悊绯荤粺 API 鏂囨。

**鍚庣**: `http://localhost:3002` | **鍓嶇**: `https://localhost:3000` (Vite HTTPS + proxy `/api/*` 鈫?3002)

---

## 涓€銆佹暟鎹?CRUD

鍓嶇閫氳繃 `/api/*` 鎿嶄綔鏁版嵁锛屼笉鐩磋繛 SQLite銆?
| 璧勬簮 | GET | POST | PATCH | DELETE |
|---|---|---|---|---|
| `/api/parts[/:id]` | 鍏ㄩ儴闆朵欢 | 鏂板缓 | 鏇存柊 | 鍒犻櫎 |
| `/api/recipes[/:id]` | 鍏ㄩ儴閰嶆柟 | 鏂板缓(鍚揩鐓? | 鏇存柊 | 鍒犻櫎 |
| `/api/orders[/:id]` | 鍏ㄩ儴璁㈠崟 | 鏂板缓 | 鏇存柊(鐘舵€?瀹氫环) | 鍒犻櫎 |
| `/api/templates[/:id]` | 娉靛３妯℃澘 | 鏂板缓 | 鏇存柊 | 鍒犻櫎 |
| `/api/coils[/:id]` | 绾垮湀璁板綍 | 鏂板缓(鑷姩绠? | 鏇存柊(鑷姩閲嶇畻) | 鍒犻櫎 |

---

## 浜屻€佹垚鏈绠?
| 鏂规硶 | 璺緞 | 璇存槑 |
|---|---|---|
| POST | `/api/cost/calculate` | 鎸夐浂浠舵暟缁勮绠楁垚鏈?|
| GET | `/api/cost/recipe/:id` | 鎸夐厤鏂笽D鏌ユ垚鏈?|
| GET | `/api/cost/recipe/by-name?name=xxx` | 鎸夊悕绉版煡閰嶆柟鎴愭湰 |
| POST | `/api/cost/dynamic-config` | 鍔ㄦ€侀厤缃垚鏈?娴悆/鐢电紗/鍖呮潗) |
| POST | `/api/cost/full-calculate` | **涓€绔欏紡BOM璁＄畻(鎺ㄨ崘)** |

### 涓€绔欏紡璁＄畻璇锋眰绀轰緥
```json
{
  "pumphousing_model": "V750",
  "stator": "12-120",
  "cableLength": 10,
  "boxType": "鏈ㄧ",
  "hasFloat": true
}
```

---

## 涓夈€侀摐浠?& 绾垮湀

| 鏂规硶 | 璺緞 | 璇存槑 |
|---|---|---|
| GET | `/api/copper-price` | 瀹炴椂閾滀环 |
| POST | `/api/copper-price/update` | 鎵嬪姩瑙﹀彂閾滀环鏇存柊 |
| POST | `/api/coils/calculate` | 绾垮湀鎴愭湰(鏀寔鎻掑€? |
| GET | `/api/coils/specs` | 鍙敤瑙勬牸鍒楄〃 |

**绾垮湀鎴愭湰鍏紡**: `鍗曚环脳鐗囨暟 + 绾块噸脳閾滀环鍩烘暟 + 绾垮湀鍔犲伐璐?+ 杞瓙鍔犲伐璐筦

---

## 鍥涖€丄I 鏅鸿兘鍔╂墜

### Web 绔?(SSE)
- `POST /api/ai/chat` 鈥?璇锋眰浣? `{ messages: [{ role, content }] }`
- SSE 浜嬩欢: `status` / `tool_call` / `tool_result` / `content` / `done` / `error`

### Siri 蹇嵎鎸囦护
- `POST /api/siri/chat` 鈥?璇锋眰浣? `{ text, project: "pump" }`
- 杩斿洖: `{ success, speech, content, toolResults }`
- 閴存潈: `.env` 涓?`SIRI_API_TOKEN` 鐣欑┖鍒欒烦杩?
### System Prompt
- `GET /PUT /api/ai/system-prompt`

---

## 浜斻€佽闊宠瘑鍒?(ASR)

| 鏂规硶 | 璺緞 | 璇存槑 |
|---|---|---|
| POST | `/api/voice/asr` | 闃块噷浜戜竴鍙ヨ瘽璇嗗埆锛堣嚜鍔ㄨ幏鍙?缂撳瓨 NLS Token锛墊

### 璇锋眰
- `Content-Type: multipart/form-data`
- `audio`: WAV 鏂囦欢 (16kHz, 16bit, mono)
- `format`: `wav` (default)
- `sampleRate`: `16000` (default)

### 鍝嶅簲
```json
{ "success": true, "text": "璇嗗埆鐨勬枃瀛? }
```

### 鐜鍙橀噺
- `ALIYUN_APP_KEY`: NLS 椤圭洰 AppKey
- `ALIYUN_AK_ID` / `ALIYUN_AK_SECRET`: AK/SK锛岀敤浜庤嚜鍔ㄨ幏鍙?NLS Token

---

## 鍏€丳WA 璇煶鍔╂墜

- **鍓嶇璺敱**: `/voice` 锛堢嫭绔嬪叏灞忔覆鏌擄紝涓嶈蛋 App 甯冨眬锛?- **褰曢煶**: AudioContext + ScriptProcessorNode 閲囬泦鍘熷 PCM锛屼笅閲囨牱鍒?16kHz锛岀紪鐮佷负 WAV
- **娴佺▼**: 楹﹀厠椋?鈫?WAV 鈫?`/api/voice/asr` 鈫?鏂囧瓧 鈫?`/api/ai/chat` (SSE) 鈫?缁撴瀯鍖栧崱鐗?- **鍗＄墖鐧藉悕鍗?*: 浠呯簿纭煡璇㈠伐鍏锋覆鏌撳崱鐗囷紝鎵归噺鍒楄〃宸ュ叿鍙樉绀?AI 鏂囧瓧鎬荤粨锛堥槻姝俊鎭硠闇诧級

### Function Calling 宸ュ叿 (20+)

| 宸ュ叿 | 绫诲瀷 |
|---|---|
| `query_recipe_cost_by_name/id` | 鍙 |
| `full_calculate` | 鍙 |
| `get_copper_price`, `calculate_coil_cost`, `get_coil_specs` | 鍙 |
| `get_all_recipes`, `get_all_parts`, `search_parts` | 鍙 |
| `dynamic_config_cost` | 鍙 |
| `get_recent_orders`, `get_order_detail`, `get_dashboard_summary` | 鍙 |
| `compare_recipes`, `generate_purchase_list` | 鍙 |
| `create_part`, `update_part`, `delete_part`, `batch_update_prices` | **鍐欏叆** |
| `create_order`, `update_order_status` | **鍐欏叆** |

---

## 涓冦€佽璇佺郴缁?
鎵€鏈変笟鍔℃帴鍙ｏ紙闆朵欢/閰嶆柟/璁㈠崟/妯℃澘/绾垮湀/鎴愭湰/AI锛夊潎鍙?JWT 璁よ瘉淇濇姢銆?Siri/璇煶鎺ュ彛锛坄/api/siri/*`銆乣/api/voice/*`锛夊強鍋ュ悍妫€鏌ワ紙`/api/health`锛変负鍏紑鎺ュ彛銆?
| 鏂规硶 | 璺緞 | 璇存槑 |
|---|---|---|
| POST | `/api/auth/login` | 瀵嗙爜楠岃瘉鐧诲綍锛屾垚鍔熻缃?HttpOnly Cookie |
| POST | `/api/auth/logout` | 娓呴櫎韬唤 Cookie |
| GET | `/api/auth/check` | 妫€鏌ュ綋鍓嶇櫥褰曠姸鎬?|

### 鐧诲綍璇锋眰
```json
{ "password": "浣犵殑璁块棶瀵嗙爜" }
```

### 瀹夊叏鏈哄埗
- 鐧诲綍鎺ュ彛闄愭祦锛氭瘡 IP 姣忓垎閽熸渶澶?5 娆★紙`express-rate-limit`锛?- JWT 鏈夋晥鏈燂細15 澶?- Token 瀛樺偍锛欻ttpOnly Cookie锛堝墠绔?JS 鏃犳硶璇诲彇锛?- 鐜鍙橀噺锛歚ACCESS_PASSWORD`锛堣闂瘑鐮侊級銆乣JWT_SECRET`锛圝WT绛惧悕瀵嗛挜锛?
---

*鏈枃妗ｄ负鍗曠偣淇℃伅婧?SSOT)锛孉PI 鍙樻洿璇峰悓姝ユ洿鏂般€?
