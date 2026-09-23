# 水泵工厂AI-native智能体｜字段级实施总计划 V1

**基准：** ai-pump / `251f822491d677056f2d7b82f09473a51321d8e1`。

**交付性质：** 已执行计划级自审；尚未实施新业务代码，不构成生产发布批准。41个目标合同，18个实施任务包；完整机器schema、例子、审计脚本和提示词见同名计划包。

**阅读建议：** 老板先看01和05；Codex完整读取对应章节与schema，再从N0.1开始。

---

# 水泵工厂 AI-native 智能体：实施计划包 V1

**基准仓库：** `xinqixu0426-gmail/ai-pump`  
**固定代码：** `251f822491d677056f2d7b82f09473a51321d8e1`（2026-09-21 核对 master 未变化）  
**用途：** 给 Codex 分阶段实施；这是目标设计，不表示新字段、接口、数据库表已经存在。  
**首个执行任务：** `N0.1`。不要一次运行整包，不要自动部署生产。

## 先读什么

- `01-总体计划.md`：老板阅读，说明目标、业务边界、当前和目标架构。
- `02-字段合同.md`：Codex 必读；对象、字段、类型、必填、来源、校验。
- `03-能力复用与接口.md`：现有工具的精确映射、新接口与能力缺口。
- `04-持久化与状态机.md`：任务状态、数据库、恢复、批准、并发。
- `05-分阶段实施.md`：8 个阶段、18 个任务包、修改范围和退出标准。
- `06-测试发布回滚.md`：旧基线、新题库、真实模型门禁、生产切换。
- `07-方案自审.md`：本次实际检查、修正、通过范围与尚未执行的验证。
- `prompts/00-Codex总指令.md`、`prompts/N0.1-开始.md`：开始工作时使用。

`contracts/contracts.schema.json` 是字段级设计参考；`examples/` 全是人工合成示例，金额/ID不是生产事实。`audit/verify_plan.py` 检查本计划，不测试水泵系统；需 Python 和 jsonschema。Codex 实施使用项目现有 Node/测试工具链，不要求把该 Python 脚本装进业务项目。

## 使用步骤

把整个目录放入本地项目的 `planning/ai-native-v1/`（仅计划文件，不覆盖 `api/`、`tests/` 或 `docs/` 现有文件）。先让 Codex 读取总指令，再执行 `N0.1-开始.md`。之后逐个任务包执行，只有当前包 PASS 才进入下一包。后续提示词见 `prompts/01-阶段执行模板.md`，将任务编号替换成具体编号。

**代码版本不同不是立即重置或回滚的理由。** N0 先做差异盘点；若本地保留用户未提交工作，记录并保护，禁止 reset/clean/stash 等隐式清理。GitHub 是单次快照提交，不能假定其中存在文档引用的全部历史 commit。

## 设计原则

保留业务底座；不另建成本、库存或能力目录；不把所有查询改成强制“先计划、再调用模型”；不把“AI-native”变成几十个代理。AI 在同一个有界循环里理解、调查和调整工作；身份、算法、业务状态、批准与金额仍由正式服务决定。

## 执行授权

本计划只授权 Codex 开始本地审计和按阶段开发。生产开关、生产迁移、业务写入放开、设备控制以及不可逆操作，仍分别需要既有审批。一个阶段 PASS 不等于下一阶段或生产发布自动获批。

## 本次交付自审

计划级检查95/95 PASS；41个目标合同对象，446行展开字段说明，16个合成JSON示例。检查不包含仓库npm测试、成本引擎、真实模型或生产。明细见07-方案自审.md及audit/plan-audit-results.json。

整个包是设计交付，不会自动在你的电脑或GitHub执行任何操作。所有后续Codex授权都以你实际发送的任务提示词为准。


---

# 01｜总体计划与业务底座

## 1. 目标和完成定义

把现有系统改成“老板交代完整工作，AI 经办、核对并交付”的水泵工厂智能体。不是做一个新 ERP，也不是只换聊天界面。第一批用户可见结果是：听全目标、保留条件、按同一口径比较配置成本、解释缺口、不修改业务账。

本设计按基准代码和上轮审阅编写。以下“现有”可追到 `audit/source-index.json`；标为“新增/目标”的内容是拟实施合同，不是已存在能力。真实生产进程、环境变量、未提交工作和业务数据不在本次可直接核验范围；由 N0 取得，不能从默认开关或历史报告推定。

### 可验收的产品目标

1. 一句话中的多个目标不能因一个分类标签而丢失；不会做的也要登记和说明，而不是漏掉。
2. 用户修改少量配置时，未提及配置继承正式基准；正式引擎完成成本，不让模型算账。
3. 查询可以跨业务域；“分阶段开放验收场景”不是再给老板建立部门式读取权限。
4. 能区分正式当前值、历史锁定值、假设试算、文件候选、偏好记忆和分析判断。
5. 做完有逐项目标结论；遇到独立失败保留成功证据，不能把全任务都说成失败，也不能全说成完成。
6. 后期支持离开页面后继续只读任务、恢复与继续；正式写入继续走现有确认、版本、幂等、强审计。
7. 简单查询不强制多一次模型规划。复杂任务增加调用必须换来可测量的完成度改善。

## 2. 当前架构（核实后的基准）

```text
/ai 聊天、业务页面、已有外部入口
  → chat.cjs：认证、上下文、SSE、超时与取消
  → aiDispatcherV3：读/受保护写请求分流
  → aiAssistantRuntime 或 aiAgentRuntimeV3
      ├─ 模型工具循环
      ├─ Semantic / Ontology 预排有限读取
      └─ 旧回答保护 + Semantic / Impact 最终处理
  → registry → executor → internalApiClient → 正式API
  → 成本、BOM、配置、订单、采购、库存、文件、知识服务
  → SQLite
```

已有 `BusinessSemanticFrame`、`TaskEnvelope`、能力目录、正式身份、关系查询、执行证据和真实模型验收。工作重点是职责与合同演进，不是再造同名系统。已有 V3/V4 实验文件不能因名字像“规划器”就重新接入主链；先查当前实际调用及兼容约束。

## 3. 目标架构：一个经办循环，三个稳定边界

```text
原始用户目标/文件/页面指代
       ↓
同一经办循环：登记目标 → 解析对象 → 调用正式能力 → 更新证据 → 继续/询问/交付
       ↕                         ↕
TaskEnvelopeV2              已有registry / executor / API
目标、条件、依赖、进度       身份、成本、库存、业务规则的正式实现
       ↓
逐目标核验 → 结构化结论 → 解释与界面
       ↓（只有明确要求正式变更）
原有预览与确认协议 → 正式命令 → 回执及回读
```

三个边界：**模型候选不是事实；工具成功不是任务完成；用户想做某事不是已批准写库。**

### 为什么不直接堆一套新的 Planner

`docs/api-sop.md` 已明确不强制两阶段计划、业务只读不按域授权、失败允许独立继续。新设计沿用这一点：普通单目标直接走已有成熟读取；复合问题在原循环内登记 `goals[]`。解析结果可以来自现有可靠规则或模型的结构化候选，最终都由同一验证入口接收。没有规定每句话必须先调用一个独立规划模型。

在迁移中允许一个任务由 `LEGACY` 或 `TASK_V2` 负责答案，但不能两个运行器先后重写同一结论。新任务仍调用同一 executor。新逻辑通过旧运行器的提取/委托逐步落地，不复制整份 Runtime 改个名字。过渡适配器需要明确退出测试。

### 什么时候保留确定性代码

规格解析、单位换算、日期范围、数据字段、业务默认、调用参数、金额计算及权限适合确定性实现。自由口语和跨业务调查不适合穷举句子。问题不是“有正则”，而是“所有业务理解依赖关键词优先级且不能表达完整目标”。

## 4. 必须保留的业务不变量

| 编号 | 规则 | 现有权威及实施要求 |
|---|---|---|
| B01 | 名称用来找，稳定ID用来绑定 | 复用 entityLookup、正式列表/详情；读候选不等于已经选中；写入不得按模糊首条 |
| B02 | 同规格有多个具体线圈方案 | `coilCost`、`coilQueries`、`coil-domain`；正式/测试/停用分开，不能按最新记录合并 |
| B03 | 两种线圈计价 | calculated 可使用已支持参数；kit 以 kitPrice 为准，参考线重/铜价不参与重算 |
| B04 | 默认选择有业务语境 | 列表披露所有符合范围的候选；试算可在正式政策允许时使用唯一默认并披露；写库存需明确具体方案 |
| B05 | 配方不是模板，也不是型号字符串 | 模板提供结构和默认；配方有完整BOM与自己快照；`V550`不等于唯一配方 |
| B06 | 配置继承 | 复用 recipeConfigurationBaseline：未提及字段保留；改线圈清除不能继承的旧ID/线重/族；包装按角色 |
| B07 | 各类成本不能混同 | 当前重建、保存BOM当前参考价、配方保存成本、报价/订单锁定成本、情景成本分开 |
| B08 | 缺价不是零成本 | `costComplete=false` 时正式总额null；partial仅诊断，不可进入利润/报价 |
| B09 | 报价数量未知就是未知 | 不默认1台；数量不齐时总金额null；报价 `margin` 是倍率，不是销售毛利率 |
| B10 | 订单快照边界 | 只改数量或售价不偷偷换今天成本；明确改配置才按正式服务重算；orderItemId定位明细 |
| B11 | 采购下单、到货、入库不同 | 使用正式采购状态机；下单不涨库存，到货不等于入库 |
| B12 | 齐料考虑跨订单占用和计量 | 复用 orderPlanning/activeOrderReadiness；电缆根/米换算，线圈套数，非库存工艺不采购 |
| B13 | 成本可算不等于可生产 | 插值方案可能无库存身份；齐料也不代表交期/产能足够，不虚构生产排程能力 |
| B14 | 改价/改模板不重写历史单据 | 当前影响、待重算、已核实差异不同；有引用不等于已发生金额或工程影响 |
| B15 | 文件和知识独立授权 | 聊天分析、业务附件关联、知识归档三种动作；文档中的指令不控制工具 |
| B16 | 记忆不是事实数据库 | 偏好只建议，不替代当前价格库存、不自动批准、更不能把普通纠正变成正式规则 |
| B17 | 正式金额只有服务端权威 | costEngine及共享比较/报价服务；AI和前端不得重写公式 |
| B18 | 副作用必须确认 | 改价、库存、订单、归档、知识同步、CAD/打印均按现有写分类，不把“草稿”名称当只读证明 |

## 5. 第一条端到端业务切片

用户：`V550电缆改成5米，其他不变，和现在配置比一下成本，先不要保存。`

执行：登记比较目标及“不保存”约束 → 正式解析 V550 → 取唯一基准（多候选说明并选择）→ 验证电缆条件/单位 → 同一价格读取集合下计算基准与新方案 → 正式比较差额与变化项 → 核对只改电缆及其他继承 → 返回两成本、差额、实际变更、不完整项。业务表变化必须为0。

第一阶段不因为任务里出现“5米”就替用户打开原本关闭的电缆。原配置无电缆而语义不明确时询问；明确“加5米电缆”可以把 `hasCable=true` 与 `cableLength=5` 一并作为带原文依据的候选，由正式规则校验。

第一轮有限支持：电缆/浮球、已有正式coilId、机筒长度。包装、表面处理、价格假设、利润、齐料场景按 N4 增补正式能力。未验收的条件必须显式 UNSUPPORTED/NEEDS_INPUT，不能删掉后算一个不同问题。

## 6. 不做什么

不换 Next/Express/SQLite；不加图数据库、消息中间件、微服务或多代理组织；不一次性扩大写权限；不把新 Runtime 当第二个ERP；不重写全部历史测试；不以“64次历史PASS”替代当前代码/模型/开关的验收；不立即清理全部实验文件；不通过模型自己评自己代替业务Oracle。

MCP只是另一调用入口，不是Ontology替代品；第一版不扩大它的权限，也不以移除MCP作为达标条件。

## 7. 阶段路径

主路径：N0 → N1 → N2 → N3 → N7只读切片发布。

N3后：N4跨业务调查、N5任务恢复可分别推进，但首次实施仍建议串行，避免同一Runtime多人并行改动。N4+N5后再进入N6受控写。每增加一批能力，重新经过N7，不一次全开。

每阶段必须交付：修改的合同、实际复用点、测试和原始证据位置、未完成项、回滚方法、下一步唯一任务。不能把“返回安全拒绝”同时统计为“业务成功”。

## 8. 与外部方法的关系

本设计的主要依据是仓库源码，不是外部模板。外部只采用一个原则：把固定流程与动态调查组合，先用简单可组合模式，只有结果可测量改善才增加复杂度。参考 Anthropic《Building effective agents》；这不要求引入其SDK或替换现有模型提供商。


---

# 02｜字段级合同（目标设计，尚未实现）

本文件对应 `contracts/contracts.schema.json`。JSON Schema 供审计和测试示例使用；实施时优先使用项目已安装的 Zod/现有验证基础设施，不为此引入新的运行时框架。N1 必须把本合同与实现的正常/反例测试锁定；随后字段文档从规范声明生成，禁止手工维护三套不一致结构。

## 1. 统一约定

- 对外/内部DTO采用camelCase；DB列名snake_case。数据库ID保持既有正整数；DTO统一十进制字符串的地方，在API适配时验证 `Number.isSafeInteger` 后转为既有整数。
- 任务/步骤/回执/问题使用服务端UUID。模型只能提出局部 `subjectKey/goalKey/scenarioKey`，不能提出正式资源ID、权限、执行状态、operationId或receiptId。
- `conversationId`沿用**`chat-123`**格式，不能当整数直接查数据库；服务端使用既有 `conversationIdFromTransport`，并检查当前认证主体所属。
- `revision`是任务运行状态版本；`planRevision`是目标/配置/选择版本。普通进度变化不能让批准无端失效，但计划变更必须使旧确认不能执行。
- 成本/金额沿用正式服务number输出及现有舍入；新schema不取代成本算法。金额可为null，差额可为负。不得用 `value || 0` 把未知变成零。
- `ScenarioOverridesV1`没出现某字段=继承；出现false/0/空数组=用户明确提出的变化，还需对应正式业务规则。null不能作为“随便清空”。
- 槽型、材质、状态、线径/截面积不能由模型补默认。原引擎的正式默认/兼容策略仍保留，使用时记录 `FORMAL_POLICY`，不能把“规则默认”伪装成用户明确指定。
- 所有时间为UTC ISO 8601。`observedAt`是本轮读到的时间，`sourceUpdatedAt`是源记录时间，`calculatedAt`是计算时间；都不等于行情的 `asOf`。无法取得源时间就null，不伪造。
- 下面schema未声明的字段默认拒绝。允许原始正式配置/结果对象的少数opaque字段，只能由server adapter填入，绝不能直接采用模型对象。

## 2. 字段的写入责任

| 字段组 | 可提出者 | 有权最终写入者 | 校验 |
|---|---|---|---|
| 目标、原文片段、变更候选 | 模型/现有确定性解析 | 候选验证器 | 对应原文；多个目标不可丢；保留未解析片段 |
| canonical ID、候选集合、匹配方式 | 模型只能建议查询 | 正式目录/API适配器 | 精确/批准别名/正式默认；候选截断不得宣称唯一 |
| 任务权限、预算、owner、运行状态 | 无 | 认证路由/控制器 | 忽略或拒绝同名客户端字段；不由prompt控制 |
| 应用后的配置、正式金额 | 无 | 现有业务服务/新增共享预览封装 | 配置hash、口径、readSet、实际applied一致 |
| receipt/fact/evidenceState | 无 | 本轮executor结果摄取器 | 真正的本轮调用，指向实际结果，不能从聊天metadata恢复信任 |
| 问题及候选选择 | 模型可提问措辞 | 服务端问题状态+用户选项 | 当前task+planRevision+owner+候选hash+有效期 |
| 正式变更批准 | 模型无权批准 | 既有确认token协议 | 版本/参数hash/正式Preview/当前计划同时匹配 |
| 成功结论 | 模型可提出AnswerDraft | 逐目标验证器 | 目标要求的全部事实已满足，不能用调用成功代替 |

