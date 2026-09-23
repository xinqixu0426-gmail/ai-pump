# relay 读取通道缺陷：根因、证据与修复（2026-09-20）

> 结论先说：**Supervisor 的回复一直存在**，缺的是"读到它"。真实原因是 ChatGPT 页面的**实时 DOM
> 只持有回复的一个片段（或空）**，而完整正文在服务端；`relay` 之前读的是 DOM，所以把 2395 字的裁定
> 读成了 1 个字符。

## 1. 决定性证据（同一 message-id，刷新前后）

| message-id | 刷新前（实时 DOM） | 刷新后（服务端重建） |
|---|---|---|
| `bf08c559` | `裁`（1 字符） | **2395 字符**：「裁定如下。D1 / D3：立项修复，YES。…」 |
| `b736879c` | 空（随后读到 `1`） | **152 字符**：「是，D1/D3 按高优先级 correctness bugfix 立项。…」 |
| `3dbdaca5` | `timeline`（8 字符） | `timeline-ok`（11 字符，完整） |

复现方式（`reload-experiment.cjs`）：先读一遍 DOM，`Page.reload`，等线程重建后再读同一
`data-message-id`。三次结果一致，说明**不是偶发**。

## 2. 排除掉的假设（都做过实验）

| 假设 | 实验 | 结论 |
|---|---|---|
| 只是视口没滚到底部 | `scroll-experiment.cjs`：把 5 个滚动容器都滚到底并等 8s 再读 | **排除**：渲染出的回合集合与每个回复长度**逐字节不变** |
| 页面有渲染报错 | `console-check.cjs`：`Runtime.enable` + `Log.enable` 采集 3s | **排除**：0 条 console/exception |
| 回复正文在页面内嵌 JSON 里 | `census3.cjs`：解析所有 >1KB 的 `<script type="application/json">` | **排除**：`client-bootstrap`（517 KB）里没有消息体，遍历 0 命中 |
| 回复根本没发出去/模型没回 | `sendMessage` 返回值 + 页面流式状态 | **排除**：`submitted=true`、`streaming=true` 再到 `false`，且服务端有正文 |

## 3. 页面结构事实（本次实测，供以后写选择器参考）

- 一个回合 = `section[data-testid="conversation-turn-N"]`，内含**至多一个**
  `[data-message-author-role="assistant"]`；
- 该节点的**第一个裸文本节点就是 message-id**，所以 `node.innerText` 会以 id 开头；
- 生成期间会先出现一个**空回合**（`data-turn-start-message="true"`，长度 0）以及一个
  `data-message-id="request-…"`、内容为「正在思考」的临时节点 —— **读最新回合会读到空**，
  必须"取最近一个有文本的回合"；
- 真正被补全/渲染滞后时，节点内 `.markdown` 只有 1 个字符甚至为空，而服务端是完整的。

## 4. 修复（`cdp.cjs`）

1. **读法**：回复只从回合内 `.markdown` 读取，并剥掉开头的 message-id；
2. **跳过空回合**：递归 `replyOf`，取"最近一个有文本的回合"，同时单独上报 `newestMessageId`
   用于判断"是否出现了新回复"；
3. **完成判据**：`confirmations` 按 settle 窗口正确累计（旧代码 `stableFor % settleMs === 0`
   配 1.5 s 轮询几乎永不成立 → 每次 `ask`/`wait` 都超时）、轮询间隔自适应、发送后要求新回合出现；
4. **陈旧视图恢复（本轮新增）**：当读到的文本"看起来不可能是完整回答"（长度 ≤ 6，或短且无任何
   句读标点、也没有汉字）时，`reloadPage()` 重载页面重建线程后重读；**文本变了就以重载后的为准**，
   文本没变说明本来就是短回答。测例：`timeline-ok`（11 字符）不触发重载；`1`／`裁` 会触发。

## 5. 仍未做/限制

- 恢复动作会**重载页面**：仅在上面那种可疑读数时才发生，正常回答不受影响；如果用户正在这个
  Chrome 窗口里手工滚动或输入，重载会打断它，这是已知代价；
- 只做了 3 次"刷新前后一致"的复现，**没有**统计"实时 DOM 变陈旧"的发生频率；
- 本文件记录的是 relay 侧事实，不改变生产系统行为。