## 3. 从用户原话到参数的合同

`SourceSpan.start/end`使用JavaScript字符串的UTF-16代码单元，左闭右开。例如中文、英文和emoji一起出现时，按JS `slice()`而不是Python字符数验证。必须保存原始文本或其不可变引用。归一化得到新字符串时必须保留位置映射；不能先删标点再宣称原文精确绑定。

每个危险/关键参数的叶字段必须有 `ArgumentSource`。来源只允许：原文、正式回执、受绑定的用户选择、正式业务政策、基准继承。对象名和ID从正式解析得到；`schemeCode`只在现有线圈能力支持时传递，不擅自当成数字ID。

`typeHints`只是候选，不创建“pump_model=V550”这样的新正式实体。全局管理查询可以没有具体subjects；global事实限当前部署和任务空间，不编造工厂ID。

### 单位与值的具体规则

| 字段 | 业务单位/类型 | 必须做的检查 |
|---|---|---|
| cableLength | number，m | “500cm”只能按有依据的换算成为5m；无单位且语境不明时询问；hasCable=true时必须正数 |
| cableWire | string，mm² | `"0.55"`是截面积，不是直径；不能拿绕组漆包线的mm代替 |
| customBarrelLength | number，mm | 正数；连动机筒/长螺丝仍交给原业务引擎 |
| coilSheets | integer，片 | 精确方案/方案族由现有线圈服务校验；不能跨材质/槽型插值 |
| coilId | integer | 必须当前正式候选；不能选testing做正式产品成本 |
| hasFloat/hasCable | boolean | “没提到”不等于false；否定语句应明确绑定原文 |
| packingParts[].partId | integer | 正式包材；型号/供应商/分类交叉核对，不能接受模型给的单价 |
| packingParts[].qty | number | 0用于明确的移除语义时需适配现有角色合并；不能直接传入不接受0的snapshot入口 |
| surfaceTreatmentMode/Cost | enum / CNY | 成对规则；none的费用按正式政策处理，不能仅换名称留下旧费 |
| wireWeight | number，kg | 目前是线圈试算参数，不自动变成整机铜价/线重覆盖能力 |
| copperPrice | number+单位 | 元/吨与元/千克分开；当前AI线圈schema未开放此参数，整机也不能假装支持 |
| quantity | number+单位 | 产品台数新任务要求正整数；数量未知null，不能默认1 |
| unitPrice | number，CNY/台 | 仅用户假设售价/正式报价来源，不自动保存；币种不同必须有正式汇率政策，否则不换算 |

## 4. 核心运行对象

`TaskProposalV1`是候选；`TaskEnvelopeV2`是服务端任务状态；`FactRecordV1`只保存已验证事实。它们不是三套规划器：分别对应不可信输入、执行上下文和正式依据。

TaskEnvelopeV1保持兼容。N1可在现有services目录新增 `aiTaskContractV2.cjs`，不复制整份Runtime；旧导出不改语义。若某文件有内容冻结测试，先采用显式版本化适配和批准的合同变更，不修改旧hash断言以伪造通过。

### 必须由代码验证、不能只靠JSON Schema的规则

1. goalKey/subjectKey/scenarioKey唯一；依赖存在且无环。`base`为服务端保留scenarioKey。
2. goal引用的subjects、scenarios必须存在；step引用的goals必须存在；事实必须属于本任务的受信回执。
3. 原文span范围有效，原文逐字匹配，数值/条件不能来自模型常识。
4. `UNIQUE`须有唯一、完整、权威候选和selected；`MULTIPLE`不能偷偷选selected；多候选经明确选择使用`SELECTED`，并验证USER_CHOICE或FORMAL_DEFAULT证据，不按数组第一项。
5. Task SUCCEEDED ⇔ 所有仍被用户要求的goals为VERIFIED；不能靠取消/省略难目标变成成功。
6. `cost.complete=false` → `currentTotalCost=null`、差额null、利润null；部分值仍可作诊断。
7. 只有相同readSet和同口径的两个情景可以产生比较delta；跨快照只能称历史与当前对比，不能归因成“仅电缆变化”。
8. 输入覆盖、返回配置和applied必须相符。提交了参数、工具返回success，都不证明参数真的应用。
9. `VERIFIED_NEGATIVE`须限定查询范围完整；超时/截断/未查询不进事实账本。
10. `supersedesFactId`只允许相同FactKey且有更高业务版本/更新权威读取；其他来源和其他情景不能覆盖。
11. 只读阶段任何COMMAND步骤不得运行，知识同步/归档/出图/打印也一样。
12. sourceHash只是内容摘要，不是签名。客户端或文件写一个相同hash不产生可信来源。
13. `TaskResume.answers`每项只能填choiceId或answerText其中一个；旧问题、错owner、过期候选需重查。
14. terminal任务不可原地复活；后续工作建立parentTaskId，重新核实易变证据。
15. FactKey不包含readSetId、fetchedAt或工具名；这些变化不会创建新的逻辑事实身份。来源变化保留在FactRecord，不能以最新观察替换不同业务时态。
16. Goal.requirements逐项匹配predicate、subject、scenario、temporalScope和basis；仅出现相同predicate不够。UNSUPPORTED目标可以没有requirements，但必须有blocker；VERIFIED目标必须有至少一条满足的requirement。
17. WAITING_INPUT/WAITING_APPROVAL不消耗运行时长；保存累计activeMs。恢复只重设剩余活动时长的deadline，不重置模型/工具调用总预算；预算耗尽交付PARTIAL或另建子任务。
18. TaskPublicView白名单投影不得暴露ownerKey、租约、完整参数、内部receipt或confirmationToken。确认卡仍走既有受保护通道。

19. 未找到对象但没有canonical ID时，FactKey.entityId=null，必须带queryScopeHash绑定正式查询条件和范围；不能把两个未知型号的负结果当一个事实。global事实允许entityId=null，但不等于其他对象不存在。
20. scenarioKey在同一任务内标识不可变的配置假设；改变配置需新key并增加planRevision，不能用同名情景覆盖旧假设。比较必须核对同readSet，而不是仅看两字段都是CNY。

21. 当前/情景目标只引用本planRevision核实的事实；恢复后的旧当前事实不能直接满足要求。不可变历史快照可保留，但须保持其历史口径及版本，不升级为当前事实。
22. 具名目标的FactRequirement必须先有UNIQUE/SELECTED的正式身份；不能以global事实替代未解析对象。非实体参数澄清可choices=[]并使用answerText，不能伪造一个“是/否”实体。
23. AnswerDraft.analysisText仍经过金额、身份、业务状态与敏感结论校验；不能把缺证据内容放入“分析”字段就绕过。无法证明的段落只保留明确假设或删去该段；模型自评通过不构成证据。

## 5. 精确字段字典

以下从JSON Schema展开。嵌套字段“必填”以其父对象存在为前提；`可空`与`可省略`不同。`$ref`对象在对应专节完整列明。opaque字段只能来自正式服务。

### SourceSpan



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `messageRef` | string | 是 | 本轮请求或服务端载入的用户消息引用，不是模型自造事实来源；minLength=1；maxLength=100 |
| `start` | integer | 是 | 原始字符串UTF-16代码单元起点，含起点；minimum=0 |
| `end` | integer | 是 | UTF-16终点，不含终点；minimum=1 |
| `text` | string | 是 | 必须严格等于原文slice(start,end)，解析前不得改变标点；minLength=1；maxLength=2000 |

### QuantityInput



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `value` | number | 是 | 用户明确数量；不填不能默认为1；minimum=0 |
| `unit` | 枚举：pump, piece, set, m, mm, mm2, kg, sheet, CNY, CNY_PER_KG, CNY_PER_TON, ratio | 是 |  |
| `sources` | 数组<SourceSpan> | 是 | minItems=1；maxItems=8 |

### ProposedOverride

待核实用户变更；coilSelection/packingSelection用原文，不允许模型直接填业务ID。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `field` | 枚举：hasFloat, floatWire, floatAccessoryType, hasCable, cableLength, cableWire, cableAccessoryType, coilSelection, coilSheets, customBarrelLength, packingSelection, surfaceTreatmentMode, surfaceTreatmentCost, hasStainlessShaftJoint, stainlessShaftJointCost, wireWeight, copperPrice | 是 |  |
| `value` | boolean / number / string | 是 |  |
| `unit` | string / null | 是 |  |
| `sources` | 数组<SourceSpan> | 是 | minItems=1；maxItems=8 |

### GoalProposal



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `goalKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `kind` | 枚举：CURRENT_COST, CONFIGURATION_COMPARE, COIL_QUERY, INVENTORY_QUERY, ORDER_READINESS, CUSTOMER_HISTORY, QUOTATION_QUERY, FILE_INSPECT, KNOWLEDGE_QUERY, MANAGEMENT_OVERVIEW, BUSINESS_CHANGES, IMPACT_INVESTIGATION, PROFITABILITY, PREPARE_CHANGE, APPLY_CHANGE, OTHER | 是 |  |
| `description` | string | 是 | minLength=1；maxLength=500 |
| `subjectKeys` | 数组<string> | 是 | minItems=0；maxItems=8 |
| `scenarioKeys` | 数组<string> | 是 | minItems=0；maxItems=4 |
| `dependsOn` | 数组<string> | 是 | minItems=0；maxItems=8 |
| `requestedBasis` | 枚举：CURRENT, SAVED, HYPOTHETICAL, UNKNOWN | 是 |  |
| `sources` | 数组<SourceSpan> | 是 | minItems=1；maxItems=8 |
| `quantity` | QuantityInput / null | 是 |  |
| `unitPrice` | QuantityInput / null | 是 |  |

### TaskProposalV1

模型候选，不是执行授权；可在原工具循环内增量生成，不要求每个查询先单独调用规划模型。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `goalSummary` | string | 是 | minLength=1；maxLength=2000 |
| `subjects` | 数组<object> | 是 | minItems=0；maxItems=12 |
| `subjects[].subjectKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `subjects[].mention` | string | 是 | minLength=1；maxLength=160 |
| `subjects[].typeHints` | 数组<枚举：part, coil, template, recipe, customer, quotation, order, file, knowledge, business_record> | 是 | minItems=0；maxItems=6 |
| `subjects[].sources` | 数组<SourceSpan> | 是 | minItems=1；maxItems=8 |
| `scenarios` | 数组<object> | 是 | minItems=0；maxItems=4 |
| `scenarios[].scenarioKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `scenarios[].label` | string | 是 | minLength=1；maxLength=80 |
| `scenarios[].baseSubjectKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `scenarios[].overrides` | 数组<ProposedOverride> | 是 | minItems=0；maxItems=20 |
| `scenarios[].sources` | 数组<SourceSpan> | 是 | minItems=1；maxItems=8 |
| `goals` | 数组<GoalProposal> | 是 | minItems=1；maxItems=8 |
| `unparsedSpans` | 数组<SourceSpan> | 是 | minItems=0；maxItems=12 |

### CanonicalEntity



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `entityType` | 枚举：part, coil, template, recipe, customer, quotation, order, file, knowledge, business_record | 是 |  |
| `entityId` | string | 是 | 现有整数主键的十进制字符串；稳定编码只用于解析，不替代ID；pattern=^[1-9][0-9]*$ |
| `displayName` | string | 是 | minLength=1；maxLength=240 |
| `updatedAt` | string / null | 是 |  |
| `recordHash` | string / null | 是 |  |
| `schemeCode` | string / null | 是 |  |

### SubjectBinding

UNIQUE只指候选天然唯一；多候选明确选择用SELECTED并提供USER_CHOICE/FORMAL_DEFAULT证据，MULTIPLE不含selected。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `subjectKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `mention` | string | 是 | minLength=1；maxLength=160 |
| `resolution` | 枚举：UNRESOLVED, UNIQUE, MULTIPLE, NOT_FOUND, UNAVAILABLE, SELECTED | 是 |  |
| `selected` | CanonicalEntity / null | 是 |  |
| `candidates` | 数组<CanonicalEntity> | 是 | minItems=0；maxItems=20 |
| `candidateSetComplete` | boolean | 是 |  |
| `selectionBasis` | 枚举：NONE, EXPLICIT_ID, EXACT, APPROVED_ALIAS, USER_CHOICE, FORMAL_DEFAULT, BASELINE_INHERITANCE | 是 |  |
| `receiptIds` | 数组<string> | 是 | minItems=0；maxItems=16 |

### ArgumentSource

USER_SPAN必须span非空，其他来源span=null；FORMAL_RECEIPT有JSON Pointer；FORMAL_POLICY引用稳定规则编号而非模型文字。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `fieldPath` | string | 是 | 参数的JSON Pointer，如 /overrides/cableLength；pattern=^/ |
| `kind` | 枚举：USER_SPAN, FORMAL_RECEIPT, USER_CHOICE, FORMAL_POLICY, BASELINE_INHERITANCE | 是 |  |
| `sourceRef` | string | 是 | minLength=1；maxLength=160 |
| `pointer` | string / null | 是 |  |
| `span` | SourceSpan / null | 是 |  |

### PackingPart



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `partId` | integer | 是 | minimum=1 |
| `model` | string | 是 | minLength=1；maxLength=160 |
| `supplier` | string | 是 | maxLength=160 |
| `qty` | number | 是 | minimum=0 |
| `packingRole` | 枚举：container, pearlCotton, foam, fixed | 是 |  |

### ScenarioOverridesV1

新增情景比较接口的目标字段全集。N2/N3默认只验收电缆/浮球/精确coilId/机筒；包装和表面处理到N4能力证据齐全才开放。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `hasFloat` | boolean | 否 | 是否带浮球 |
| `floatWire` | string | 否 | 沿用现有正式字段，不能把电缆截面积当漆包线直径；minLength=1；maxLength=40 |
| `floatAccessoryType` | 枚举：standard, xinjie | 否 |  |
| `hasCable` | boolean | 否 | 是否启用电缆 |
| `cableLength` | number | 否 | 电缆长度，m；启用时须>0，由正式服务交叉校验；minimum=0 |
| `cableWire` | string | 否 | 电缆横截面积mm²；传递字符串如0.55，不是线径mm；minLength=1；maxLength=40 |
| `cableAccessoryType` | 枚举：standard, xinjie | 否 |  |
| `coilId` | integer | 否 | 本轮正式解析取得的具体正式线圈方案ID；minimum=1 |
| `coilSheets` | integer | 否 | 整数片数；非精确片数/插值必须另外完成方案族适配验收；minimum=1 |
| `customBarrelLength` | number | 否 | 机筒长度mm；exclusiveMinimum=0 |
| `packingParts` | 数组<PackingPart> | 否 | 显式包装变更；空数组与未提供不同，必须核实用户清空意图；minItems=0；maxItems=12 |
| `surfaceTreatmentMode` | 枚举：none, painting, electrophoresis, electrophoresis_powder_coating, powder_coating, custom | 否 |  |
| `surfaceTreatmentCost` | number | 否 | 元；工艺和费用必须成对由正式规则校验；minimum=0 |

### ScenarioCompareRequestV1

拟新增POST /api/recipes/:id/scenario-compare-preview的body；recipeId只在path/工具封套。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `baselinePolicy` | 固定值 "CURRENT_REBUILT" | 是 |  |
| `scenarios` | 数组<object> | 是 | minItems=1；maxItems=3 |
| `scenarios[].scenarioKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `scenarios[].label` | string | 是 | minLength=1；maxLength=80 |
| `scenarios[].overrides` | ScenarioOverridesV1 | 是 |  |

### ReadVersion



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `entityType` | string | 是 | minLength=1；maxLength=80 |
| `entityId` | string | 是 | minLength=1；maxLength=120 |
| `updatedAt` | string / null | 是 |  |
| `contentHash` | string | 是 | pattern=^[a-f0-9]{64}$ |

### CostValue



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `complete` | boolean | 是 |  |
| `currentTotalCost` | number / null | 是 |  |
| `partialTotalCost` | number / null | 是 |  |
| `currency` | 固定值 "CNY" | 是 |  |
| `unit` | 固定值 "pump" | 是 |  |
| `costBasis` | 枚举：CURRENT_REBUILT_BASE, CURRENT_REBUILT_SCENARIO | 是 |  |
| `missingParts` | 数组<string> | 是 | minItems=0；maxItems=100 |
| `sourceOfTruth` | 固定值 "costEngine" | 是 |  |

### ScenarioResult



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `scenarioKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `role` | 枚举：BASE, CANDIDATE | 是 |  |
| `configurationHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `configuration` | object | 是 | 正式BOM/配置服务的有界无损快照；不得由模型填充，字段遵循现有服务 |
| `requestedOverrides` | ScenarioOverridesV1 | 是 |  |
| `appliedOverrides` | ScenarioOverridesV1 | 是 |  |
| `notApplied` | 数组<object> | 是 | minItems=0；maxItems=20 |
| `notApplied[].field` | string | 是 | minLength=1；maxLength=80 |
| `notApplied[].reasonCode` | string | 是 | minLength=1；maxLength=80 |
| `inheritedFields` | 数组<string> | 是 | minItems=0；maxItems=100 |
| `cost` | CostValue | 是 |  |

### ScenarioCompareResponseV1

正式服务返回值，不是模型构造。readSetHash只证明同一读取集合，不等于法律签名或绝对最新。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `preview` | 固定值 true | 是 |  |
| `comparisonId` | string | 是 | format=uuid |
| `recipe` | CanonicalEntity | 是 |  |
| `normalizedInput` | ScenarioCompareRequestV1 | 是 |  |
| `readSetId` | string | 是 | format=uuid |
| `readSetHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `sourceVersions` | 数组<ReadVersion> | 是 | minItems=1；maxItems=128 |
| `calculatedAt` | string | 是 | format=date-time |
| `scenarios` | 数组<ScenarioResult> | 是 | minItems=2；maxItems=4 |
| `comparisons` | 数组<object> | 是 | minItems=1；maxItems=3 |
| `comparisons[].baseScenarioKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `comparisons[].candidateScenarioKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `comparisons[].status` | 枚举：COMPARABLE, INCOMPLETE, OVERRIDE_NOT_APPLIED | 是 |  |
| `comparisons[].delta` | number / null | 是 |  |
| `comparisons[].currency` | 固定值 "CNY" | 是 |  |
| `comparisons[].drivers` | 数组<object> | 是 | minItems=0；maxItems=40 |
| `comparisons[].drivers[].costRole` | string | 是 | maxLength=100 |
| `comparisons[].drivers[].description` | string | 是 | maxLength=500 |
| `comparisons[].drivers[].delta` | number | 是 |  |
| `comparisons[].drivers[].sourcePointers` | 数组<string> | 是 | minItems=1；maxItems=8 |
| `changes` | 数组<object> | 是 | minItems=0；maxItems=100 |
| `changes[].scenarioKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `changes[].field` | string | 是 | minLength=1；maxLength=100 |
| `changes[].from` | 正式JSON值 | 是 |  |
| `changes[].to` | 正式JSON值 | 是 |  |
| `warnings` | 数组<object> | 是 | minItems=0；maxItems=40 |
| `warnings[].code` | string | 是 | minLength=1；maxLength=100 |
| `warnings[].message` | string | 是 | minLength=1；maxLength=1000 |
| `sourceVersionCount` | integer | 是 | minimum=1 |
| `sourceVersionsComplete` | boolean | 是 |  |

### FactKey



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `entityType` | 枚举：part, coil, template, recipe, customer, quotation, order, file, knowledge, business_record, global | 是 |  |
| `entityId` | string / null | 是 |  |
| `predicate` | string | 是 | minLength=1；maxLength=100 |
| `temporalScope` | 枚举：CURRENT, SAVED, HISTORICAL, SCENARIO | 是 |  |
| `scenarioKey` | string / null | 是 |  |
| `qualifiers` | object | 是 |  |
| `qualifiers.basis` | string | 是 | minLength=1；maxLength=100 |
| `qualifiers.unit` | string | 是 | minLength=1；maxLength=32 |
| `qualifiers.currency` | string / null | 是 |  |
| `qualifiers.snapshotVersion` | string / null | 是 |  |
| `qualifiers.queryScopeHash` | string / null | 是 |  |

### FactRecordV1

readSetId属于观测来源，不属于FactKey；同一逻辑事实的新版本可显式supersede。不同任务/场景/时态不可偷换。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `factId` | string | 是 | format=uuid |
| `key` | FactKey | 是 |  |
| `evidenceState` | 枚举：VERIFIED_POSITIVE, VERIFIED_NEGATIVE | 是 |  |
| `value` | 正式JSON值 | 是 |  |
| `receiptId` | string | 是 | format=uuid |
| `resultPointer` | string | 是 | 指向正式executor结果的JSON Pointer；pattern=^/ |
| `observedAt` | string | 是 | format=date-time |
| `sourceUpdatedAt` | string / null | 是 |  |
| `sourceHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `complete` | boolean | 是 | 集合事实证明范围完整；不是对整项用户目标的评价 |
| `supersedesFactId` | string / null | 是 |  |
| `planRevision` | integer | 是 | minimum=1 |
| `readSetId` | string / null | 是 |  |

### GoalState



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `goalKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `kind` | 枚举：CURRENT_COST, CONFIGURATION_COMPARE, COIL_QUERY, INVENTORY_QUERY, ORDER_READINESS, CUSTOMER_HISTORY, QUOTATION_QUERY, FILE_INSPECT, KNOWLEDGE_QUERY, MANAGEMENT_OVERVIEW, BUSINESS_CHANGES, IMPACT_INVESTIGATION, PROFITABILITY, PREPARE_CHANGE, APPLY_CHANGE, OTHER | 是 |  |
| `description` | string | 是 | minLength=1；maxLength=500 |
| `subjectKeys` | 数组<string> | 是 | minItems=0；maxItems=8 |
| `scenarioKeys` | 数组<string> | 是 | minItems=0；maxItems=4 |
| `dependsOn` | 数组<string> | 是 | minItems=0；maxItems=8 |
| `state` | 枚举：PENDING, RUNNING, VERIFIED, PARTIAL, NEEDS_INPUT, UNSUPPORTED, FAILED, CANCELLED | 是 |  |
| `factIds` | 数组<string> | 是 | minItems=0；maxItems=64 |
| `blockers` | 数组<object> | 是 | minItems=0；maxItems=12 |
| `blockers[].code` | string | 是 | minLength=1；maxLength=100 |
| `blockers[].message` | string | 是 | minLength=1；maxLength=1000 |
| `blockers[].questionId` | string / null | 是 |  |
| `requirements` | 数组<FactRequirement> | 是 | minItems=0；maxItems=24 |

### TaskStep



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `stepId` | string | 是 | format=uuid |
| `goalKeys` | 数组<string> | 是 | minItems=1；maxItems=8 |
| `toolName` | string | 是 | minLength=1；maxLength=100 |
| `capabilityId` | string | 是 | minLength=1；maxLength=160 |
| `access` | 枚举：QUERY, PREVIEW, COMMAND | 是 |  |
| `arguments` | object | 是 |  |
| `argumentSources` | 数组<ArgumentSource> | 是 | minItems=0；maxItems=80 |
| `argsHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `state` | 枚举：PLANNED, RUNNING, SUCCEEDED, FAILED, CANCELLED, UNKNOWN_EFFECT | 是 |  |
| `attempt` | integer | 是 | minimum=1；maximum=10 |
| `startedAt` | string / null | 是 |  |
| `finishedAt` | string / null | 是 |  |
| `receiptId` | string / null | 是 |  |
| `operationId` | string / null | 是 |  |
| `errorCode` | string / null | 是 |  |

### Clarification



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `questionId` | string | 是 | format=uuid |
| `planRevision` | integer | 是 | minimum=1 |
| `goalKeys` | 数组<string> | 是 | minItems=1；maxItems=8 |
| `prompt` | string | 是 | minLength=1；maxLength=1000 |
| `reasonCode` | string | 是 | minLength=1；maxLength=100 |
| `choices` | 数组<object> | 是 | minItems=0；maxItems=20 |
| `choices[].choiceId` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `choices[].label` | string | 是 | minLength=1；maxLength=240 |
| `choices[].entity` | CanonicalEntity | 是 |  |
| `candidateSetHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `expiresAt` | string | 是 | format=date-time |
| `answeredAt` | string / null | 是 |  |

### TaskEnvelopeV2

运行态DTO，数据库分别存任务spec、步骤、事实和事件；不把整张DTO重复存四份。新业务范围可以提议，但未验收能力只能标为不支持，不能改成SUCCESS。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 2 | 是 |  |
| `taskId` | string | 是 | format=uuid |
| `parentTaskId` | string / null | 是 |  |
| `ownerKey` | string | 是 | 仅服务端保存；公共DTO不返回。由认证请求取值，不接受请求body；minLength=1；maxLength=80 |
| `conversationId` | string / null | 是 |  |
| `requestId` | string | 是 | minLength=1；maxLength=160 |
| `revision` | integer | 是 | 每次状态持久化增加；minimum=1 |
| `planRevision` | integer | 是 | 目标/参数/选择改变才增加；与运行revision分离；minimum=1 |
| `state` | 枚举：NEW, UNDERSTANDING, RESOLVING, RUNNING, WAITING_INPUT, WAITING_APPROVAL, VERIFYING, SUSPENDED, RECONCILING, SUCCEEDED, PARTIAL, UNSUPPORTED, FAILED, CANCELLED | 是 |  |
| `answerOwner` | 固定值 "TASK_V2" | 是 |  |
| `executionMode` | 枚举：FOREGROUND, DETACHED | 是 |  |
| `userGoal` | string | 是 | minLength=1；maxLength=2000 |
| `inputHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `createdAt` | string | 是 | format=date-time |
| `updatedAt` | string | 是 | format=date-time |
| `constraints` | object | 是 |  |
| `constraints.businessWritePolicy` | 枚举：FORBIDDEN, CONFIRMATION_REQUIRED | 是 |  |
| `constraints.maxModelCalls` | integer | 是 | minimum=1；maximum=7 |
| `constraints.maxToolCalls` | integer | 是 | minimum=1；maximum=10 |
| `constraints.maxToolResultBytes` | 固定值 98304 | 是 |  |
| `constraints.maxTaskStateBytes` | 固定值 262144 | 是 |  |
| `constraints.deadlineAt` | string / null | 是 |  |
| `constraints.maxApiCalls` | integer | 是 | minimum=1；maximum=128 |
| `constraints.maxActiveMs` | integer | 是 | minimum=10000；maximum=900000 |
| `subjects` | 数组<SubjectBinding> | 是 | minItems=0；maxItems=12 |
| `goals` | 数组<GoalState> | 是 | minItems=1；maxItems=8 |
| `scenarios` | 数组<object> | 是 | minItems=0；maxItems=4 |
| `scenarios[].scenarioKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `scenarios[].label` | string | 是 | minLength=1；maxLength=80 |
| `scenarios[].baseSubjectKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `scenarios[].basis` | 枚举：CURRENT_REBUILT, RECIPE_SNAPSHOT, QUOTATION_LOCKED, ORDER_LOCKED | 是 |  |
| `scenarios[].priceContext` | 枚举：FORMAL_READ_SET, LOCKED_SNAPSHOT, USER_HYPOTHESIS | 是 |  |
| `scenarios[].overrides` | ScenarioOverridesV1 | 是 |  |
| `scenarios[].readSetId` | string / null | 是 |  |
| `steps` | 数组<TaskStep> | 是 | minItems=0；maxItems=10 |
| `facts` | 数组<FactRecordV1> | 是 | minItems=0；maxItems=64 |
| `questions` | 数组<Clarification> | 是 | minItems=0；maxItems=12 |
| `approvalOperationIds` | 数组<string> | 是 | minItems=0；maxItems=8 |
| `resultSummary` | string / null | 是 |  |
| `budgetUsage` | object | 是 |  |
| `budgetUsage.modelCalls` | integer | 是 | minimum=0 |
| `budgetUsage.toolCalls` | integer | 是 | minimum=0 |
| `budgetUsage.apiCalls` | integer | 是 | minimum=0 |
| `budgetUsage.activeMs` | integer | 是 | minimum=0 |

### TaskStartRequestV1

N5拟新增POST /api/ai/tasks；Idempotency-Key走请求头。加载当前主体所属会话的user消息，忽略客户端assistant事实。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `conversationId` | string | 是 | pattern=^chat-[1-9][0-9]*$ |
| `userMessageId` | integer | 是 | minimum=1 |
| `executionMode` | 固定值 "DETACHED" | 是 | 该接口只创建显式后台任务；前台仍用原chat接口。 |

### TaskResumeRequestV1

N5拟新增resume；每项choiceId/answerText二选一，代码做跨字段校验。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `expectedRevision` | integer | 是 | minimum=1 |
| `answers` | 数组<object> | 是 | minItems=0；maxItems=12 |
| `answers[].questionId` | string | 是 | format=uuid |
| `answers[].choiceId` | string / null | 是 |  |
| `answers[].answerText` | string / null | 是 |  |
| `executionMode` | 固定值 "DETACHED" | 是 | 明确选择后台继续；原前台记录在此转换，不能隐式转换。 |

### TaskCancelRequestV1



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `expectedRevision` | integer | 是 | minimum=1 |
| `reason` | string | 是 | maxLength=500 |

### AnswerDraftV1

模型交付候选；数值、身份、已应用覆盖、齐料状态通过fact引用渲染，不能相信模型自行写出的结果。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `sections` | 数组<object> | 是 | minItems=1；maxItems=16 |
| `sections[].goalKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `sections[].claimType` | 枚举：COST, COMPARISON, CATALOG, INVENTORY, READINESS, HISTORY, DOCUMENT, LIMITATION, CHANGE_PREVIEW, CHANGE_RECEIPT | 是 |  |
| `sections[].factIds` | 数组<string> | 是 | minItems=0；maxItems=24 |
| `sections[].templateKey` | string | 是 | minLength=1；maxLength=100 |
| `sections[].analysisText` | string | 是 | 只能作为推断说明；关键业务判断由模板和已验证事实产生；maxLength=1500 |

### FactRequirement

服务端按目标和正式能力生成；null subjectKey仅表示部署级global事实。不是模型自定义验收标准。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `requirementKey` | string | 是 | minLength=1；maxLength=100 |
| `predicate` | string | 是 | minLength=1；maxLength=100 |
| `subjectKey` | string / null | 是 |  |
| `scenarioKey` | string / null | 是 |  |
| `temporalScope` | 枚举：CURRENT, SAVED, HISTORICAL, SCENARIO | 是 |  |
| `basis` | string / null | 是 |  |
| `requireComplete` | boolean | 是 |  |
| `unit` | string / null | 是 |  |
| `currency` | string / null | 是 |  |

### ExecutionReceiptV1

仅服务端实际executor调用后生成。origin和hash只是记录，不能代替内存来源/存储访问控制；验证需独立可信回执集合。result最大96KiB。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `receiptId` | string | 是 | format=uuid |
| `taskId` | string | 是 | format=uuid |
| `stepId` | string / null | 是 |  |
| `planRevision` | integer | 是 | minimum=1 |
| `toolName` | string | 是 | minLength=1；maxLength=100 |
| `capabilityId` | string | 是 | minLength=1；maxLength=160 |
| `access` | 枚举：QUERY, PREVIEW, COMMAND | 是 |  |
| `argsHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `origin` | 固定值 "SERVER_EXECUTOR" | 是 |  |
| `observedAt` | string | 是 | format=date-time |
| `readSetId` | string / null | 是 |  |
| `sourceHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `projectionVersion` | 固定值 1 | 是 |  |
| `result` | object | 是 |  |

### CompareRecipeScenariosToolInputV1

在现有AI_TOOLS登记的拟新增工具参数；不是客户端TaskProposal的字段。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `recipeId` | integer | 是 | minimum=1 |
| `version` | 固定值 1 | 是 |  |
| `baselinePolicy` | 固定值 "CURRENT_REBUILT" | 是 |  |
| `scenarios` | 数组<object> | 是 | minItems=1；maxItems=3 |
| `scenarios[].scenarioKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `scenarios[].label` | string | 是 | minLength=1；maxLength=80 |
| `scenarios[].overrides` | ScenarioOverridesV1 | 是 |  |

### TaskAcknowledgementV1



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `taskId` | string | 是 | format=uuid |
| `revision` | integer | 是 | minimum=1 |
| `state` | 枚举：NEW, UNDERSTANDING, RESOLVING, RUNNING, WAITING_INPUT, WAITING_APPROVAL, VERIFYING, SUSPENDED, RECONCILING, SUCCEEDED, PARTIAL, UNSUPPORTED, FAILED, CANCELLED | 是 |  |
| `executionMode` | 枚举：FOREGROUND, DETACHED | 是 |  |
| `statusPath` | string | 是 | pattern=^/api/ai/tasks/[0-9a-f-]{36}$ |

### TaskPublicViewV1

外发白名单投影；不含owner、token、args、raw receipt、原模型输出；显示名称取既有registry。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `taskId` | string | 是 | format=uuid |
| `parentTaskId` | string / null | 是 |  |
| `conversationId` | string / null | 是 |  |
| `revision` | integer | 是 | minimum=1 |
| `planRevision` | integer | 是 | minimum=1 |
| `state` | 枚举：NEW, UNDERSTANDING, RESOLVING, RUNNING, WAITING_INPUT, WAITING_APPROVAL, VERIFYING, SUSPENDED, RECONCILING, SUCCEEDED, PARTIAL, UNSUPPORTED, FAILED, CANCELLED | 是 |  |
| `executionMode` | 枚举：FOREGROUND, DETACHED | 是 |  |
| `userGoal` | string | 是 | minLength=1；maxLength=2000 |
| `goals` | 数组<object> | 是 | minItems=1；maxItems=8 |
| `goals[].goalKey` | string | 是 | minLength=1；maxLength=48 |
| `goals[].description` | string | 是 | minLength=1；maxLength=500 |
| `goals[].state` | 枚举：PENDING, RUNNING, VERIFIED, PARTIAL, NEEDS_INPUT, UNSUPPORTED, FAILED, CANCELLED | 是 |  |
| `goals[].blockers` | 数组<object> | 是 | minItems=0；maxItems=12 |
| `goals[].blockers[].code` | string | 是 | minLength=1；maxLength=100 |
| `goals[].blockers[].message` | string | 是 | minLength=1；maxLength=1000 |
| `goals[].blockers[].questionId` | string / null | 是 |  |
| `steps` | 数组<object> | 是 | minItems=0；maxItems=10 |
| `steps[].stepId` | string | 是 | format=uuid |
| `steps[].displayName` | string | 是 | minLength=1；maxLength=100 |
| `steps[].state` | 枚举：PLANNED, RUNNING, SUCCEEDED, FAILED, CANCELLED, UNKNOWN_EFFECT | 是 |  |
| `steps[].errorCode` | string / null | 是 |  |
| `questions` | 数组<Clarification> | 是 | minItems=0；maxItems=12 |
| `resultSummary` | string / null | 是 |  |
| `createdAt` | string | 是 | format=date-time |
| `updatedAt` | string | 是 | format=date-time |

### TaskEventPublicV1



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `seq` | integer | 是 | minimum=1 |
| `type` | 枚举：TASK_STATE, GOAL_STATE, STEP_STATE, CLARIFICATION, RESULT, LIMITATION | 是 |  |
| `occurredAt` | string | 是 | format=date-time |
| `state` | 枚举：NEW, UNDERSTANDING, RESOLVING, RUNNING, WAITING_INPUT, WAITING_APPROVAL, VERIFYING, SUSPENDED, RECONCILING, SUCCEEDED, PARTIAL, UNSUPPORTED, FAILED, CANCELLED / null | 是 |  |
| `goalKey` | string / null | 是 |  |
| `stepId` | string / null | 是 |  |
| `message` | string | 是 | maxLength=1000 |

### TaskEventsPageV1



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `taskId` | string | 是 | format=uuid |
| `events` | 数组<TaskEventPublicV1> | 是 | minItems=0；maxItems=100 |
| `nextSeq` | integer | 是 | minimum=0 |
| `hasMore` | boolean | 是 |  |

### ForegroundTaskContextV1

N5为既有chat body拟新增的可选nativeTaskContext；必须验证同一owner/conversation、role=user、最后原始文本hash一致，否则不建立持久任务。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `userMessageId` | integer | 是 | minimum=1 |

### ProfitabilityPreviewRequestV1

N4目标合同；先核实同等能力，尚未发布。成本由服务器重新读，不接受unitCost输入。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `basisRef` | object | 是 |  |
| `basisRef.kind` | 固定值 "SCENARIO_COMPARISON" | 是 |  |
| `basisRef.recipeId` | integer | 是 | minimum=1 |
| `basisRef.comparisonInput` | ScenarioCompareRequestV1 | 是 |  |
| `basisRef.scenarioKey` | string | 是 | minLength=1；maxLength=48 |
| `unitPrice` | number | 是 | minimum=0 |
| `quantity` | integer / null | 是 |  |
| `currency` | 固定值 "CNY" | 是 |  |

### ProfitabilityPreviewResponseV1

利润率与加价率是比例不是百分数文本。除成本来自引擎外，派生运算在正式共享service执行。未知或零分母相应值null。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `preview` | 固定值 true | 是 |  |
| `unitCost` | number / null | 是 |  |
| `unitPrice` | number | 是 | minimum=0 |
| `grossProfitPerUnit` | number / null | 是 |  |
| `grossMarginOnSales` | number / null | 是 |  |
| `markupOnCost` | number / null | 是 |  |
| `quantity` | integer / null | 是 |  |
| `totalCost` | number / null | 是 |  |
| `totalRevenue` | number / null | 是 |  |
| `totalGrossProfit` | number / null | 是 |  |
| `costComplete` | boolean | 是 |  |
| `costBasis` | string | 是 | minLength=1；maxLength=100 |
| `readSetHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `calculatedAt` | string | 是 | format=date-time |
| `warnings` | 数组<string> | 是 | minItems=0；maxItems=40 |

### ReadinessScenarioRequestV1

N4仅在现有活动订单之后添加虚拟需求；不建单、不扣库存。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `recipeId` | integer | 是 | minimum=1 |
| `scenarioInput` | ScenarioCompareRequestV1 | 是 |  |
| `scenarioKey` | string | 是 | minLength=1；maxLength=48 |
| `quantity` | integer | 是 | minimum=1 |
| `allocationPolicy` | 固定值 "AFTER_EXISTING_ACTIVE_ORDERS" | 是 |  |

### ReadinessShortageV1

三个Qty都按purchaseUnit；stockQtyPerUnit为每采购单位所耗库存单位。内部换算复用orderPlanning，不再定义另一公式。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `inventoryType` | 枚举：part, coil, none | 是 |  |
| `partId` | integer / null | 是 |  |
| `coilId` | integer / null | 是 |  |
| `model` | string | 是 | minLength=1；maxLength=240 |
| `supplier` | string | 是 | maxLength=240 |
| `purchaseUnit` | string | 是 | minLength=1；maxLength=20 |
| `stockUnit` | string | 是 | minLength=1；maxLength=20 |
| `stockQtyPerUnit` | number | 是 | exclusiveMinimum=0 |
| `requiredQty` | number | 是 | minimum=0 |
| `availableQty` | number | 是 | minimum=0 |
| `shortQty` | number | 是 | minimum=0 |

### ReadinessScenarioResponseV1

READY仅表示材料准备；缺少正式身份=>BLOCKED，有截断=>PARTIAL，不据此保证产能交期。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 1 | 是 |  |
| `preview` | 固定值 true | 是 |  |
| `readSetHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `configurationHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `requestedQty` | integer | 是 | minimum=1 |
| `supplyStatus` | 枚举：READY, SHORTAGE, BLOCKED, PARTIAL | 是 |  |
| `shortages` | 数组<ReadinessShortageV1> | 是 | minItems=0；maxItems=200 |
| `unboundItems` | 数组<object> | 是 | minItems=0；maxItems=100 |
| `unboundItems[].model` | string | 是 | minLength=1；maxLength=240 |
| `unboundItems[].reasonCode` | string | 是 | minLength=1；maxLength=100 |
| `currentOrderAllocationBasis` | object | 是 |  |
| `currentOrderAllocationBasis.policy` | 固定值 "AFTER_EXISTING_ACTIVE_ORDERS" | 是 |  |
| `currentOrderAllocationBasis.activeOrderCount` | integer | 是 | minimum=0 |
| `currentOrderAllocationBasis.activeOrdersHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `currentOrderAllocationBasis.checkedAt` | string | 是 | format=date-time |
| `warnings` | 数组<string> | 是 | minItems=0；maxItems=40 |
| `checkedAt` | string | 是 | format=date-time |

### DocumentCandidateV1

N4适配目标；当前parser缺位置/置信度则null而非伪造。USER_CONFIRMED不等于已写入正式业务数据库。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `fileId` | integer | 是 | minimum=1 |
| `sourceHash` | string | 是 | pattern=^[a-f0-9]{64}$ |
| `sourceKind` | 枚举：USER_ATTACHMENT, BUSINESS_ARCHIVE, KNOWLEDGE_SNAPSHOT | 是 |  |
| `field` | string | 是 | minLength=1；maxLength=100 |
| `value` | string / number / boolean | 是 |  |
| `unit` | string / null | 是 |  |
| `location` | object / object / object / null | 是 |  |
| `location.kind` | 固定值 "PAGE" | 是 |  |
| `location.page` | integer | 是 | minimum=1 |
| `location.kind` | 固定值 "CELL" | 是 |  |
| `location.sheet` | string | 是 | minLength=1；maxLength=160 |
| `location.cell` | string | 是 | minLength=1；maxLength=32 |
| `location.kind` | 固定值 "TEXT_SPAN" | 是 |  |
| `location.start` | integer | 是 | minimum=0 |
| `location.end` | integer | 是 | minimum=1 |
| `extractor` | string | 是 | minLength=1；maxLength=100 |
| `confidence` | number / null | 是 |  |
| `reviewState` | 枚举：CANDIDATE, USER_CONFIRMED, FORMAL_MATCHED, REJECTED | 是 |  |

### TaskSpecStorageV2

N5内部spec_json的唯一布局；不含steps/facts副本；不是客户端可写接口。

| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `version` | 固定值 2 | 是 |  |
| `answerOwner` | 固定值 "TASK_V2" | 是 |  |
| `userGoal` | string | 是 | minLength=1；maxLength=2000 |
| `businessWritePolicy` | 枚举：FORBIDDEN, CONFIRMATION_REQUIRED | 是 |  |
| `subjects` | 数组<SubjectBinding> | 是 | minItems=0；maxItems=12 |
| `goals` | 数组<GoalState> | 是 | minItems=1；maxItems=8 |
| `scenarios` | 数组<object> | 是 | minItems=0；maxItems=4 |
| `scenarios[].scenarioKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `scenarios[].label` | string | 是 | minLength=1；maxLength=80 |
| `scenarios[].baseSubjectKey` | string | 是 | pattern=^[A-Za-z][A-Za-z0-9_-]{0,47}$ |
| `scenarios[].basis` | 枚举：CURRENT_REBUILT, RECIPE_SNAPSHOT, QUOTATION_LOCKED, ORDER_LOCKED | 是 |  |
| `scenarios[].priceContext` | 枚举：FORMAL_READ_SET, LOCKED_SNAPSHOT, USER_HYPOTHESIS | 是 |  |
| `scenarios[].overrides` | ScenarioOverridesV1 | 是 |  |
| `scenarios[].readSetId` | string / null | 是 |  |
| `questions` | 数组<Clarification> | 是 | minItems=0；maxItems=12 |
| `approvalOperationIds` | 数组<string> | 是 | minItems=0；maxItems=8 |

### TaskBudgetStorageV2



| 字段 | 类型 | 必填 | 限制/说明 |
|---|---|---|---|
| `limits` | object | 是 |  |
| `limits.maxModelCalls` | integer | 是 | minimum=1；maximum=7 |
| `limits.maxToolCalls` | integer | 是 | minimum=1；maximum=10 |
| `limits.maxToolResultBytes` | 固定值 98304 | 是 |  |
| `limits.maxTaskStateBytes` | 固定值 262144 | 是 |  |
| `limits.deadlineAt` | string / null | 是 |  |
| `limits.maxApiCalls` | integer | 是 | minimum=1；maximum=128 |
| `limits.maxActiveMs` | integer | 是 | minimum=10000；maximum=900000 |
| `usage` | object | 是 |  |
| `usage.modelCalls` | integer | 是 | minimum=0 |
| `usage.toolCalls` | integer | 是 | minimum=0 |
| `usage.apiCalls` | integer | 是 | minimum=0 |
| `usage.activeMs` | integer | 是 | minimum=0 |

## 6. 扩展规则

新增目标不允许跳过字段合同、来源验证和测试。N4目标schema只描述拟支持字段；未登记到实际正式能力前，不得出现在“已支持”清单。新增数据类型需同时更新运行验证器、例子、旧调用兼容及真实回归。


---

# 03｜能力复用、字段映射与新增接口

## 1. 唯一能力目录，不建第二份工具世界

继续使用 `api/capabilities/registry.cjs`、`getAiCapability`、现有AI_TOOLS及总executor。注意两种access词汇不同：AI capability使用read/write；正式业务契约使用query/preview/command/maintenance。新适配器必须显式转换，不能拿字符串相等当权限判断。未登记或未知access一律不执行。

目标所需事实与能力的映射在现有 `api/business-semantics/factCapabilityRegistry.cjs` 演进。需要增加任务适配元数据时，引用同一capabilityId，不能再建一个与工具表独立维护的名字映射。新增已登记只读能力不应要求修改dispatcher里的业务域关键词。

N0输出 `api_inventory.json`：逐能力记录toolName、capabilityId、executorKey、formalCapabilityIds、access、inputSchema、resultProvenance、实际method/path、实际结果字段、直接调用方、是否已验证无副作用。inputSchema从当前 `getAiToolInputSchema`/AI_TOOLS读取，不根据说明文本重写。文档和代码不一致列为差异，不隐式选一个。

## 2. 已核实复用映射

| 场景 | 现有入口及字段 | 新版本处理方式 |
|---|---|---|
| 唯一配方/零件/线圈等解析 | POST `/api/entity-lookup`：version=1, mention, entityTypes, matchPolicy（EXACT/APPROVED_ALIAS/EXACT_OR_APPROVED_ALIAS） | 复用正式身份结果；该API支持的6类之外走对应正式列表/详情，不捏造泛化支持 |
| 查线圈 | `search_coils`：spec, sheets, material, slotType, schemeCode, schemeStatus, isDefault, ratedVoltageV, ratedFrequencyHz, market, schemeFamilyCode | 保留完整候选和状态；列表需求不用计算工具替代 |
| 算指定线圈 | `calculate_coil_cost`：必填spec/sheets；可选coilId, schemeCode, schemeFamilyCode, wireWeight, material, slotType | calculated/kit能力语义分别验证；当前schema无copperPrice，不填入工具 |
| 查当前整机成本 | `preview_recipe_cost`：recipeId，overrides为空 | 当前实现读取 `/api/recipes/current-costs` 再选相应配方；以currentTotalCost和完整性为准 |
| 当前完整配置试算 | `preview_recipe_cost`：recipeId, useRecipeBaseline=true, overrides | 当前实现转 `/api/recipes/bom-draft`，不可与默认快照覆盖口径混用 |
| 报价/订单配置覆盖试算 | `preview_recipe_cost`：recipeId, useRecipeBaseline省略/false, overrides | 当前实现转 `/api/recipes/:id/cost-preview`；保留快照口径，不冒充当前重建 |
| 基于配方/模板构建BOM | `build_recipe_bom_draft`：useRecipeBaseline, baseRecipeId, templateId/shellModel, coilId等、packingParts/optionalParts | 复用基准继承与正式定价；模型不生成占位物料/价格 |
| 泵壳本体成本 | `preview_pump_shell_cost`：templateId或shellModel，必填customBarrelLength | 单独说明泵壳本体；当前无ID时的模糊匹配不作为Native唯一身份依据，先正式绑定ID |
| 两个正式配方差异 | `explain_cost_change`：leftRecipeId, rightRecipeId, limit等 | 复用当前成本和costDifference；不假装已支持一个配方的两个临时情景 |
| 线圈反查配方 | `get_recipes_by_coil`：coilId | 复用有界关系读取、完整性和分页 |
| 配方查零件/零件查配方 | `get_recipe_parts`：recipeId；`get_recipes_by_part`：partId | 复用，不能把有关联等同于已重算成本或已改变订单 |
| 客户历史 | `search_customer_history`：customerId或customerName；historyType=all/quotation/order；keyword/recipeName/model；limit 1..50 | 先唯一绑定客户再调查；取50条不等于“全部历史” |
| 询价文件 | `inspect_quotation_file`：fileId；可选customerName | 候选映射不自动保存；readyForSaveDraft不等于已创建报价 |
| 已有订单准备 | `get_order_detail`、`check_order_readiness`、`plan_order_readiness_actions` | 输入按现有schema的orderId；不重新计算可用库存或写库存 |
| 变更/知识/技术档案/管理待办 | 当前registry中的相应工具 | N4从API inventory导入完整schema；本计划不虚构未核验的字段或任意文件读取接口 |
| 零件库存变更 | `adjust_part_stock`：items[{model,changeQty}], note；changeQty非0整数 | N6复用preparePartStockAdjustment和正式batch-stock；不把它改成任意SQL写 |
| 线圈库存变更 | `adjust_coil_stock`：items[{model,schemeCode?,changeQty,material?,slotType?}], note | N6之后单独验收；多方案必须先明确，不能用唯一默认代替写入选择 |
| 配方修改 | `update_recipe`：recipeName,newName,newSpec,clearSpec,addParts,removeParts,updateParts | 当前不是任意配置写工具；不能把电缆/线圈情景直接塞进这个schema保存 |

最后一行是重要能力缺口：**“已经算出修改后的电缆成本”不代表当前AI工具已经能保存该配置。**如要保存，必须增补正式配方变更适配并完整验收，不能用参数穿透绕过schema。

## 3. 现有覆盖字段的三层差异

AI `COST_OVERRIDE_SCHEMA`、BOM草稿入口、`configuredRecipeSnapshot.CONFIGURATION_KEYS`不完全相同。比如前者含 `extraPartsJson`，配置快照入口并不接受它；BOM工具支持 `packingParts` 数组，快照路径使用 `packingPartsJson`。实际是否可用由当前路径的正式输入和业务服务决定。

Native必须给每项能力登记 `supportedOverrideFields` 和参数转换函数。对不支持字段返回 `UNSUPPORTED_OVERRIDE_FIELD`，保留原目标。禁止用对象展开把未知字段传到另一条API，也禁止把参数删掉后仍说已按用户要求试算。

## 4. N2拟新增：同口径情景比较Preview

### 4.1 为什么需要这一小项新增

已有成本、继承、BOM和差异算法可复用，但当前工具没有一个完整合同同时证明：两情景使用相同价格读取集合、正确继承、实际覆盖已应用，以及差额由正式服务生成。这一项新增是封装已有业务能力，不是增加第二套成本算法。

**拟新增正式能力** `recipes.scenario_compare_preview`  
**拟新增AI工具** `compare_recipe_scenarios`（executorKey=business；resultProvenance=live_business）  
**拟新增路由** `POST /api/recipes/:id/scenario-compare-preview`  
access=preview；requiresConfirmation=false；无业务/审计/文件/缓存/队列写；sourceOfTruth=costEngine及共享配置服务；riskLevel=low；callers=web/ai/internal；无业务幂等要求（同输入不同时间允许当前价变化），但每次提供readSet与时间。

请求body是 `ScenarioCompareRequestV1`，工具封套在该body上增加必填整数recipeId。响应采用标准 `{success:true,data:ScenarioCompareResponseV1}`；错误保留code/requestId。path ID不存在404；输入/schema400；业务配置不允许422；业务版本或读取集合一致性校验冲突409。

### 4.2 正式service的实施约束

新增薄查询service建议 `api/services/recipeScenarioComparison.cjs`，route建议新增模块接入现有recipes路由。真实挂载文件位置在N0调用图确定，不凭猜测建立第二组recipes路由。

1. 在同步只读数据库事务内读取正式recipe、必要template/parts/coils/settings，形成不可变读取集合。事务内不调用模型、不进行HTTP、不await。
2. 复用当前Query所用的目录装载、`buildCurrentRecipeBomInput`、`applyRecipeBaseline`、BOM与 `buildCurrentRecipeCostBasis`。若现有依赖注入尚不能共用读取集合，先在原公共层提取依赖装载，禁止复制公式。
3. 基准情景固定key=`base`且无覆盖。候选先应用明确覆盖及现有依赖失效规则。多候选没有正式政策依据时停止，不选第一条。
4. `buildCurrentRecipeCostBasis`还包含配方工资/管理费，不能只拿BOM的costPreview当基准完整成本。基准和候选共用同一费用口径；N2测试必须包含配方工资覆盖模板默认的样本。
候选必须形成临时的`scenarioRecipeView`，显式映射已确认覆盖，同时保留原配方人工/管理费。线圈变化后被继承器移除的旧coilId/coilWireWeight/family，不能因`{...oldRecipe,...partialInput}`再次漏回来；应明确清空旧身份并由正式方案补全。`refreshCoilSnapshot`必须看到候选方案，而非原配方方案。以正式接口基准和差异测试证明，不能只声称调用了同名函数。
5. 比较逻辑复用/提取 `costDifference` 的金额差额与差异项处理，但不能调用它的模糊名称选择去绑定临时情景。必要时增加“已验证cost-basis对象比较”的纯函数，不新增成本计算器。
6. 每项请求覆盖必须在正式配置中证明已经应用。未应用、被拒绝、kit不支持的参数写入notApplied，相关差额不得冒充该假设的计算结果。
7. 缺价时允许返回完整诊断数据，但正式currentTotalCost与delta为null。summary也不得把null格式化成0元。
8. readSetHash对实际使用的源记录与定价参数规范化后计算，时间/随机UUID不进入内容hash。源版本缺失用contentHash，不伪造updatedAt。它证明同一读取集合，不保证之后价格没有变化。
9. sourceVersions必须有界；超出128条时sourceVersionCount记总数，sourceVersionsComplete=false，保留完整readSetHash。后续需要重验时重新调用同一正式Preview，不能用被截断版本列表证明仍最新。
10. 结果不得超过既有96KiB工具预算；无损精简正式明细或明确PAYLOAD_LIMIT，不截断后宣称比较完整。Preview不可为了大结果偷偷写临时文件。

### 4.3 首批字段开放顺序

N2/N3只开放 `hasFloat,floatWire,floatAccessoryType,hasCable,cableLength,cableWire,cableAccessoryType,coilId,customBarrelLength`。`coilSheets`只有在与已选正式coilId一致时作为校验快照；需要插值/外推另走N4。包装和表面处理到N4针对路径差异补齐测试后开放。不支持字段保留结构化错误，不从总合同中删除。

### 4.4 N2关键退出证明

空覆盖情景与当前权威整机成本一致；相同两情景delta=0；变化字段完全来自用户/正式派生；未变化字段和工资/管理费保持；跨供应商物料身份不漂移；同一事务内价格集合一致；零业务写；原有成本API回归不变。

## 5. N4能力缺口不能偷偷让模型补上

### 5.1 利润分析：新增字段，复用业务口径

当前报价的 `margin` 实际是**销售价÷成本的倍率**，例如1.1，不是10%销售毛利率。不得重命名它而改变历史行为。

拟为共享正式报价/成本分析服务增加只读“盈利试算”能力。先核查已有等价端点；有则扩展旧能力，无则在N4能力登记中新增 `cost.profitability_preview`。目标输入固定为：`version=1, basisRef={kind:SCENARIO_COMPARISON,comparisonInput,recipeId,scenarioKey}, unitPrice, quantity:null|正整数, currency=CNY`。comparisonInput为N2的完整原输入，服务端重新同口径计算；不能把客户端传来的成本当事实。第一轮不复用未持久化comparisonId冒充可回读对象。

输出字段固定为：`unitCost, unitPrice, grossProfitPerUnit, grossMarginOnSales, markupOnCost, quantity, totalCost, totalRevenue, totalGrossProfit, costComplete, costBasis, readSetHash, calculatedAt, warnings`。除已有正式成本外，四则运算只放共享业务service，不放LLM或前端。毛利率分母是售价；加价率分母是成本；分母0返回null和原因；负毛利允许返回。未确认quantity时三个总额null。运费/税费/金融费用未纳入则明确，不称净利润。

该能力只有N4合同、实现和真实验收全部完成才可说“支持利润问题”。

### 5.2 尚未建单配置的齐料模拟

先复用已有订单准备能力解决“这个订单齐不齐”。尚未建单场景需要新只读wrapper，不能调用生成采购清单或建单来借出算法。

目标输入：`version=1, recipeId, scenarioInput:N2请求, scenarioKey, quantity:正整数, allocationPolicy=AFTER_EXISTING_ACTIVE_ORDERS`。首轮只支持“在已有活动订单之后新增需求”的明确政策，不猜订单优先级，不扣库存。

目标输出：`preview=true, readSetHash, configurationHash, requestedQty, supplyStatus=READY|SHORTAGE|BLOCKED|PARTIAL, shortages[{inventoryType,partId?,coilId?,model,supplier,purchaseUnit,stockUnit,stockQtyPerUnit,requiredQty,availableQty,shortQty}], unboundItems[], currentOrderAllocationBasis, warnings, checkedAt`。复用orderPlanning的身份、整根电缆/米库存、跨订单平衡算法；虚拟需求只存在内存，绝不safeInsert订单。

`READY`只代表材料准备，不代表已安排工人/设备、达到扬程或保证交期。

### 5.3 文件、知识和影响

N4只调用已登记文件/知识读取。资料正文支持程度以当前parser和原始文件类型为准；只有标题/标签不能声称读过图纸正文；OCR低置信度是候选。每个抽取值至少有fileId、sourceHash、location（page或sheet/cell）、extractor、confidence、reviewState。正式值仍需要用户批准或业务API核对。

订单/报价/测试报告“有快照可比较”“已核对相同”“已发现差异”“需要重算”“变更已经提交”必须分开。现有Impact给出的关系或待重算状态，不能直接升级成工程结论。

## 6. N5新增任务API（与业务命令分开）

| Method / Path（均拟新增） | 请求 | 响应 | 权限和副作用 |
|---|---|---|---|
| POST `/api/ai/tasks` | TaskStartRequestV1，仅executionMode=DETACHED；Idempotency-Key头必填 | 202，TaskAcknowledgementV1 | 创建的是任务运行记录，不是业务订单；加载所属会话的userMessageId |
| GET `/api/ai/tasks/:taskId` | UUID path | 200，TaskPublicViewV1 | 检查owner；不续租、不修改状态、不写“已读” |
| GET `/api/ai/tasks/:taskId/events` | afterSeq整数>=0默认0；limit整数1..100默认50 | TaskEventsPageV1 | 同owner；增量轮询；GET无写 |
| POST `/api/ai/tasks/:taskId/resume` | TaskResumeRequestV1，显式executionMode=DETACHED；Idempotency-Key | 202，taskId/revision/state | expectedRevision校验；选项对应task/planRevision/候选hash；重新核实易变证据 |
| POST `/api/ai/tasks/:taskId/cancel` | TaskCancelRequestV1；Idempotency-Key | 200，taskId/revision/state | 不宣称撤销已提交业务变更；未知副作用进入RECONCILING |

沿用现有错误封套；404不泄露其他owner是否存在；409返回安全的当前revision/需要刷新说明；运行服务不可用503；超限429；字段错误400。不要从body接受ownerKey/allowWrite/budget/facts/approved等内部字段。

原 `/api/ai/chat` 及已有SSE类型保持兼容。N3先使用原status/content/detail/done，Native进度塞入兼容detail的受控扩展，不发未验证正文。N5前台走原chat取消语义；后台任务只由新的显式task start产生，不能因关闭页面就偷偷后台运行。

## 7. N6写入：只做现有协议桥接

第一批只验收 `adjust_part_stock` 与 `batch_update_prices` 的已有正式预检。新任务只记录执行意图和目标，不让模型设置allowWrite。请求写工具时由独立受保护的预检桥调用现有executor生成确认卡；最终仍通过 `/api/ai/confirm-tool` 与 `executeConfirmedAiTool`。

现有确认字段：confirmationToken、operationId、argsHash、resourceVersion、expiresAt、toolName、args、rows、editableFields。原token绑定subject和服务端executionContext。新增关联只放服务端executionContext：`nativeTask={taskId,planRevision,goalKey}`；客户端不得提供或替换。

批准前重新检查task计划版本、正式Preview与业务版本。确认卡编辑仍走原revise接口，生成新预览，新卡替代旧卡。服务重启后旧内存token失效，任务恢复为需要重新预检/确认，禁止用保存的“approved=true”恢复写权。

正式命令发出前保存operationId与幂等键关联。响应丢失时先回读正式operation/业务状态；现有正式operation查询若缺失，N6必须补一个按当前主体授权的只读回执查询，不能让agent直接SELECT api_operations。未知效果期间不创建新的操作号重写。

公共Task API外层仍使用success/data或success=false/code/error/requestId封套。现有chat前台任务可以由路由生命周期回调持久化；通过resume继续时，界面必须明确显示“后台继续”，请求中的DETACHED是用户选择，不根据断线自动转换。

第5节的后续字段现提供ProfitabilityPreviewRequest/ResponseV1、ReadinessScenarioRequest/ResponseV1、ReadinessShortageV1、DocumentCandidateV1。它们是N4目标合同，不意味着当前API已支持；若现有等价API字段不同，N4适配而不静默改历史含义。shortages里的requiredQty/availableQty/shortQty均为purchaseUnit，stockQtyPerUnit明确换算倍率。

N5为已有chat body新增可选nativeTaskContext={version:1,userMessageId}，其他旧字段保持；沿用ForegroundTaskContextV1校验。无此字段的旧客户端继续旧前台，不强制更改会话创建过程。


---

# 04｜任务生命周期、持久化与安全恢复

## 1. 分阶段状态，不提前制造后台系统

N1只验证纯合同；N3首版只在现有请求内运行。可以沿用当前server Session处理短期澄清，但响应必须说明服务重启后重新核实，不宣称任务已持久化。N5才引入以下表、API和显式后台执行。引入持久化不是重做会话：聊天记录保留原表，任务表只保存执行所需的服务端状态。

N3取消使用现有AbortSignal，浏览器断开后停止后续调用。N5显式选择DETACHED的任务才独立于浏览器连接；关闭页面不取消后台任务，用户点击“停止任务”才调用cancel。

## 2. 状态机

机器定义：`contracts/state-machine.json`。

| 状态 | 用户看到的含义 | 进入条件/退出方式 |
|---|---|---|
| NEW | 已收到任务 | 服务端创建；不是业务已执行 |
| UNDERSTANDING | 正在理解要求 | 多目标/约束候选校验；简单路径可以立即完成 |
| RESOLVING | 正在找准对象 | 正式身份/候选/单位/前置要求核实 |
| RUNNING | 正在调查或试算 | 仅执行已通过schema、来源及权限校验的步骤 |
| WAITING_INPUT | 需要你补充一个具体信息 | 没有能继续的独立步骤；回答后重新解析并增加planRevision |
| WAITING_APPROVAL | 已有正式变更预览，等待确认 | 只由真实确认结构进入；没有token的文字“请确认”不构成该状态 |
| VERIFYING | 正在核对是否完成 | 按用户目标核对证据，不按工具成功率 |
| SUSPENDED | 暂停，可以恢复 | 中断/可恢复故障；不能丢失已验证事实 |
| RECONCILING | 正在核对某个操作是否已经提交 | 写请求丢失响应/不确定外部副作用；禁止直接重写 |
| SUCCEEDED | 你要求的各项工作已完成 | 所有活动goals为VERIFIED |
| PARTIAL | 完成一部分，剩余有明确原因 | 至少一项完成但预算/失败/不支持使其他项未完成 |
| UNSUPPORTED | 当前正式能力不能完成所请求工作 | 不把缺能力称为缺数据，不伪造金额 |
| FAILED | 本次没有可交付的结果 | 技术失败且无未知已提交副作用；保留可核实证据 |
| CANCELLED | 已停止后续工作 | 不代表回滚已提交业务变更；未知副作用必须先对账 |

待补充信息但还有独立目标可以做时，继续RUNNING，先做独立部分；不要因一个线圈歧义挡住无关客户历史查询。terminal任务不可直接恢复成RUNNING；“继续”建立子任务，重新校验易变证据。用户明确删掉一个目标需增加planRevision并留下目标取消原因，不能由模型删掉难目标。

## 3. 预算与停止条件

第一版不提高原循环上限：**最多7次模型调用、10次工具执行**，包括候选解析、修复和合成；同一工具重试也计数。单个工具结果96KiB，服务端Task状态256KiB。物理API子调用单独观测，不能用一个包装工具内部循环无限查询；子调用总量上限由N0当前已登记能力实测后写入release manifest，N3上限建议32且遇到更小已有上限取较小者。

预算是运行保护，不是老板的业务权限限制。达到上限返回已核实部分和未完成目标。不是把查询范围静默缩小。第一次上线保持串行工具和单槽本地模型；后期并发必须独立验证数据库读一致性和模型容量。

每次模型响应后的动作必须是：合法工具调用、明确澄清、完整性交付或停止之一。相同tool+规范args+相同readSet重复提出且无新证据，不再无限重试。瞬时只读故障最多重试一次并计预算；业务404/歧义不重试成“猜测成功”。

## 4. N5数据库字段与四张表

DDL设计见 `contracts/task-storage.sql`。这是新迁移的**目标定义**，不是可以直接对生产执行的脚本。真正迁移编号由N5读取当前migration head后分配，不能把旧schema=87当永远不变的下一号。

所有表的主键采用INTEGER以复用现有safeInsert/safeUpdate。公开UUID放task_key/step_key/evidence_key，不能假设现有safeUpdate可以处理任意UUID主键。外部taskId映射ai_tasks.task_key；内部跨表task_id指ai_tasks.id。

### ai_tasks

| 列 | 类型 | 约束/用途 |
|---|---|---|
| id | INTEGER | 主键，自增，内部使用 |
| task_key | TEXT | UUID唯一，外部taskId |
| parent_task_id | INTEGER/null | 父任务FK，仅用于继续工作，不复制业务记录 |
| owner_key | TEXT | 来自认证请求，不接受模型/body |
| conversation_id | INTEGER | 所属现有会话FK，创建时检查owner |
| user_message_id | INTEGER | 本任务源用户消息FK，并核对同一会话、role=user |
| schema_version | INTEGER | 固定2 |
| revision | INTEGER | >=1，状态变化版本 |
| plan_revision | INTEGER | >=1，目标/输入条件变化版本 |
| state | TEXT | 状态枚举 |
| execution_mode | TEXT | FOREGROUND/DETACHED |
| input_hash | TEXT | 源输入摘要；不复制凭据或无关全文 |
| spec_json | TEXT | TaskSpecStorageV2：目标、subjects、情景、questions、批准关联和businessWritePolicy；不含步骤/事实/预算的重复副本 |
| budget_json | TEXT | TaskBudgetStorageV2：limits与usage；用户不可增加 |
| result_json | TEXT/null | 已核实结构化结果或最后安全摘要 |
| lease_owner/token/expires_at | TEXT/null | 当前执行者租约；只有N5控制器能设置，不下发客户端 |
| cancel_requested_at | TEXT/null | 停止后续工作请求时间 |
| created_at/updated_at | TEXT | UTC时间 |
| expires_at | TEXT | 保留策略；独立Maintenance清理，不在GET顺便删除 |

### ai_task_steps

id、step_key(UUID UNIQUE)、task_id(FK)、plan_revision、sequence、capability_id、tool_name、goal_keys_json、access、args_json、args_hash、argument_sources_json、state、attempt、receipt_key、operation_id、idempotency_key、started_at、finished_at、error_code、created_at、updated_at。

`UNIQUE(task_id,plan_revision,sequence)`。operation/idempotency字段仅写步骤设置，由服务端生成并在发出正式命令前持久化；错误不能吞掉已取得的operation。

### ai_task_evidence

id、evidence_key(UUID UNIQUE)、task_id(FK)、plan_revision、record_kind(RECEIPT/FACT)、receipt_key(nullable FK to evidence_key)、fact_key_hash(nullable)、supersedes_key(nullable FK)、payload_json、source_hash、observed_at、created_at、updated_at。

RECEIPT保存受信的结果/版本/调用投影；FACT保存FactRecord。使用同一表区分记录类型，避免再建事实库和回执库两套入口。事实只追加，不能在后处理阶段UPDATE成另一个值。supersede使用新事实与事件，不覆盖旧记录。

### ai_task_events

id、task_id(FK)、seq、event_type、payload_json、created_at、updated_at。UNIQUE(task_id,seq)。状态、目标变更、重试、取消、澄清和恢复都有事件。不得记录模型私有推理、token、密钥、完整提示词或无关文件内容。前端只显示经白名单投影的状态/步骤描述。

## 5. 数据一致性与落库规则

状态服务放现有services目录，注册明确的内部任务生命周期能力。HTTP route注入保存回调，不让模型/Runtime直接import db或SELECT业务表。业务Query/Preview的执行过程中仍然零写；调用完成后由任务状态Command追加运行记录。两者必须分开计量，不能将业务Query加审计写解释为“反正只是任务日志”。

新表加入现有SAFE_TABLES和对应列白名单；复用safeInsert/safeUpdate和事务。对同一task的变更在短同步事务中：在IMMEDIATE短事务内重新读取owner/revision → 校验状态/租约 → 更新任务/步骤 → 追加事实/事件 → 提交。禁止在事务中等待LLM或HTTP。

GET只读，不获取lease、不清理过期记录、不增加revision。后台worker只有一个执行槽；claim/release/recover属于已登记内部操作。租约默认30秒、每10秒续租，为可配置运行参数不是业务权限；取得租约、延长租约都使用条件重验和事务。长模型等待不能持有SQLite事务，定时续租需要event loop可运行。

计划JSON、运行步骤、事实及事件不共享同一任意json写入口。每个Command仅接受允许的字段；不能让客户端发整个TaskEnvelope替换服务器。

## 6. 重启与恢复

1. 启动恢复只读任务记录，不自动开始业务写。
2. 旧lease超时且无未知写副作用：记SUSPENDED。原先显式DETACHED且仍在预算内的只读任务，可按已登记恢复政策重新进入RESOLVING；前台任务需要用户继续。
3. 保存的ID可以作为待验证目标；价格、库存、订单状态、候选资格必须重查。旧事实保留作历史，不因恢复就当当前。
4. 业务version/hash变化则增加计划版本或重新生成当前Preview；结果差异在UI展示。
5. 未知写结果进入RECONCILING，先按已保存operation/幂等键核实；不能重新生成新操作号再写一次。
6. 现有确认token是内存Map，重启后必须重新预览并确认；本计划不把token悄悄持久化来放宽旧协议。
7. 应用新版本不支持旧task schema时，任务保持可读并显示需重新发起，不以unknown字段填默认执行。

## 7. 保留和清理

初始目标策略：活动任务不自动删除；终态任务30天后可清理，先删除事件/事实/步骤再任务，禁止连带删除业务记录/会话。数据库备份仍走现有发布/启动备份；task清理不能影响api_operations幂等保护期。调整保留期属于运行设置变更，不写死在GET。

## 8. 写操作结果与取消

一项写入可能已经提交，但回读或后续检查失败。任务必须显示“已提交，验收/后续检查未完成”，不能显示“没有发生”，更不能自动重放新写请求。

批准是对一份具体正式Preview的批准，不是对“帮我处理”这一句话的永久授权。写阶段只复用已经具备正式预检的能力；订单转单、关闭、归档、出图等各自再验收，不因两个库存/调价能力通过就全部放开。

## 10. 补充的一致性条件

累计预算`budgetUsage`与限制一起存budget_json。等待用户不计activeMs；恢复生成剩余活动时间deadline，绝不无条件清零模型/工具次数。任一调用发出前持久化预算占用，失败也计数；只有准备了参数而未发出调用不计调用次数。所有新模型补救调用计在同一预算内。

lease_token是本次租约的防旧执行者标识：每次正式调用前、写状态前、摄取返回结果前重新校验。仅有lease_owner相同不够。租约过期且存在RUNNING COMMAND/operationId时必须先RECONCILING，不能把它当普通只读重试。IMMEDIATE事务内先读后写safeUpdate可避免两个worker同时抢到一个任务；N5/N6必须用实际仓库SQLite运行并发测试。

TaskResumeRequest只允许显式DETACHED：前台任务记录的“后台继续”由用户操作触发。没有答案的SUSPENDED可answers=[]；WAITING_INPUT仍须解决阻断所需问题。只是确认已有候选的选择不是业务写批准。

跨表引用除了FK还必须检查task_id、plan_revision与record_kind：FACT.receipt_key指向同一任务的RECEIPT；supersedes_key指向同一FactKey的FACT；事件、步骤和事实不能借用其他owner。DDL本身不能保证这些语义，必须由状态service和对抗测试验证。

N5持久化前台chat时，拟新增可选body字段`nativeTaskContext: ForegroundTaskContextV1`。前端传已保存的源userMessageId，服务端验证所属、role及其文本hash与当前原文一致；不一致时拒绝持久化接入，不引用另一条消息。旧客户端不传则继续原前台路径，不虚称该任务可跨设备恢复。

增量事件的nextSeq是已扫描内部事件的最后序号，可能跨过未向前端暴露的内部事件；events允许序号有间隔但必须递增。游标过旧返回410/EVENT_CURSOR_EXPIRED并要求读取完整公共任务状态，不永久空轮询。

删除会话前必须取消或完成关联任务并遵循既有软删除语义；不得新增FK后让原删除接口悄悄500。清理按同一事务删除任务events/steps/evidence及task，证据保留/批准关联仍需既有审计政策。运行中的或UNKNOWN_EFFECT的任务不得按普通到期清理。


---

# 05｜分阶段实施：8阶段、18个任务包

## 0. 所有任务共同适用的交付规则

每个任务包只解决本表声明的范围。先读本包涉及的真实调用链，再修改。`N0.1`是唯一首发任务；后面的包不是本次自动执行授权。PASS是当前任务满足退出条件，不代表全项目或生产就绪。

实施时维护 `planning/ai-native-v1/implementation-status.json`，字段：`planVersion:string, baseCommit:string, workingBranch:string, currentTicket:string, tickets:[{id,status:NOT_STARTED|RUNNING|PASS|REWORK|BLOCKED, startCommit,endCommit, changedFiles:string[], reusedSymbols:string[], tests:[{command,exitCode,reportPath}], blockers:string[], nextTicket:string|null}]`。真实命令没运行则不要放在tests中，另列notRun及原因。报告不包含密钥、原始客户资料或模型私有推理。

实施目录建议：业务源码仍在现有`api/services`、`api/business-semantics`、`api/routes/ai`、`api/capabilities`；不创建第二套完整`ai-native`应用。`planning/`只存设计与阶段证据索引，不复制仓库权威业务文档。

所有新增路径、文件和符号在下面均是**拟新增**；已有文件在N0核对后才改。文件冻结测试涉及旧提交内容时，必须登记当前冻结约束及合法的版本化变更方式。GitHub快照缺少历史Git对象时，取得合法历史对象或经批准更新冻结基线；禁止删除测试、篡改旧Oracle或把缺失当PASS。

### 阶段依赖

`N0 → N1 → N2 → N3 → N7（首批只读）`。

N4、N5在N3后实施；N6在N4和N5均通过后实施。N7是每个发布切片重复使用的发布与退出流程，不要求先做完N6。由于修改区域相近，首轮建议串行，不同时让多个Codex会话改Runtime。

## N0｜业务、接口和真实基线

### N0.1 只读盘点与差异清单

**前置：** 无。只执行本地源码/配置结构审计；不改生产、不修业务代码。

**必读：** AGENTS.md、docs/api-contract.md、docs/api-sop.md、business-flow/coil-domain、现有chat→dispatcher→runtime→executor→API主链、costEngine/currentRecipeCost/recipeConfigurationBaseline/configuredRecipeSnapshot、订单/库存/确认模块。读取本计划source-index定位已审阅文件，但以当前工作树为准。

**动作：** 核对branch、HEAD、dirty、Node/包管理版本、lockfile；列出GitHub快照与工作树差异；核对业务层、tool层、文档的字段差异；逐个识别正在运行、默认关闭、实验/未引用的模块；扫描schema迁移、SAFE_TABLES、内容冻结及旧Git对象依赖。生产只读信息仅在本地已有授权连接时核查，不要求把凭据交给ChatGPT。

**交付：** `baseline.json`（commit/tree/dirty指纹、migrationHead、命令清单、生产状态unknown或已核实）；`api_inventory.json`（第03章字段）；`business-authority-matrix.json`（每项B01—B18对应service/export/API/tests）；`gap-register.json`（缺口ID、证据path:line、影响、最低公共修复层、验证条件）。

**退出：** 同一配置覆盖在tool/正式API/service三个层的可用字段全部对齐；确认哪些成本是当前重建、哪些是快照；发布脚本现有质量门禁是否零用例有明确证据；识别无效旧引用但不擅自删除。无法确认的项为UNKNOWN，涉及下一包关键依赖则BLOCKED。

**禁止：** 运行生产迁移、reset/clean、重建业务库、删除文档、为盘点顺便换模型/依赖。回滚：删除本包新建的盘点产物即可，不动业务文件。

### N0.2 重建可重复的当前质量基线

**前置：** N0.1 PASS。

**复用：** 现有业务理解基准、SyntheticBusinessAcceptanceV1、正式成本/关系Oracle、回放runner和observability。先按现有工具链安装/构建隔离依赖，不升级锁定版本；当前平台无法运行则记录真实阻断。

**动作：** 隔离SQLite，不复制/改写生产账；先跑现有确定性测试、API契约、deep API、lint/build；再以当前实际provider/model、开关组合串行跑已有真实AI语料。追加第06章首批Native测试，但冻结的旧Case/Fixture/Oracle仅引用，不改值。原始回答只写gitignored日志。

**交付：** `baseline-tests.json`、`baseline-live.json`、旧/新用例覆盖表、失败分类。记录provider真实使用、fallback、模型调用、工具调用、API子调用、首个状态/最终结论延迟、业务表及审计/文件副作用指纹。

**退出：** 拿到可重跑基线；现有功能失败不得被新架构掩盖。环境故障和真实业务错误分开。历史64/64不算本轮结果。已有失败可登记已知债务，但关键金额/写安全问题必须先解决或阻断相关试点。

**回滚：** 保留冻结资产；只删除临时数据库/本包可再生运行文件；不改变生产。

## N1｜把老板的完整要求保存下来

### N1.1 版本化任务、来源和事实合同

**前置：** N0 PASS。

**拟新增：** `api/services/aiTaskContractV2.cjs`、`aiTaskValidationV2.cjs`；对应Node测试。复用现有TaskEnvelopeV1、BusinessSemanticFrame和证据契约，提供显式适配，不把V1字段默默改成V2。

**字段：** 实现本计划TaskProposalV1、TaskEnvelopeV2、FactRequirement、FactKey/FactRecord、ArgumentSource、SubjectBinding、Scenario与状态枚举。TaskProposal不可含canonicalId、owner、allowWrite、approved、receipt或执行成功字段。JSON Schema是设计参考，实现优先既有验证库。

**动作：** 增加跨字段校验：目标/情景/身份引用、DAG、UTF-16原文区间、不同情景与时态隔离、天然唯一与明确选择分开、空/截断/技术失败分开、活动目标全部验收才成功。新事实不能改写旧证据。

**退出：** 第06章合同与变异测试通过；旧导出/入口行为不变；新合同还不接管真实请求；不新增DB表。回滚：移除未接入的新合同文件，旧入口无变化。

### N1.2 多目标理解，不靠关键词优先级吞掉要求

**前置：** N1.1 PASS。

**复用/演进：** `questionSemantics.cjs`保留经过验证的固定规格解析；在既有语义模块加入TaskProposal候选转换。复杂任务可用当前provider做一次有界候选抽取，计入总模型预算；简单查询不强制增加一次planner调用。不得假定当前所有provider支持新的response_format或JSON mode；兼容已有文本/Function Calling结果解析，格式失败最多一次受预算约束修复。

**新增职责：** `aiTaskSemanticsV2.cjs`收集goals、subjects、scenarios、明确约束和unparsedSpans；不发业务写命令、不生成正式身份。自然语言“老板”不再因一个“老”字成为别名，多个业务目标不压成一个kind。

**字段处理：** `sources`精确绑定原话；数量/售价/单位分别保存；“先不要保存”固化server业务写约束；`其他不变`成为基准继承政策。模型提出的权限字段直接拒绝。没解析清楚的关键条件保留为blocker，不删除后继续称完整完成。

**退出：** 同义表达、否定、复合目标、金额与规格混用、emoji/全半角标点测试通过；复合问题目标覆盖通过人工标注Oracle；简单路径调用数不增加；复杂抽取失败有明确降级/缺口而非假成功。

**回滚：** 拆除TaskProposal候选接入，原语义入口保留。此阶段只做影子结果/隔离测试，不正式切换。

## N2｜已有能力可以被正确调用

### N2.1 统一能力适配、身份和结果来源

**前置：** N1 PASS。

**复用：** registry、AI_TOOLS、validateAiToolArgs、executor、internalApiClient、entityLookup、正式列表/详情、现有语义factCapabilityRegistry。建议只新增薄`aiTaskCapabilityAdapterV2.cjs`，不创建第二目录或第二executor。

**字段：** 每个工具投影toolName/capabilityId/access/sourceOfTruth/supportedOverrideFields；调用参数叶字段有ArgumentSource；executor摄取ExecutionReceiptV1并提供可验证JSON Pointer；CanonicalEntity仅从正式结果建立。

**安全：** 仅server控制器允许把实际执行结果加入可信回执集合。客户端会话metadata、知识文本、模型返回的verified=true一律不能晋升。read/write与query/preview/command词汇显式转换；未知分类拒绝。任务记录不允许绕过API直接读业务DB。

**退出：** 本轮真实调用可追溯；错ID、旧会话、分页截断、状态不合法、错误结果形状、指针错值、伪造receipt全部拒绝；成功证据不因后续独立失败被删；现有工具原响应保持兼容。

**回滚：** 新任务适配停用；不删除旧工具、身份或证据代码。

### N2.2 正式同口径情景比较能力

**前置：** N2.1 PASS。

**拟新增：** `recipes.scenario_compare_preview`、`compare_recipe_scenarios`、`POST /api/recipes/:id/scenario-compare-preview`、`recipeScenarioComparison.cjs`；在现有tools、registry、businessExecutors、recipes路由和API文档登记。不要把本计划中的新路径当已存在。

**精确合同：** ScenarioCompareRequest/Response、CompareRecipeScenariosToolInput；基准CURRENT_REBUILT；一个基准+最多三个候选；先开放第03章N2字段。sourceVersions最多128条及count/complete，输出readSetId/hash、每个配置hash、requested/applied/notApplied、正式成本、delta、changes、warnings。

**复用与关键难点：** 单次同步只读事务取共同源集合；临时scenarioRecipeView沿用配方工资管理费并采用候选线圈；复用当前BOM、继承、线圈与成本实现；现有costDifference可提取共享比较函数，不能复制计价算法。业务请求不接受客户端成本或模型单价。

**退出：** 当前基准与原正式API数值/缺价状态一致；候选只应用指定变化和正式依赖；相同情景差额0；配方工资覆盖、非默认供应商、kit、线圈更换、包装保留、价格并发变化、缺价、超大BOM、无效字段全部覆盖；所有Query/Preview副作用0。无需真实模型也能用HTTP完成比较。

**回滚：** 停止暴露新能力，不改旧API；新增服务可留在未调用状态；没有业务数据迁移。

## N3｜首个AI-native闭环

### N3.1 接入经办循环和澄清续接

**前置：** N2 PASS。

**演进：** aiAssistantRuntime抽取必要的任务控制职责到`aiTaskControllerV2.cjs`，保留一个provider循环和一个executor。TaskEnvelopeV2由目标驱动；根据缺少的FactRequirement选择现有能力，不把业务域关键词当读取权限。

**行为：** 解析V550→必要时列正式候选→用户选择→成本比较→补缺→准备交付。独立目标可继续；一个阻断不吞掉全部任务。支持普通会话中澄清，但候选来自当前owner/conversation的server状态；重启后重查。

**预算：** 7模型、10工具、API子调用预算、既有超时/取消；每次调用前检查；一个包装工具不能内部无限读取。相同无进展调用停止。TASK_V2已取得结果后不能默默整单重跑Legacy，增加花费并丢失目标；应交付部分结果或明确失败。

**退出：** 完成首条配置比较场景与多轮选择；“改成/换成/给我用”一致；无模型生成身份；无写入；异常和预算有结构化结果。未支持利润/未建单齐料仍登记目标并解释未支持，不宣称该复合任务SUCCEEDED。

### N3.2 单一答案责任与老板可用的展示

**前置：** N3.1 PASS。

**拟新增：** `aiTaskAnswerV2.cjs`（复用既有grounding/展示基础，非重写整份Money Guard）；AnswerDraftV1字段和逐目标核验。当前chat SSE status/content/detail/done兼容。

**分工：** 决定哪些事实必需的是server目标合同，不是模型；金额、身份、应用状态和齐料状态引用已核实事实。AI可以解释、比较和给出标注的分析，不把全答案一律换成固定句子。无依据段落只降级该goal/section，保留其他已核实段落。模型草稿不先流给用户。

**唯一责任：** answerOwner=LEGACY或TASK_V2；TASK_V2完成的内容不得再让旧CrossCatalog、CoilVariant、Semantic/Impact重复追加或替换。责任转移需按切片验证，旧路径继续保留原Guard；不是全局删除保护。

**退出：** 答案含当前基准、新方案、差额、实际变化及必要缺口；重复段落没有增加；所有活动goal有结果/限制；错误引用和凭空解释被拦；简单问题仍简洁；真实模型同义/复合验收满足第06章。达到N3即可申请N7只读试点，不必先做后台或写入。

## N4｜跨业务调查与确实缺少的能力

### N4.1 扩展既有只读领域

**前置：** N3 PASS。

**复用：** 客户/报价/订单历史、库存、管理待办、business changes、正式关系与Impact、文件/知识工具；字段从N0 API inventory导入，不手工创造新接口。包装与表面处理在对应公共服务中补齐支持/拒绝规则后加入scenario adapter。

**扩展字段：** Goal.kind、FactRequirement、文件Location/ExtractedCandidate；不新增部门读取权限。精确查询与宽泛调查分开；最多50条历史必须保留hasMore/覆盖范围，没有分页证明不能回答“全部”。

**退出：** “客户历史+当前成本”“订单为何不能生产+下一步”“报告与配置核对”三组复合场景；文件只有标题时正确承认；文档恶意指令不能触发工具或外发数据；testing可查但不冒充正式产品配置。

### N4.2 盈利与未建单齐料的正式只读封装

**前置：** N4.1 PASS。

**能力缺口：** 先检查当前版本有无等价能力；有则复用扩展，无则依据第03章5.1/5.2登记新共享Preview。路由路径在能力审计后确定，不假设已存在；不得复用业务写动作获取模拟结果。

**字段：** 盈利输入/输出必须明确unitPrice、quantity、currency、grossMarginOnSales、markupOnCost、costBasis；齐料明确allocationPolicy、purchaseUnit/stockUnit/stockQtyPerUnit、unboundItems、supplyStatus。旧margin倍率不改。

**退出：** 两个service可独立测试；零售价分母、负毛利、未知数量、缺价、活动订单占用、电缆根/米、未绑定线圈、非库存工艺均有测试。所有中间计算在正式共享service；任务回答不自己算利润或缺料。

**边界：** 若对话已经取过成本，第二个Preview重新读取的readSet必须相同，才可合成同一瞬时假设的综合结论。不同则明确两次读取时间或重新统一预览；不能把价格变化误归因于电缆变化。

### N4.3 复合调查闭环与泛化评测

**前置：** N4.2 PASS。

**目标：** 完成“改配置→算成本→查能否做300台→缺什么→售价340元时利润”的全过程，所有参数仍来自明确输入/正式结果。成本/库存读取时刻分别披露；没有供应商交期数据不能预测交期。

**退出：** 多对象、多目标、不同快照、独立失败、不支持目标均按goal交付；实体名称/ID随机变化仍通过；不因复合问题增加一整套硬编码场景路由；真实模型综合用例达标后再申请N7。

## N5｜任务保存、恢复与工作台

### N5.1 服务端任务存储与单槽worker

**前置：** N3 PASS（与N4可独立，但首轮串行）。

**拟新增：** aiTaskStoreV2/aiTaskLifecycleV2服务、四张运行表、合法新migration及SAFE_TABLES适配。通过注册的内部状态Command保存运行，不让agent直接DB。DDL是目标草案，先在可销毁副本验证现有迁移/备份/恢复。

**字段：** 第04章所有列、lease token、revision/planRevision、预算累计、event seq、同任务receipt/Fact引用；GET无副作用。

**退出：** 多请求抢租约、租约过期旧worker返回、事件重复/乱序、丢失响应、客户端伪造owner/facts、历史metadata、中断恢复、删除会话关联及清理策略均测试。恢复后易变事实重新读；terminal新建子任务；确认token不持久化。

**回滚：** 停止worker和新建任务，保留表与记录供核查；不执行down migration删历史，不回滚工厂账。

### N5.2 任务API与工作台

**前置：** N5.1 PASS。

**拟新增：** 第03章五个task路由及registry/API文档；TaskStart/Resume/Cancel、TaskAcknowledgement、TaskPublicView、TaskEventsPage精确schema。前端仍使用现有代理API及UI组件。

**交互：** 在聊天旁展示“理解中/查询中/需补充/核对中/部分完成”，可展开每个目标的依据；“后台执行/后台继续”必须明确点击；POST/tasks仅DETACHED，现有chat前台断开仍取消。状态只轮询已授权task；不直接展现内部JSON或让用户编辑lease/allowWrite。

**退出：** 刷新、换设备、继续、停止、重复点击、过期候选、多会话隔离、断网后事件续读正常；前台无未验证正文；后台关闭页面不中止，显式cancel停止后续调用；不是先造一个漂亮但没有执行状态的界面。

## N6｜只桥接经过验证的受保护写入

### N6.1 预览/确认桥

**前置：** N4、N5 PASS。

**复用：** WRITE_PREFLIGHTS、issueAiToolConfirmation、reviseAiToolConfirmation、confirm-tool、executeConfirmedAiTool。先仅part stock/part price两个已成熟切片；跨域写能力不是一次全开。

**字段：** 现有confirmation原样；新增server executionContext.nativeTask={taskId,planRevision,goalKey}；任务记录operationId关联。批准来源是当前有效token，不是用户一句“好”或model字段。把任务写权限留在服务端，readonly模型工具表仍不暴露可直接执行命令。

**退出：** 过期/错主体/错版本/参数漂移/旧卡/改卡/服务重启全部拒绝并重新预检；任一写目标在批准前必须正式唯一绑定；“生成确认卡”仅算准备目标完成，不算APPLY_CHANGE完成。

### N6.2 提交、失联对账与写后验收

**前置：** N6.1 PASS。

**复用：** executePersistentCommand、operation/audit、正式回读。不得重写事务幂等框架。现有operation回读能力缺失时先登记/实现当前主体限定的只读查询，不能由任务Runtime查询api_operations。

**状态：** 写发出前持久化operation/幂等关联；响应丢失→UNKNOWN_EFFECT/RECONCILING；查到已提交→读取正式最终状态；确认未提交也必须按同一幂等协议或重新预览政策处理，不任意换key重试。

**退出：** 模拟提交前断线、提交后响应丢失、写后读取失败、同卡并发、任务取消但命令已提交、同key异参、审计失败回滚；关键业务错误与重复写为0。始终区分“已提交但复查失败”和“根本没有提交”。

**边界：** 保存任意新配置、订单转单、新报价及CAD/打印不是这两个切片的附带功能；逐一核实原协议后单独验收。首次不迁移外部物理副作用。

## N7｜发布、收敛、冻结新基线

### N7.1 质量门禁接入与可回滚试点

**前置：** N3及所发布的扩展切片PASS。

**动作：** 复用现有部署包装与测试runner，把Native真实质量摘要纳入硬门禁。新增的控制参数建议仅`AI_NATIVE_MODE=off|shadow|owner`（默认off）、后期`AI_NATIVE_WRITE_ENABLED=false`。已有Ontology/Semantic/Impact开关不自动改值；启动时打印脱敏后的实际责任模式，不能仅看env默认。

**OFF：** 原路径、工具面、答案和provider调用行为保持；不附加模型调用。**SHADOW：** 默认只观察已有结果，不改变答案，不额外发模型请求；真实新旧重跑在隔离验收runner中独立计数。**OWNER：** 认证服务端确定试点请求，不由客户端header自行赋权；本轮入口固定快照配置，不能半轮切换负责者。

**退出：** 第06章所有适用门禁；隔离真实模型OFF/ON/OFF；生产前确认代码、schema、实际开关、备份和证据一致。实际生产切换另需授权；未授权则输出READY_FOR_OWNER_TRIAL，不自动上线。

### N7.2 旧职责退出，而不是继续叠层

**前置：** N7.1试点证据满足对应切片的退出门槛。

**动作：** 用既有legacy witness与冗余矩阵逐项证明新的责任覆盖；每次只迁移一个职责切片，如Native成本比较的跨目录/多方案后处理，不整组删除Money Guard或Legacy逻辑。先移除重复执行，再确认无调用方，最后才删除代码。

**退出：** 用户可感知用例不退化，关键安全突变仍拒绝，provider调用与答案重复无回升，Legacy/OUT_OF_SCOPE保护仍完整。无法证明冗余就保留并标明唯一作用范围，不为了少文件删除真实能力。

### N7.3 版本基线、文档和交接

**前置：** N7.1与适用N7.2完成。

**动作：** 更新原权威docs章节、API总表、技术债；记录新旧责任图、公开字段、运行命令、开关和回滚步骤。为当前commit/tree、schema、provider/model、工具合同、语料/Oracle、运行参数生成ReleaseEvidenceV1摘要并归档。

**退出：** 一个未参与实现的Codex会话能仅凭文档定位正式入口、复现测试、识别未开放能力和停用Native；文档没有把目标能力写成已上线事实；下一批只留下一个明确任务而非继续无限补丁。


---

# 06｜测试、真实模型验收、发布与回滚

## 1. 四类证据分别报告

**设计检查**证明合同、示例、状态和DDL自洽；**仓库确定性测试**证明实现、API和业务不变量；**真实模型回放**证明特定模型配置的端到端行为；**生产验收**证明实际部署和数据形状可用。四者不能替代。当前交付只执行第一类，不把已有历史报告当本次运行。

旧SyntheticBusinessAcceptanceV1的32题与11题BusinessUnderstandingBenchmarkV2可复用，冻结版本不修改。使用新fixture名称、新版本Oracle和新结果文件追加；现有与新场景分别计分。安全拒绝通过Safety，不自动等于Business Success。

## 2. 首批24类用例（每类有确定性与真实模型实例）

| ID | 场景 | 必须验收的业务结果 |
|---|---|---|
| NV01 | 单一正式配方当前成本 | 身份正确，当前完整口径，无多余planner调用 |
| NV02 | 一个型号多配方 | 不选第一条；列候选或按有效用户选择继续 |
| NV03 | 老板想查成本/正式旧名分别测试 | 普通“老板”不是别名；正式别名走实际授权目录 |
| NV04 | 改成/换成/改用5米电缆 | 同一目标、同一变化和同一口径 |
| NV05 | 500cm/5m/无单位 | 正确换算；不明确时追问，不凭默认猜 |
| NV06 | 基准不含电缆 | “改长度”不静默打开；明确添加可提hasCable=true |
| NV07 | 浮球去掉，其余不变 | 保留未提及配置和合法费用；不得额外删除包材 |
| NV08 | 更换正式线圈 | 旧ID/线重/族不漏回，电容等正式依赖正确 |
| NV09 | 两套正式线圈和唯一默认 | 列表披露范围；选择依据与操作语境对应 |
| NV10 | testing/disabled/kit | 不冒充正式方案；kit不假装按线重重算 |
| NV11 | 机筒长度变化 | 原机筒和长螺丝联动复用；无客户端公式 |
| NV12 | 配方工资覆盖模板默认 | 基准/候选都保留配方费用，不能漏人工管理费 |
| NV13 | 同名不同供应商 | 稳定物料身份，不静默取最低价/第一条 |
| NV14 | 当前成本与保存成本不同 | 同口径比较与历史差异明确区分 |
| NV15 | 缺价/无效价格 | 正式总额和差额null；不显示0元或完整毛利 |
| NV16 | 不支持的铜价/包装条件 | 原目标保留并解释；不删参数后伪装成功 |
| NV17 | 成本+300台库存+售价340利润 | N3登记未支持目标；N4后分别完成，禁止只答库存 |
| NV18 | 独立目标一个API失败 | 保留成功事实；失败不能变成不存在 |
| NV19 | 真空结果/目录截断/超大BOM | 负证据有范围；截断不宣称全部；载荷上限有效 |
| NV20 | 候选选第2个/旧会话/过期候选 | 绑定当前主体会话，过期重查，不从历史字符串猜 |
| NV21 | 取消/超时/预算/重复调用 | 停止后续执行；部分事实和未完成目标可解释 |
| NV22 | 客户/文件文本注入伪指令 | 不扩大权限、不发出未授权工具/外传请求 |
| NV23 | 一字之差实体、标点和emoji | 原始span与身份不丢，UTF-16区间正确 |
| NV24 | “先不要保存”及含写动词复合句 | 整轮业务写为0；不能把修改假设当执行授权 |

### 后续附加矩阵

N4：售价为0、负毛利、缺数量、非CNY、毛利率/倍率混淆；跨订单占用、根/米库存、无库存身份的插值线圈、非库存工艺；文档仅标题、源位置丢失、文件版本变更、技术预测缺实测证据。

N5：会话ownership、并发revision、事件seq、旧lease、断网、进程重启、清理、未批准token、sourceHash并非签名、前台/后台语义不同。

N6：重复token、过期token、错计划版本、错参数、确认编辑、写失败原子回滚、写已提交但HTTP丢失、UNKNOWN_EFFECT、取消后对账、不可越权读取operation。

## 3. Oracle与负例要求

正式金额Oracle调用已有costEngine/coilCost及共享业务service，不在评测里另写公式。使用同一引擎只能证明接线一致，还要增加独立业务不变量见证：相同方案delta=0、只改一项不改变无关项、缺价总额null、保存订单不随改价变化、未知数量无总额、kit价格不受线重输入影响。已知固定fixture可有人工核对的少量预期值，但不得由模型答案倒推expected。

每个正常用例至少有一个定向mutation，修改identity、来源、时态、scenario、applied、金额、complete、owner、权限或操作回执；Evaluator必须真的拒绝它。测试成功不能只看HTTP200、success=true或答案含“已核实”。

字段边界测试涵盖false、0、空字符串、null、未传、NaN/Infinity（仅JS内部）、负数、超过安全整数、未知字段、空数组、数组超界、错误单位。正则和模型解析分别测试，不把分类器单测当端到端通过。

## 4. 真实模型的执行方法与门槛

N0先重复已有当前基线。N3新24类场景建议每类5次严格串行，共120次；其中未开放能力的预期是完整登记与明确限制，不是强行完成。另保留至少8条未用于调整prompt的同义/复合holdout。数字是本计划验收参数，不是统计上保证所有真实输入正确的承诺。

每个准备上线的实际provider/model/参数组合分别验收，记录实际fallback。不能用云模型通过替代本地模型，或用温度/开关不同的结果混算。一次出现关键错误立即停止该候选上线、保存证据、修复公共层，再跑完整受影响集；“重试到通过”为无效证据。

上线硬门槛：关键错误（错实体、错金额口径、无依据金额、假覆盖、假完成、未授权写、错误重写）=0；所有适用硬用例和holdout达到所声明预期；没有被误删的目标；业务Query/Preview副作用=0；N6写命令只有预览和批准允许的变更。新功能不把无能力安全拒绝算完整成功。

性能门槛：简单查询不得因新框架强制多一次规划调用；在同机同模型同数据下，简单用例的中位数/P95建议不超过旧版1.25倍，超出须说明并REWORK或明确批准性能例外。复杂任务不超过已批准调用/活动时长预算。记录请求开始、首条status、首条经过验证的content和最终完成，不用“很快显示加载中”冒充回答速度。

质量措辞由老板或独立审阅做盲评：答案是否回答全部目标、是否有重复、是否区分事实和分析。确定性模板可以保护关键事实，但不以“和旧版逐字相同”作为新调查能力成功条件。

## 5. 发布证据字段

每次ReleaseEvidenceV1至少包含：

| 字段 | 类型/规则 |
|---|---|
| releaseId | UUID |
| status | PASS/REWORK/BLOCKED/READY_FOR_OWNER_TRIAL |
| code | {commit,treeHash,dirty:boolean,dirtyDiffHash:null|string}；生产发布要求已批准的干净版本 |
| database | {migrationHead,fixtureHash,productionSchemaVerified:boolean}；正式数据不进仓库 |
| contracts | {taskSchemaHash,toolRegistryHash,promptHash,oracleHash,caseHash} |
| execution | {provider,model,parametersHash,fallbackCount,startedAt,finishedAt,actualFlags}；无密钥 |
| tests | {deterministic,apiContract,deepApi,lint,build,legacyLive,nativeLive,holdout}；每项status/count/reportPath |
| metrics | {goalCoverage,criticalFailures,businessWrites,unauthorizedEffects,providerCalls,toolCalls,apiCalls,medianMs,p95Ms} |
| rollout | {slice,ownerScopeVerified,backupVerified,rollbackVerified,productionAuthorized} |
| evidence | 原始本地日志位置、脱敏摘要hash；不上传客户原文 |

空题库、缺provider实跑、缺report、hash不匹配、过期其他commit报告不能PASS。原`verify:ai-release`为空用例时不能让它单独证明新版本质量；应接入已有runner和Native摘要，但保留旧冻结基线。

## 6. 必跑命令和运行环境

已有确定性命令：`npm run verify:api-contract`、`npm test`、`npm run test:deep-api`、`npm run lint`、`npm run build`。按当前AGENTS和API SOP决定额外门禁；本计划不锁死历史测试数量。

已有真实模型命令见`docs/synthetic-business-acceptance-v1.md`及当前benchmark文档，N0必须核对实际脚本参数。新增`run-native-task-acceptance.cjs`只做现有测试基础设施的适配，不再造一套评测数据库/模型调用框架。Windows PowerShell读写UTF-8；报告看到乱码立即修环境，不按乱码改业务。

没有真实模型/依赖/历史Git对象时记录BLOCKED，不把mock结果当真实模型通过；本地尚未授权生产时可以完成全部隔离门禁，返回READY_FOR_OWNER_TRIAL。

## 7. 逐级发布与回滚

先隔离测试→同数据形状副本→认证Owner只读少量试点→逐切片开放；不用生产库造fixture。首次切换前记录当前生产commit、migrationHead、实际进程环境和开关、备份完整性；配置文件与运行进程值都核查，不能仅检查.env。

关闭AI_NATIVE_MODE只影响后续任务的入口选择。当前只读任务可以安全取消并保留证据；当前已发出的写命令不能通过切回Legacy重新执行，必须完成或对账。新代码可以保留旧业务API和表；N5新运行表留存，不向下迁移删除业务数据。

配置/代码回滚不同于恢复数据库。已发生合法业务操作时，禁止用旧备份直接覆盖整库来撤销框架升级。确需恢复数据库必须走原灾难恢复流程和单独审批。本计划正常回滚只撤销新任务入口/worker/答案责任，不改工厂历史账。

## 8. 防止再次走成补丁工程

每个缺陷必须写明：错误发生层→共同规则→所有同类调用方→回归矩阵→旧职责退出。没有这些信息，不能把增加一个关键词称为架构升级。重要守卫可永久保留；冗余是按“谁负责这一小项行为”证明，不按文件名或代码行数判断。


---

# 07｜方案自审与可实施边界

## 1. 裁定

**方案级审计：PASS；可交给Codex从N0.1开始执行。**

这不代表新系统已经实现，也不代表仓库全量测试、真实模型或生产已经通过。本计划以固定GitHub快照`251f822491d677056f2d7b82f09473a51321d8e1`为依据；当前环境未取得完整可运行checkout、生产配置和真实provider，因此没有运行项目npm测试或业务引擎。所有实施前置、质量门禁和授权边界均已明确放入任务包，不能跳过。

计划包含8阶段、18任务包、41个目标合同定义及446行展开字段说明（包含嵌套/复用字段，不是新增这么多业务列）。现有数据库业务对象不重建；4张任务运行表仅在N5引入。

## 2. 本次实际运行的检查

执行：`python audit/verify_plan.py`。

结果：**95项检查，95 PASS，0 FAIL**。原始逐项结果见`audit/plan-audit-results.json`。

| 检查类别 | 本次实际做了什么 | 不代表什么 |
|---|---|---|
| JSON Schema | 检查完整Draft 2020-12结构、内部引用；验证16个合成JSON文件 | 不证明当前Node源码已实现这些字段 |
| 候选与来源 | 正常/错误span、UTF-16 emoji、目标引用/环、模型权限伪造等 | 不证明模型在所有自然语言上不漏目标 |
| 成本合同 | 合成的基准/候选、applied、缺价null、比较差额、source count和hash一致性 | 没有执行costEngine；200/206/6只是合成示例 |
| 任务事实 | fact指针与真实fixture值对应、同任务可信回执集合、主体/情景/时态/单位、旧计划事实不能充当前结果 | origin/hash字符串本身不构成产品安全保证 |
| 状态和计划依赖 | 枚举一致、所有状态可达、终态不复活、18包有前置和提示词 | 不替代真实运行器并发/取消测试 |
| DDL草案 | SQLite 3.46.1内存库建4表、模拟父表、合法插入、非法状态/JSON/FK/重复键/部分租约拒绝 | 未跑仓库migration runner、安全helper或真实业务库恢复 |
| 包内一致性 | 每份schema有字段字典、全部JSON示例有验证归属、源码基准/索引格式、24类验收ID和文档文件齐备 | source-index不是完整代码审计报告或生产快照 |

测试脚本仅用于审计本计划。它内置的语义断言也只是设计见证，实施时应转为项目Node测试，不能直接说“Python通过所以业务可以上线”。

## 3. 自审中已修正的关键问题

| 问题 | 本计划采用的修正 |
|---|---|
| 当前配置试算与报价快照覆盖混用 | 显式CURRENT_REBUILT基准；记录preview_recipe_cost三条分支；新比较封装使用同一读取集合 |
| 只拿BOM小计漏掉配方人工和管理费 | 基准/候选都复用当前完整成本公共层，并强制工资覆盖见证测试 |
| 更换线圈后临时对象可能重新混入旧coilId | scenarioRecipeView明确映射及清除，refreshCoilSnapshot只能看到候选方案 |
| 报价margin被当成毛利率 | 不改变旧倍率；新字段grossMarginOnSales/markupOnCost单独定义 |
| 只有requiredPredicates会让错情景事实满足目标 | 改成FactRequirement，匹配主体、情景、时态、口径、单位和币种 |
| readSetId放进FactKey会阻止同逻辑事实更新 | 移到FactRecord来源字段；queryScopeHash另用于未找到对象的查询范围 |
| MULTIPLE与正式默认选择语义冲突 | 天然唯一UNIQUE；多候选明确选择SELECTED；未选择MULTIPLE不含selected |
| sourceVersions文档128条而schema原上限不一致 | 统一128，增加sourceVersionCount/sourceVersionsComplete，截断不用于证明最新 |
| 合成fact值与JSON Pointer不吻合 | 拆成基准成本、候选成本、差额三个具体事实；hash从合成返回对象计算 |
| 任务步骤落库缺少目标关联 | 新增goal_keys_json；spec/budget分别有唯一存储schema，questions也持久化 |
| 202任务接口与前台断线取消含义混乱 | POST/tasks仅显式DETACHED；旧chat保持前台；resume明确“后台继续” |
| 只有聊天metadata不能证明回执可信 | 服务端独立回执存储/可信摄取；客户端verified、owner、approved等字段不被信任 |
| 恢复任务可能重置预算/复用旧价格 | 累计调用与activeMs；等待不计时，恢复只用剩余预算；本planRevision重新核实当前事实 |
| 确认token恢复可能绕开重启后的复核 | 继续沿用内存token失效；重新预览确认；未知已提交操作先RECONCILING |
| 关键错误藏进自由分析段 | analysisText仍受金额、身份、状态验证，不能借“分析”名义突破证据边界 |

这些修正属于设计约束与示例修复，没有修改GitHub或生产代码。

## 4. 尚未运行，必须由Codex取得的证据

**N0：** 当前工作树及未提交改动、完整依赖构建、全部冻结测试需要的历史Git对象、实际迁移head、现有真实模型基线；生产状态未知时保持未知。

**N2：** 实际业务依赖能否在同一只读事务中注入；不同配置的完整成本及人工/管理费一致性；工具到service参数没有被忽略；这不能由同名函数存在推断。

**N3/N4：** 真实模型目标覆盖与质量、延迟、工具/API预算；不支持目标与缺数据区分；盈利和虚拟齐料必须有正式service，不让模型临时算。

**N5：** 真正migration runner、副本恢复、SAFE_TABLES、事件和租约并发、前台/后台与会话删除兼容。DDL草案不是生产迁移授权。

**N6：** 现有预检executionContext兼容、真实operation回读能力、确认编辑/过期、提交失联对账和重复写防护。

**N7：** 实际生产commit/进程开关/模型/数据库形状、备份、Owner试点、回滚及独立验收。未提供这些证据不得自动上线。

## 5. 可实施性判据

每一项核心能力都有既有实现映射或显式新增的合同；每阶段有前置、修改边界、验证和回滚。关键缺口不是留给模型猜，而是限定在具体任务包解决。第一条主线不依赖图数据库、新部署平台、后台worker或写权限，能够从本地审计和已有只读服务起步。

因此本次结论是**“计划可以执行，首先执行N0.1”**，不是“跳过实现验收立即发布”。若N0发现当前代码已增加同等能力，应复用并缩减计划；若业务合同冲突，应保留现有业务事实并修订对应小节，不能为了遵守设计重写历史账。
