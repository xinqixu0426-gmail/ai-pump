# P16-K — General Read Assistant Coverage Audit

## 1. Executive Summary / status correction

P16-K audit PASS；**General Read Assistant UAT NOT COMPLETE**。P16 的成功是四类窄事实与安全基础设施的认证，不是对所有读问题的产品验收。老板说“列出所有订单”却被要求理解 limit，属于 PRODUCT UAT FAIL，不能拿安全拦截或 Legacy fallback 当成产品可用性 PASS。

本阶段基线：master / `ba317cce5fbaee9f57f8251d465314b19a3bd0eb`。P17_WRITE_MIGRATION_PAUSED=YES；P17-A 审计结论保留，不进行提案/写实现。未修改生产代码、生产配置、P16 routing、Interpreter、Prompt、API、Tool 或业务数据。未访问生产、未调用模型，不把静态推断写成一次真实生产 UAT。

静态路线盘点：**121 个业务 read-capable HTTP 入口（74 GET + 47 POST query/preview），48 个 AI read Tool**。19 个已显式登记的 query/preview Business capability 不是全部 HTTP 读取面，不能用19冒充 API总数。另列13个技术/认证/dispatch GET入口，不计业务 API；MCP transport不是额外业务能力。

当前 V5可执行 read registry只有3个适配工具，server-derived scope只有4类事实。60个拟议问题中，4个落在既有认证窄合同；2个暂缓；保守**合同覆盖率 4/58=6.90%**。这不是60条真实模型UAT的通过率，也不能推广到任意实体、任意措辞或多轮对话。General Read Owner-Usable Coverage仅按明确窄事实资格计READY，未证明的 Legacy 行为不计READY。

交付：

- [全读取面元数据](../data/p16k-read-surface-inventory.json)：route、query字段、handler/service指针、Tool schema/executor、V5声明/执行/answer边界。
- [60条拟议 UAT](../data/p16k-owner-read-uat.json)：占位符问题、唯一主分类、API/Tool依据、缺口理由。
- `scripts/audit-v5-general-read.cjs`：静态、无服务/DB/网络初始化。
- `tests/aiV5GeneralReadAudit.test.cjs`：8/8 fixture/static tests PASS，无模型/API/DB。

## 2. Current Read Surface / counting and authority

入口以 api.cjs 实际 mount、api/routes 中声明、query service 与 executor核对；不是按 GET=安全 或名字含read就认定可用。47 POST包含计算、draft、preview、身份lookup与span供给；preview可能签发内存确认token，document/CAD preview可能调用外部provider，均不能直接扩展到V5。MCP tools/call可调已有Tools但不另计，auth/login/logout、写命令、确认执行排除。知识检索/诊断可能涉及派生索引/外部模型成本，未来需逐适配证明副作用与预算；本阶段没有调用。

元数据逐API的 handlerCalls/serviceImports 是定位索引，不宣称一个文件中所有service都被每个route调用。Tool apiLiteralReferences 是 case中的源码路径表达式；helper封装的路径需追踪来源，不把无literal等同无API。V5_ROUTABLE记录语义声明，不等于生产准入。

| 层 | 当前判定 |
|---|---|
| API_EXISTS | 业务查询/预览实现存在；并不证明结果有界或默认适合模型 |
| TOOL_EXISTS | 48个read schema与对应executor case齐全；含预览，不是48个已认证V5执行器 |
| V5_ROUTABLE | capabilityRegistry的READ映射可知；无正确任务/实体不能宣称运行时成功 |
| ANSWERABLE | 仅price.current、inventory.quantity、coil.inventory、recipe.cost.preview获认证 |
| OWNER_USABLE | 仅已认证单一完整身份窄事实可计；集合/详情/多源需要新合同；Legacy技术可查但未验收不计READY |

### Domain / query-family findings

| 业务族 | 正式读取及工具基础 | 缺口与重要限制 |
|---|---|---|
| 订单 | GET orders/list/detail/lookup/revisions/requirements/execution-records/knowledge-package/readiness；get_recent_orders/get_order_detail/get_order_knowledge_package | list全DTO，非分页；详情/列表不在V5执行白名单；revision无专用Tool |
| 客户 | customers/list/context；search_customers/search_customer_history | context已join报价和订单（部分旧订单按正式customerName关联）；不得另造模糊identity捷径。缺分页与总数端点 |
| 配件/库存 | parts/list，数值上下界/stockStatus/sortBy/sortOrder；search_parts | 查询在完整数组上filter/sort/slice；不同于DB有界页。库存/价格单事实已认证，集合未认证 |
| 线圈 | coils/list/variants/specs/stock-movements；search_coils/get_coil_specs | coil库存fact已认证；主list无page/cursor/stock阈值筛选；movement有20默认100上限但无专用Tool |
| 配方/BOM/成本 | recipes/list/detail/inventory-status/technical-files/current-costs；cost-preview/parts/full-estimate/recipe-difference；get_recipe_detail/compare_recipes/preview_recipe_cost等 | 成本由正式costEngine；差异/详情/BOM不等于现有单数值preview答案。未发现完整配方版本快照API |
| 模板/型号 | templates/list/detail/cost/default-recipe/recipes/apply；model-variants/list；search_templates/get_template_detail | 默认配方与反向模板关联存在；没有把所有关系投影到Tool/V5，不准全量扫描猜关系 |
| 报价 | quotations/list/detail/inquiry-summary/order-draft；search_quotations/get_quotation_detail | list可选limit无通用页；摘要可能是已存记录或provider draft，需区分正式/草稿 |
| 采购/供应商 | orders/purchase-overview；get_purchase_overview；workbench supplierFocus | 采购任务按supplier等分组；不是独立供应商主档，更不是供应商财务对账。禁止把采购单位混加当库存金额 |
| 生产/管理 | order readiness/knowledge-package/plan，workbench summary/action-center/history/execution-runs；管理/quality Tools | 已有准备度和人工确认事实，不代表完整MES生产报表。管理聚合API可复用，不必凡跨域就新agent循环 |
| 历史/审计 | business-changes、orders/revisions、coil movements、quality rule-events、workbench action-history | search_business_changes有事件分页；正式事件≠所有表的完整版本；缺失历史不得推断没变化 |
| 文件/图纸 | files/list/links/content/download/detail/archive-targets，recipe technical files，rotor history/status/link-targets | archive-targets是归档目标，不是查已归档文件内容的万能Tool；文件API多于工具，V5无文件claim/引文合同 |
| 知识 | knowledge/search/detail/documents/overview/health，search_factory_knowledge/detail/health | 派生索引≠实时库存/成本权威；报告内容的来源页、解析版本/完整性、注入隔离尚未接V5 |
| 配置/市场/技术 | settings读取、铜价/market指标、AI技术状态 | 安全内部读不代表老板通用事实；secret/masked字段不能开放；同步指标是写不在读取范围 |

12个AI read Tool domain为 business_history、catalog、coil、cost、drawing、file、knowledge、management、order、quality、quotation、recipe。18个Business route-family另见JSON（customer等并未因Tool domain归quotation而漏盘点）。跨域能力按实际执行者分类，不把domain字符串数量当业务覆盖率。

## 3. Orders UAT Failure — root cause and evidence limits

### 已证明的共同机制

1. `AI_TOOLS.get_recent_orders`：limit可选，最大100，描述明确“仅用户明确最近/前N个时传入”。无cursor/offset/page。**不是schema强制要求老板传limit**，而是缺安全默认集合合同，错误文案又把技术参数责任推给老板。
2. `queryExecutors.cjs:get_recent_orders` → internalApiClient/internalFetch → GET `/api/orders`，仅传limit/status/customerName/contractNo。返回完整canonicalApiResource DTO，count=data.length；有queryReceipt但不是分页token。
3. `orderQueries.getAllOrders` → `listOrdersWithCurrentPurchasePlans()` → 全量订单及当前平衡采购计划，之后才JS filter/sort/slice。不传limit返回全部；limit只截前N，cursor/offset不支持。list无authoritative page total或hasMore。
4. `aiToolProtocol.enforceAiToolResultSize/enforceAiToolResultBudget`：单结果或合并证据超过262144 UTF-8 bytes，返回AI_QUERY_RESULT_TOO_LARGE。`aiAgentRuntimeV3`调用该保护，并有对应用户拒绝文案。不是Source Span/R9或price拆分缺陷。
5. V5另有独立门槛：order.read虽声明允许get_recent_orders/get_order_detail，但candidateRead要求一个FINAL_ENTITY_RESOLVED与四类requiredFactScope；order无factscope，且readExecutionRegistry无订单执行适配。普通“所有订单”不能凭空制造单一canonical订单。只修256KiB文案/提高上限/塞默认limit均不足以补齐V5列表。

### 原请求哪些信息可确认，哪些不能冒充已观测

Supervisor给定真实owner UAT失败及文案，作为产品失败证据；仓库只证明上述产生机制。本阶段**没有该次requestId/metadata trace**，因此历史实际 Interpreter semantic、V5 fallback class、选中Tool、调用参数、单结果还是累计预算越界均为 NOT_OBSERVED，不能写成实际已选 tc_x/order.read/get_recent_orders。get_recent_orders/orders.list 是代码中正式订单集合路径，不是猜测出的历史运行日志。V5 order.read只是静态声明。

已核对 Legacy基线commit `12fee179b6074215cf359bcc1a789ce1a345b9ba` 同样具有256KiB保护与全量list实现；因此不是把当前user-dirty V3文件擅自归因为生产故障。未来受控UAT应记录route/semantic/capability/tool/returnedCount/byteBudgetClass，无正文，补齐该次新测试的链路，而不是声称复现了历史trace。

### 无业务调用的复现

8个fixture/static测试证明：101个合成DTO不传limit全量返回；limit20只是topN，offset/cursor改变无效；真实size guard拒绝大DTO；两个独立未超限结果也可能触发合并预算；Tool limit非必填；V5 scope仍4类。没有真实模型/Tool executor/DB/API调用，不能冒充60条真实UAT。

### Count 答案

Orders Backend Pagination Available=NO；Orders Current AI Tool Supports Pagination=NO（支持topN limit，不支持翻页）。Orders Authoritative Total Count Available=YES，**仅 workbench/summary 的全局 kpis.totalOrders**；orders/list 本身没有filtered totalCount。get_recent_orders.count是返回行数；限量后不能回答总共有多少。不存在“所有订单统计API完全没有”的结论，也不存在“有全局count就有任意过滤count”的结论。

Primary root cause：**MISSING_BOUNDED_COLLECTION_AND_CONTINUATION_CONTRACT**；共同次级缺口：minimal projection、collection evidence/answer、collection semantic scope。Owner UX=FAIL。不要删除安全上限或让模型全表读取。

## 4. Proposed Generic Bounded Collection Contract — FROZEN v1 design only

此处冻结未来要求，不改现有API/P16事实。defaultPageSize=20，maxPageSize=50（提议助手层标准；现有多处limit上限100不被本审计修改）。自然“所有”含义是可继续浏览整个集合，不是一次把所有DTO给模型；显式更大数量按页说明，不静默截断。

```ts
type CollectionRequest = {
  version: 1;
  queryContractRef: ApprovedCollectionContract;
  filters: ContractBoundFilters; // no SQL/table/column expressions
  sort: ApprovedStableSort;
  pageSize: BoundedInteger; // software default, not owner prerequisite
  continuationRef?: OpaqueServerOwnedRef;
};
type CollectionPage = {
  version: 1;
  queryRef: OpaqueQueryRef;
  rows: MinimalApprovedRowProjection[];
  returnedCount: number;
  totalCount: number | null;
  totalScope: 'EXACT_FILTERED' | 'UNAVAILABLE';
  hasMore: boolean;
  nextRef: OpaqueServerOwnedRef | null;
  sort: ApprovedStableSort;
  appliedFilters: ContractBoundFilters;
  asOf: Timestamp;
  consistency: 'SNAPSHOT' | 'LIVE_PAGE';
  completePage: boolean;
};
```

默认排序每domain预定义：订单按正式createdAt DESC + canonicalId DESC；不得把id大小当真实创建时间。可用keyset cursor优先；确须现有offset，必须有稳定排序、过滤绑定并说明并发插入导致页漂移，不能宣称snapshot。现有businessChanges beforeId+occurred_at模式可参考但不是直接复用至所有资源。

服务端数据库层过滤、排序、limit+1，最小投影；不能full-list→JS slice伪装bounded data path。每row只有经审批的业务标识、状态、日期等默认必要字段；订单默认不传BOM/全部采购计划/文件正文。进一步详情按明确用户请求进入独立detail projection。

totalCount有正式来源才说“共X”；没有时说“先列出这20条，可继续查看”，绝不从20行推出全量20。0条是完整查询的零结果，不是基础设施错误；page incomplete/error fail closed，不把部分行称完整答案。单行仍超预算则安全详情/下载入口，不隐瞒删字段；总数、显示条数与省略说明都须验证。

## 5. Continuation / collection evidence — FROZEN

“继续/下一页”绑定服务端queryRef：same authenticated principal + conversation + queryContract + filters + sort + snapshot/version + next cursor + expiry。模型不创建/修改cursor；用户不输入cursor。并列两个查询时澄清继续哪个，不能任选最近一个。推荐15分钟context TTL，仅存opaque refs与必要受控状态，不存答案到通用日志。失效明确提示重新查询；无批量自动翻到末尾。

Collection evidence必须包括正式API/query版本、request/execution correlation、过滤/排序、asOf、canonical row身份（软件私有）、display字段白名单、逐row字段证据、returnedCount、totalCount来源、hasMore/边界证据、完整性。重复row/wrongquery/wrongowner/缺字段拒绝。Answer只看当前页批准projection；数值必须逐字段一致，不能把金额、数量或页数互换。页响应与continuation不是现有scalar factKey的临时重载；未来需独立证据合同，不改四个已认证fact语义。

## 6. Aggregate / Count Contract — FROZEN

Server-owned aggregateKey + formal filters + timeRange/timezone + status inclusion + unit/currency + asOf + scope + completeness + value，只允许登记的统计定义。优先正式API服务端COUNT/SUM/AVG；也可已有正式service全数据聚合，但必须证明完整源/负载可控，不能把模型部分page聚合称authoritative。

现有基础：

| 正式来源 | 有什么 | 不可推导什么 |
|---|---|---|
| workbench/summary → businessSummary | totalOrders/active/today、partCount/recipeCount、stock<=0缺货、0<stock<=5低库存、正式confirmed/orderBook/completed财务口径 | 任意本月/月份趋势/平均值/客户总数/库存总价值；收入不是已收款 |
| orders/purchase-overview → orderQueries | task/supplier/activeOrder counts、planned/ordered/received/stocked/pending等正式汇总、returnedCount/truncated | 所有订单总数、库存价值、未定义单位混合总数 |
| business-changes → listBusinessChanges | 同过滤COUNT(*)、occurred_at/id排序、beforeId/nextCursor | 保留期之外的完整历史；当前cursor返回满页时可能下一页空，不能盲称hasMore已严格证明 |
| customers/:id/context | 正式客户订单/报价关联、summary计数，之后limit截取 | 跨全部客户总数、所有月份新客趋势 |
| management/quality/workflow/knowledge health | 各自范围明确的metrics/records counts | 泛化为财务或生产完成事实 |

已有统计不要求全新API；缺少月度/均值/趋势须正式定义后新增/扩展服务端合同。财务数值沿用costEngine/businessSummary业务authority，不新增AI会计公式。库存估值和预测暂缓，需要Supervisor业务口径批准。未来统计测试含空集、取消/关闭状态、时区边界、重复实体、分页误计、currency/unit与rounding政策。

## 7. Multi-Read / Cross-Domain Findings

当前生产Candidate：一个resolvedIdentity、一个requiredFactKey、一个ReadExecution请求；readExecutionShadow toolCalls=1，无多Tool investigation loop。Answer.prepareView接受<=4 factKeys但同task同entity已验证handle，不代表多实体/跨Tool证据已认证。Tool内部可能读多个正式API，resolver也有有界调用；这些不是V5通用多步调查。

Legacy/V3代码有MAX_TOOL_ROUNDS=7、MAX_TOOL_CALLS=10以及knowledge companion；**不可把Legacy循环能力算作V5已有能力**。owner-default多轮/context输入依现有合同回退Legacy，没有V5可控continuation状态。

跨域分层：

- 客户订单+报价、订单knowledge-package/readiness、管理summary：已有正式复合API+Tool；primary为EVIDENCE_CONTRACT_GAP，先适配已有业务authority，不增加不必要多Tool。
- 订单→多个当前配方成本、两个独立配件库存对比：NEEDS_MULTI_READ_ORCHESTRATION；现有读边界可复用，缺exact relation/预算/多源证据与finalization。
- 配件反向配方查询、月度统计：NEEDS_NEW_API，不能用任意全量扫描替代。
- 线圈movement、订单revision：NEEDS_NEW_TOOL（API已存在）并随后证据适配。
- 未批准存货估值/预测：UNSAFE/DEFERRED。

未来多读建议：只读，max Tool calls=4/request（proposal，不改当前1），最多2依赖层、最多50总展示rows、每个API自己的hard bounds且整体deadline；复用正式复合API优先。软件预定义query DAG/允许的关系路径，模型只可选已批准调查意图，不遍历API。逐Tool evidence+same-query owner isolation；禁止失败重试、无界agent loop、写工具、直接SQLite、fuzzy top1。证据不足/关系不唯一则澄清或带范围限制回答，不给出假完整总数。Legacy fallback必须单一final、不暴露未验证中间内容。

## 8. Files / History / Knowledge

文件读取与总结不是同一能力。已存在content/download/links，技术文件关联和rotorhistory；已上传但未解析的文件不能假装有文字证据。inspect_quotation_file只针对报价业务，不能自动升级通用测试报告总结；parse端点是mutation，不在本阶段或future read-only tool里偷偷执行。后续须冻结文件大小/页数、已有解析版本与来源定位、访问权、类型、内容注入隔离、数值表格引文、缺页/扫描失败处理；不得下载运行附件。

business-change有事件历史；order revisions有正式snapshot；coil movements有库存流水；quality rule history有规则事件。未发现统一part价格时间序列API或完整recipe revision API；价格事件可查已记录变化，不可编造未记录区间。知识索引的freshness和source provenance需显式保留，不能替代实时业务Query。

## 9. Coverage Metrics / owner UAT matrix

每条仅一个primary blocker；次级阻断不消失。分类优先表达最小平台缺口，不把所有问题笼统列为“换模型”。READY4仅复用已认证窄合同，不声称新问法已跑；所有60问题为拟议安全占位符UAT，production model runs=0。

READY=4；TECHNICALLY_SUPPORTED_UX_GAP=9；ORCHESTRATION_GAP=6；API_GAP=9；TOOL_GAP=3；EVIDENCE_CONTRACT_GAP=20；SEMANTIC_GAP=2；FILE_KNOWLEDGE_GAP=5；DEFERRED=2。总60；non-DEFERRED58；coverage=6.90%。不是把fallback次数当coverage。

## 10. Priority / minimum reusable implementation stages

拟4个实现阶段，不按60问题拆60补丁；均须单独Supervisor批准，本阶段不开始。

| Stage | Objective / owner价值 | APIs/Tools | Acceptance corpus / boundary |
|---|---|---|---|
| P16-L / R1 Basic | 通用bounded collection + detail projection + continuation +基本count；先订单/客户/零件，再同合同配方/线圈 | orders/customers/parts/recipes/coils list、正式detail、workbench已有counts；扩展已有read Tool合同 | K05–K24中适用基础项、K30/K31/K33；全类别0/1/20/21/max、继续/跨owner、空结果/大行、正确total、四窄事实非回归；不得提高字节上限充当修复 |
| R2 Investigation | 有界关系、多对象、多源证据 + 通用事件timeline | 优先customer context/order knowledge；再bounded DAG；反向part关系API、movement/revision Tool | K34–K43/K49/K50/K55–K59；歧义/缺关系/预算/部分失败/历史缺口/跨任务污染；无写 |
| R3 Management | 正式aggregate/statistics与管理摘要；月度/均值等先业务定义 | workbench/purchase/quality现有汇总复用，缺少的时间分桶/客户counts API扩展 | K21–K30/K44–K47；时间边界、状态包含、金额口径、exact numeric与count；K28/K48继续DEFERRED除非另批 |
| R4 Files | 文件/知识read与可核验摘要 | files/technical-files/knowledge/rotor现有读API，补read Tool/projection | K51–K54/K60；权限、页级引用、未知解析、数字、prompt injection、元数据泄漏；不触发parse/upload/archive写 |

R1按老板高频列表/筛选/详情/总数优先；不是因为容易实现就先做低价值技术health。计数合同在R1冻结基础，复杂统计在R3，避免拆成每domain一个stage。每Stage都执行正式API/Tool契约SOP（届时读取并更新原权威文档），deterministic+fake-provider+批准后的固定owner UAT，不能跑到绿为止。

P16_L_READY=YES（下一阶段设计范围明确，待批准实施）；General Read Assistant UAT仍未完成；P17保持暂停。60问题矩阵是接受门槛起点，不是代替真实owner验收。

## 11. Safety / artifact validation

V5 Writes=0；allowWrite enabling calls=0；Business Mutation Calls From V5=0；Production Business Data Modified=NO；P16 Owner Read Production State Changed=NO；P17_WRITE_MIGRATION_PAUSED=YES。无生产调用、模型调用、DB读取/变更、部署、重启或新权限。保留12个tracked user dirty文件及已有untracked，审计仅新增script/test/JSON/report。

验证：8/8纯fixture/static tests；脚本重复生成与JSON一致；route唯一性、read Tool schema/executor case存在、60条唯一主分类、数字覆盖率核对；git diff whitespace检查。不运行会初始化真实DB的完整服务或mutating tests；不宣称全回归/生产UAT PASS。历史请求实际semantic未观测是明确证据限制，不用猜测填补。

## Appendix A — 60-question matrix

| Case | Category | Owner question (fixture) | Primary status | Tool / API | Reason |
|---|---|---|---|---|---|
| K01 | A | <零件甲>现在的目录单价是多少？ | READY | search_parts | price.current 已认证；唯一精确目录身份前提 |
| K02 | A | 帮我查下<零件甲>还有多少库存。 | READY | search_parts | inventory.quantity 已认证；不是任意库存口径 |
| K03 | A | <线圈完整方案名>还有多少？ | READY | search_coils | coil.inventory 已认证；完整精确身份 |
| K04 | A | <配方完整名称>现在的成本预览是多少？ | READY | preview_recipe_cost | recipe.cost.preview 已认证；不得称最终结算成本 |
| K05 | B | 给我看看<订单甲>的完整信息。 | EVIDENCE_CONTRACT_GAP | get_order_detail | 详情 DTO 存在；无订单详情 verified fact/answer contract |
| K06 | B | <客户甲>的资料给我看一下。 | EVIDENCE_CONTRACT_GAP | search_customers | 客户明细存在；V5 无资料证据投影 |
| K07 | B | <配方甲>里面具体用了什么？ | EVIDENCE_CONTRACT_GAP | get_recipe_detail | BOM 可读；现有单数值 claim 不覆盖 BOM |
| K08 | B | 我想看<线圈方案甲>的详细参数。 | EVIDENCE_CONTRACT_GAP | search_coils | 库存之外参数未批准为 answer facts |
| K09 | B | <报价甲>的明细和状态是什么？ | EVIDENCE_CONTRACT_GAP | get_quotation_detail | 详情存在但 V5 不具备执行/证据适配 |
| K10 | B | <模板甲>默认的配方配置是怎样的？ | TOOL_GAP | GET /api/templates/:id/default-recipe | 专用 API 存在；没有对应受治理 Tool 投影 |
| K11 | C | 列出所有订单 | TECHNICALLY_SUPPORTED_UX_GAP | get_recent_orders | 全量完整 DTO 与结果字节上限冲突；不是老板应提供 limit |
| K12 | C | 列出所有客户。 | TECHNICALLY_SUPPORTED_UX_GAP | search_customers | 可选 limit，无通用页与自然继续 |
| K13 | C | 咱们现在有哪些零件？ | TECHNICALLY_SUPPORTED_UX_GAP | search_parts | 目录列表存在但 V5 单实体事实不等于集合答案 |
| K14 | C | 有哪些配方？先给我看看。 | TECHNICALLY_SUPPORTED_UX_GAP | get_all_recipes | 无通用分页；全量获取风险 |
| K15 | C | 仓库有哪些线圈方案？ | TECHNICALLY_SUPPORTED_UX_GAP | search_coils | 无集合证据和安全默认页 |
| K16 | D | 继续，给我下一页订单。 | SEMANTIC_GAP | get_recent_orders | 无服务端 continuation context；Candidate 单消息，不接多轮状态 |
| K17 | D | 刚才那批客户再看后20条。 | SEMANTIC_GAP | search_customers | 模型不得自行编造 cursor/上一页筛选 |
| K18 | E | 把采购中的单子列出来。 | TECHNICALLY_SUPPORTED_UX_GAP | get_recent_orders | status 正式支持；缺安全页/集合答案 |
| K19 | E | 找一下<客户甲>的订单。 | TECHNICALLY_SUPPORTED_UX_GAP | get_recent_orders | customerName 搜索存在；多匹配不能当唯一实体 |
| K20 | F | 最近10个订单让我看看。 | TECHNICALLY_SUPPORTED_UX_GAP | get_recent_orders | limit 支持但 id倒序不必然等于业务创建时间；无 V5集合答案 |
| K21 | G | 现在总共有多少订单？ | EVIDENCE_CONTRACT_GAP | get_dashboard_summary | 全局 totalOrders 权威汇总已有；不能用分页 count替代 |
| K22 | G | 现在有多少客户？ | API_GAP | search_customers | 无专用有界权威总数；全量数组计数不是推荐方案 |
| K23 | G | 有多少零件已经缺货？ | EVIDENCE_CONTRACT_GAP | get_dashboard_summary | 正式 outOfStockPartCount，stock<=0；尚无 V5 aggregate fact |
| K24 | G | 本月新建了多少订单？ | API_GAP | get_dashboard_summary | 仅 today/all 固定统计，不提供月过滤聚合 |
| K25 | H | 本月订单金额合计多少？ | API_GAP | get_dashboard_summary | 现有财务 basis 不是月度口径；需时间/状态契约 |
| K26 | H | 平均一张订单金额是多少？ | API_GAP | get_dashboard_summary | 无正式平均值 contract；不让模型除法自行定义口径 |
| K27 | H | 哪一个月的订单最多？ | API_GAP | — | 缺月度分桶权威查询 |
| K28 | H | 全部库存现在总共值多少钱？ | DEFERRED | — | 存货估值/数量单位/计价口径未冻结；不得猜 price*stock |
| K29 | H | 已确认订单的预计收入和成本分别多少？ | EVIDENCE_CONTRACT_GAP | get_dashboard_summary | confirmed_orders_locked_cost_plus_recorded_procurement_variance 已存在；不是已收款 |
| K30 | G | 系统里共有多少个配方？ | EVIDENCE_CONTRACT_GAP | get_dashboard_summary | recipeCount 已有；缺 aggregate evidence |
| K31 | I | 哪些零件库存低于50？ | TECHNICALLY_SUPPORTED_UX_GAP | search_parts | stockBelow 正式过滤存在；缺集合完整性与分页 |
| K32 | I | 哪些线圈快没了？ | API_GAP | search_coils | 没有已冻结线圈低库存阈值与 stock过滤契约；需业务澄清而非猜阈值 |
| K33 | I | 哪些订单还没完成？ | ORCHESTRATION_GAP | get_recent_orders | 需要业务状态集合定义；现有单status查询需有界组合或 API状态集合 |
| K34 | J | <配方甲>需要哪些配件？ | EVIDENCE_CONTRACT_GAP | get_recipe_detail | 已有BOM，不需新算式；需关系证据 |
| K35 | J | <零件甲>在哪些配方里用到了？ | API_GAP | — | 未发现 canonical part反向引用查询；不能全表给模型扫描 |
| K36 | J | <订单甲>对应配方当前用了哪些零件？ | ORCHESTRATION_GAP | get_order_detail + get_recipe_detail | 订单快照和当前配方需分开关联；bounded join |
| K37 | J | <客户甲>以前买过哪些产品？ | EVIDENCE_CONTRACT_GAP | search_customer_history | 单 API 已做订单/报价关系；不必先造通用 agent loop |
| K38 | I | 对比一下<零件甲>和<零件乙>库存。 | ORCHESTRATION_GAP | search_parts | 两个独立身份与证据组合；当前单实体单执行 |
| K39 | J | <配方甲>和<配方乙>成本差在哪里？ | EVIDENCE_CONTRACT_GAP | compare_recipes | 已有正式差异计算；V5 当前无多对象结果证据适配 |
| K40 | J | <线圈甲>有哪些出入库记录？ | TOOL_GAP | GET /api/coils/:id/stock-movements | 正式 movement API，无相应 AI 读工具 |
| K41 | K | <订单甲>对应的配方和当前成本是什么？ | ORCHESTRATION_GAP | get_order_detail + preview_recipe_cost | 一个订单可能多个配方；有界多读并标记 snapshot/current |
| K42 | K | <客户甲>最近订单和报价情况怎么样？ | EVIDENCE_CONTRACT_GAP | search_customer_history | 已有跨域 API；缺 projection/sort/时域和 V5证据 |
| K43 | K | <产品甲>现在库存、成本、报价各是多少？ | ORCHESTRATION_GAP | — | 业务产品/配方/库存/报价关系必须正式关联，不把配件库存当成品库存 |
| K44 | M | 现在有哪些事情值得我注意？ | EVIDENCE_CONTRACT_GAP | get_management_action_center | 已有确定性管理待办，不应由模型创造重要性事实 |
| K45 | M | 现在有哪些零件需要补货？ | EVIDENCE_CONTRACT_GAP | get_dashboard_summary | 已有缺货/低库存/待采投影；需区分阈值告警与实际采购需求 |
| K46 | M | 最近新增客户的情况如何？ | API_GAP | search_customers | 缺时间筛选/新客聚合，不能凭当前列表推测趋势 |
| K47 | M | 各供应商还有多少东西没采购？ | EVIDENCE_CONTRACT_GAP | get_purchase_overview | 正式 supplier/task summary 已有；数量单位不可混加成财务金额 |
| K48 | M | 预测下个月订单能增长多少。 | DEFERRED | — | 预测不是已验证 read fact；无批准预测口径 |
| K49 | K | <订单甲>保存时的成本与现在成本差多少？ | ORCHESTRATION_GAP | get_order_detail + preview_recipe_cost | 锁定快照与当前预览跨源；禁止用报价差异混作订单实际成本 |
| K50 | M | <订单甲>现在能生产了吗，缺什么？ | EVIDENCE_CONTRACT_GAP | get_order_knowledge_package | readiness+confirmed context 已有；只需正式证据适配，不执行处理方案 |
| K51 | N | 找一下<订单甲>的附件。 | FILE_KNOWLEDGE_GAP | GET /api/files/links | 文件关联 API已有；非archive-targets命中就算附件内容 |
| K52 | N | 找<产品甲>的测试报告。 | FILE_KNOWLEDGE_GAP | get_recipe_technical_files | 需正式关联/权限/文件证据，不能知识相似度冒充同一对象 |
| K53 | N | 帮我找<型号甲>对应图纸。 | FILE_KNOWLEDGE_GAP | get_rotor_drawing_history | 历史/链接已有，未接 V5 文件证据与可见链接契约 |
| K54 | N | 总结一下<测试报告甲>，只说已测出的结果。 | FILE_KNOWLEDGE_GAP | GET /api/files/:id/content | 已有解析内容读取；通用报告摘要与页码引文/数字证据未认证 |
| K55 | L | <零件甲>最近价格怎么变的？ | EVIDENCE_CONTRACT_GAP | search_business_changes | 只能覆盖有记录的变更；不得把无历史当价格不变 |
| K56 | L | <订单甲>什么时候改过状态？ | EVIDENCE_CONTRACT_GAP | search_business_changes | 正式事件历史已有；需时间线证据与保留期说明 |
| K57 | L | <配方甲>上一个版本是什么？ | API_GAP | — | 未发现配方完整版本快照API；change events不等于可重建版本 |
| K58 | L | 最近有哪些重要业务变更？ | EVIDENCE_CONTRACT_GAP | search_business_changes | 已有分页事件；重要性筛选需正式规则，不能模型虚构 |
| K59 | L | <订单甲>的历史版本给我看看。 | TOOL_GAP | GET /api/orders/:id/revisions | 正式版本端点存在，无独立版本读Tool |
| K60 | N | 查一下知识库里<工艺主题甲>的正式说明。 | FILE_KNOWLEDGE_GAP | search_factory_knowledge + get_factory_knowledge_detail | 检索/详情已存在；派生索引不能当实时业务真相 |

## Appendix B — Read API inventory

| Method | Endpoint | Scope | Query fields | Source |
|---|---|---|---|---|
| GET | /api/auth/check | TECHNICAL_OR_DISPATCH |  | api/routes/auth.cjs:80 |
| GET | /api/health/live | TECHNICAL_OR_DISPATCH |  | api/routes/health.cjs:8 |
| GET | /api/health/ready | TECHNICAL_OR_DISPATCH |  | api/routes/health.cjs:40 |
| GET | /api/health | TECHNICAL_OR_DISPATCH |  | api/routes/health.cjs:41 |
| POST | /api/cost/parts | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:68 |
| GET | /api/cost/recipe/by-name | BUSINESS_READ_CAPABLE | name | api/routes/cost.cjs:80 |
| GET | /api/recipes/current-costs | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:92 |
| GET | /api/recipes/:id/cost | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:103 |
| POST | /api/cost/coil | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:114 |
| POST | /api/cost/float | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:125 |
| POST | /api/cost/cable | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:136 |
| POST | /api/cost/packing | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:147 |
| POST | /api/cost/overhead | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:158 |
| POST | /api/cost/dynamic | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:170 |
| POST | /api/recipes/:id/cost-preview | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:182 |
| POST | /api/cost/full-estimate | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:205 |
| POST | /api/cost/recipe-difference | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:221 |
| GET | /api/copper-price | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:282 |
| GET | /api/market-indicators | BUSINESS_READ_CAPABLE |  | api/routes/cost.cjs:309 |
| GET | /api/parts | BUSINESS_READ_CAPABLE | keyword, category, supplier, stockStatus, limit, minPrice, maxPrice, priceBelow, priceAbove, minStock, maxStock, stockBelow, stockAbove, sortBy, sortOrder | api/routes/parts.cjs:69 |
| POST | /api/parts/batch-create-preview | BUSINESS_READ_CAPABLE |  | api/routes/parts.cjs:111 |
| POST | /api/parts/batch-delete-preview | BUSINESS_READ_CAPABLE |  | api/routes/parts.cjs:139 |
| POST | /api/parts/prices-preview | BUSINESS_READ_CAPABLE |  | api/routes/parts.cjs:167 |
| POST | /api/parts/:id/save-preview | BUSINESS_READ_CAPABLE |  | api/routes/parts.cjs:192 |
| POST | /api/parts/:id/delete-preview | BUSINESS_READ_CAPABLE |  | api/routes/parts.cjs:241 |
| POST | /api/parts/batch-stock-preview | BUSINESS_READ_CAPABLE |  | api/routes/parts.cjs:274 |
| GET | /api/recipes | BUSINESS_READ_CAPABLE | keyword, hasTechnicalFiles | api/routes/recipes.cjs:102 |
| POST | /api/recipes/cost-draft | BUSINESS_READ_CAPABLE |  | api/routes/recipes.cjs:121 |
| POST | /api/recipes/bom-draft | BUSINESS_READ_CAPABLE |  | api/routes/recipes.cjs:130 |
| POST | /api/recipes/model-variant-draft | BUSINESS_READ_CAPABLE |  | api/routes/recipes.cjs:139 |
| POST | /api/recipes/save-payload-draft | BUSINESS_READ_CAPABLE |  | api/routes/recipes.cjs:152 |
| GET | /api/recipes/:id/inventory-status | BUSINESS_READ_CAPABLE |  | api/routes/recipes.cjs:165 |
| GET | /api/recipes/:id/technical-files | BUSINESS_READ_CAPABLE |  | api/routes/recipes.cjs:176 |
| GET | /api/recipes/:id/technical-files/:fileId/download | BUSINESS_READ_CAPABLE |  | api/routes/recipes.cjs:222 |
| GET | /api/recipes/:id | BUSINESS_READ_CAPABLE |  | api/routes/recipes.cjs:261 |
| POST | /api/recipes/:id/delete-preview | BUSINESS_READ_CAPABLE |  | api/routes/recipes.cjs:289 |
| GET | /api/templates | BUSINESS_READ_CAPABLE | shellModel, description, limit | api/routes/templates.cjs:69 |
| GET | /api/templates/:id | BUSINESS_READ_CAPABLE |  | api/routes/templates.cjs:84 |
| GET | /api/templates/:id/cost | BUSINESS_READ_CAPABLE |  | api/routes/templates.cjs:95 |
| GET | /api/templates/:id/default-recipe | BUSINESS_READ_CAPABLE |  | api/routes/templates.cjs:106 |
| POST | /api/templates/:id/apply | BUSINESS_READ_CAPABLE |  | api/routes/templates.cjs:117 |
| GET | /api/templates/:id/recipes | BUSINESS_READ_CAPABLE |  | api/routes/templates.cjs:131 |
| GET | /api/model-variants | BUSINESS_READ_CAPABLE |  | api/routes/modelVariants.cjs:46 |
| GET | /api/orders | BUSINESS_READ_CAPABLE | limit, status, customerName, contractNo | api/routes/orders.cjs:128 |
| GET | /api/orders/purchase-overview | BUSINESS_READ_CAPABLE | limit, supplier, pendingOnly | api/routes/orders.cjs:150 |
| GET | /api/orders/history-price/:recipeName | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:170 |
| POST | /api/orders/purchase-plan | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:180 |
| GET | /api/orders/lookup | BUSINESS_READ_CAPABLE | query | api/routes/orders.cjs:192 |
| GET | /api/orders/readiness-overview | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:203 |
| GET | /api/orders/:id/knowledge-package | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:214 |
| GET | /api/orders/:id/readiness-plan | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:224 |
| GET | /api/orders/:id/readiness | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:273 |
| GET | /api/orders/:id/requirements | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:284 |
| GET | /api/orders/:id/execution-records | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:348 |
| POST | /api/orders/save-payload-draft | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:456 |
| POST | /api/orders/purchase-items/batch-draft | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:498 |
| POST | /api/orders/:id/purchase-items/progress-draft | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:568 |
| POST | /api/orders/:id/complete-purchase-draft | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:631 |
| GET | /api/orders/:id | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:674 |
| GET | /api/orders/:id/revisions | BUSINESS_READ_CAPABLE |  | api/routes/orders.cjs:685 |
| GET | /api/coils | BUSINESS_READ_CAPABLE |  | api/routes/coils.cjs:76 |
| GET | /api/coils/variants | BUSINESS_READ_CAPABLE |  | api/routes/coils.cjs:81 |
| POST | /api/coils/spec-draft | BUSINESS_READ_CAPABLE |  | api/routes/coils.cjs:86 |
| POST | /api/coils/spec-price-preview | BUSINESS_READ_CAPABLE |  | api/routes/coils.cjs:106 |
| POST | /api/coils/stock-adjustments-preview | BUSINESS_READ_CAPABLE |  | api/routes/coils.cjs:140 |
| GET | /api/coils/:id/stock-movements | BUSINESS_READ_CAPABLE | limit | api/routes/coils.cjs:170 |
| POST | /api/coils/calculate | BUSINESS_READ_CAPABLE |  | api/routes/coils.cjs:262 |
| GET | /api/coils/specs | BUSINESS_READ_CAPABLE |  | api/routes/coils.cjs:266 |
| POST | /api/rotor/draw-preview | BUSINESS_READ_CAPABLE |  | api/routes/rotor.cjs:78 |
| POST | /api/rotor/chat | BUSINESS_READ_CAPABLE |  | api/routes/rotor.cjs:129 |
| GET | /api/rotor/status/:jobId | BUSINESS_READ_CAPABLE |  | api/routes/rotor.cjs:147 |
| GET | /api/rotor/history | BUSINESS_READ_CAPABLE |  | api/routes/rotor.cjs:156 |
| POST | /api/rotor/print/:jobId/preview | BUSINESS_READ_CAPABLE |  | api/routes/rotor.cjs:211 |
| GET | /api/rotor/order-pump-models | BUSINESS_READ_CAPABLE |  | api/routes/rotor.cjs:254 |
| POST | /api/rotor/recipe-draft | BUSINESS_READ_CAPABLE |  | api/routes/rotor.cjs:270 |
| POST | /api/rotor/template-draft | BUSINESS_READ_CAPABLE |  | api/routes/rotor.cjs:289 |
| GET | /api/rotor/link-targets | BUSINESS_READ_CAPABLE |  | api/routes/rotor.cjs:312 |
| GET | /api/settings/runtime | BUSINESS_READ_CAPABLE |  | api/routes/settings.cjs:45 |
| GET | /api/settings/:key | BUSINESS_READ_CAPABLE |  | api/routes/settings.cjs:90 |
| GET | /api/settings | BUSINESS_READ_CAPABLE |  | api/routes/settings.cjs:128 |
| GET | /api/customers | BUSINESS_READ_CAPABLE | id, name, limit | api/routes/customers.cjs:51 |
| GET | /api/customers/:id/context | BUSINESS_READ_CAPABLE |  | api/routes/customers.cjs:71 |
| GET | /api/quotations | BUSINESS_READ_CAPABLE | status, customerName, limit | api/routes/quotations.cjs:75 |
| GET | /api/quotations/:id | BUSINESS_READ_CAPABLE |  | api/routes/quotations.cjs:96 |
| POST | /api/quotations/save-payload-draft | BUSINESS_READ_CAPABLE |  | api/routes/quotations.cjs:123 |
| POST | /api/quotations/inquiry-summary-draft | BUSINESS_READ_CAPABLE |  | api/routes/quotations.cjs:137 |
| GET | /api/quotations/:id/inquiry-summary | BUSINESS_READ_CAPABLE |  | api/routes/quotations.cjs:155 |
| POST | /api/quotations/:id/order-draft | BUSINESS_READ_CAPABLE |  | api/routes/quotations.cjs:175 |
| GET | /api/workbench/summary | BUSINESS_READ_CAPABLE |  | api/routes/workbench.cjs:26 |
| GET | /api/workbench/action-center | BUSINESS_READ_CAPABLE |  | api/routes/workbench.cjs:34 |
| GET | /api/workbench/action-history | BUSINESS_READ_CAPABLE | status, limit | api/routes/workbench.cjs:43 |
| POST | /api/workbench/execution-plan | BUSINESS_READ_CAPABLE |  | api/routes/workbench.cjs:60 |
| GET | /api/workbench/execution-runs | BUSINESS_READ_CAPABLE | workflowType, subjectId, actionId, status, limit | api/routes/workbench.cjs:72 |
| GET | /api/quality/summary | BUSINESS_READ_CAPABLE |  | api/routes/quality.cjs:43 |
| GET | /api/quality/business-alerts | BUSINESS_READ_CAPABLE |  | api/routes/quality.cjs:51 |
| POST | /api/quality/recipe-analysis | BUSINESS_READ_CAPABLE |  | api/routes/quality.cjs:59 |
| GET | /api/quality/rule-compliance | BUSINESS_READ_CAPABLE |  | api/routes/quality.cjs:107 |
| GET | /api/quality/rule-learning-health | BUSINESS_READ_CAPABLE | limit | api/routes/quality.cjs:115 |
| GET | /api/quality/rule-candidates | BUSINESS_READ_CAPABLE | status | api/routes/quality.cjs:126 |
| GET | /api/quality/rule-events | BUSINESS_READ_CAPABLE | candidateId, limit | api/routes/quality.cjs:137 |
| GET | /api/quality/rule-candidates/:id/impact | BUSINESS_READ_CAPABLE |  | api/routes/quality.cjs:190 |
| GET | /api/files | BUSINESS_READ_CAPABLE | detectedType, sourceType, limit | api/routes/files.cjs:56 |
| POST | /api/files/business-attachment-preview | BUSINESS_READ_CAPABLE |  | api/routes/files.cjs:136 |
| GET | /api/files/archive-targets | BUSINESS_READ_CAPABLE | targetType, query, limit | api/routes/files.cjs:231 |
| GET | /api/files/links | BUSINESS_READ_CAPABLE | targetType, targetId | api/routes/files.cjs:246 |
| POST | /api/files/:id/quotation-draft | BUSINESS_READ_CAPABLE |  | api/routes/files.cjs:282 |
| GET | /api/files/:id/links | BUSINESS_READ_CAPABLE |  | api/routes/files.cjs:316 |
| POST | /api/files/:id/archive-preview | BUSINESS_READ_CAPABLE |  | api/routes/files.cjs:329 |
| GET | /api/files/:id/download | BUSINESS_READ_CAPABLE | inline | api/routes/files.cjs:411 |
| GET | /api/files/:id/content | BUSINESS_READ_CAPABLE |  | api/routes/files.cjs:429 |
| GET | /api/files/:id | BUSINESS_READ_CAPABLE |  | api/routes/files.cjs:441 |
| GET | /api/knowledge/overview | BUSINESS_READ_CAPABLE |  | api/routes/knowledge.cjs:83 |
| GET | /api/knowledge | BUSINESS_READ_CAPABLE | query, keyword, entryType, type, sourceTable, limit | api/routes/knowledge.cjs:92 |
| GET | /api/knowledge/sync-runs | BUSINESS_READ_CAPABLE | limit, status | api/routes/knowledge.cjs:108 |
| GET | /api/knowledge/health | BUSINESS_READ_CAPABLE |  | api/routes/knowledge.cjs:120 |
| GET | /api/knowledge/vector-health | BUSINESS_READ_CAPABLE |  | api/routes/knowledge.cjs:135 |
| GET | /api/knowledge/vector-sync-runs | BUSINESS_READ_CAPABLE | limit, status | api/routes/knowledge.cjs:148 |
| GET | /api/knowledge/retrieval-evaluation | BUSINESS_READ_CAPABLE |  | api/routes/knowledge.cjs:160 |
| GET | /api/knowledge/documents | BUSINESS_READ_CAPABLE |  | api/routes/knowledge.cjs:169 |
| GET | /api/knowledge/documents/:id/download | BUSINESS_READ_CAPABLE |  | api/routes/knowledge.cjs:211 |
| POST | /api/knowledge/sync-preview | BUSINESS_READ_CAPABLE |  | api/routes/knowledge.cjs:245 |
| GET | /api/knowledge/:id | BUSINESS_READ_CAPABLE |  | api/routes/knowledge.cjs:284 |
| GET | /api/business-changes | BUSINESS_READ_CAPABLE | semanticQuery, period, from, to, domain, entityType, entityId, eventType, keyword, beforeId, limit | api/routes/businessChanges.cjs:10 |
| POST | /api/entity-lookup | BUSINESS_READ_CAPABLE |  | api/routes/entityLookup.cjs:25 |
| POST | /api/entity-span-candidates | BUSINESS_READ_CAPABLE |  | api/routes/entitySpanCandidates.cjs:8 |
| GET | /mcp | TECHNICAL_OR_DISPATCH |  | api/routes/mcp.cjs:115 |
| GET | /api/ai/capabilities | TECHNICAL_OR_DISPATCH |  | api/routes/ai/chat.cjs:60 |
| GET | /api/ai/health | TECHNICAL_OR_DISPATCH |  | api/routes/ai/chat.cjs:68 |
| GET | /api/ai/conversations | TECHNICAL_OR_DISPATCH | limit | api/routes/ai/conversations.cjs:52 |
| GET | /api/ai/conversations/:id | TECHNICAL_OR_DISPATCH |  | api/routes/ai/conversations.cjs:75 |
| GET | /api/ai/evaluations/overview | TECHNICAL_OR_DISPATCH |  | api/routes/ai/evaluations.cjs:63 |
| GET | /api/ai/feedback | TECHNICAL_OR_DISPATCH | conversationId, status, rating, limit | api/routes/ai/feedback.cjs:55 |
| GET | /api/ai/learning-rules | TECHNICAL_OR_DISPATCH | status, effectiveStatus, domain, limit | api/routes/ai/feedback.cjs:146 |
| GET | /api/ai/system-prompt | TECHNICAL_OR_DISPATCH | includeMeta | api/routes/ai/prompt.cjs:22 |

## Appendix C — AI read Tools

| Tool | Domain | V5 declared route | Execution / answer | Required args | Executor |
|---|---|---|---|---|---|
| search_business_changes | business_history | business_history.read | NO | none declared | api/routes/ai/executors/queryExecutors.cjs:73 |
| get_management_action_center | management | management.read | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:647 |
| plan_factory_workflow | management | management.workflow.plan | NO | workflowType | api/routes/ai/executors/businessExecutors.cjs:664 |
| get_business_alerts | management | management.read | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:695 |
| get_dashboard_summary | management | management.read | NO | none declared | api/routes/ai/executors/queryExecutors.cjs:622 |
| get_order_readiness_overview | management | order.readiness.read | NO | none declared | api/routes/ai/executors/orderExecutors.cjs:398 |
| check_order_readiness | management | order.readiness.read | NO | none declared | api/routes/ai/executors/orderExecutors.cjs:375 |
| plan_order_readiness_actions | management | order.readiness.plan | NO | none declared | api/routes/ai/executors/orderExecutors.cjs:413 |
| search_factory_knowledge | knowledge | knowledge.read | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:759 |
| get_factory_knowledge_detail | knowledge | knowledge.read | NO | id | api/routes/ai/executors/businessExecutors.cjs:827 |
| get_factory_knowledge_health | knowledge | knowledge.read | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:848 |
| get_order_knowledge_package | knowledge | order.knowledge.read | NO | none declared | api/routes/ai/executors/orderExecutors.cjs:352 |
| get_data_quality_summary | quality | quality.read | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:439 |
| analyze_recipe_configuration | quality | quality.recipe.analyze | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:450 |
| get_factory_learning_health | quality | quality.read | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:496 |
| get_factory_rule_candidates | quality | quality.read | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:514 |
| get_factory_rule_impact | quality | quality.read | NO | candidateId | api/routes/ai/executors/businessExecutors.cjs:532 |
| get_factory_rule_compliance | quality | quality.read | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:550 |
| get_factory_rule_history | quality | quality.read | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:565 |
| get_order_detail | order | order.read | NO | none declared | api/routes/ai/executors/orderExecutors.cjs:314 |
| get_recent_orders | order | order.read | NO | none declared | api/routes/ai/executors/queryExecutors.cjs:236 |
| get_purchase_overview | order | purchase.read | NO | none declared | api/routes/ai/executors/orderExecutors.cjs:161 |
| build_order_draft | order | order.draft | NO | customerName, items | api/routes/ai/executors/businessExecutors.cjs:322 |
| search_quotations | quotation | quotation.read | NO | none declared | api/routes/ai/executors/queryExecutors.cjs:268 |
| get_quotation_detail | quotation | quotation.read | NO | quotationId | api/routes/ai/executors/queryExecutors.cjs:309 |
| search_customers | quotation | quotation.customer.read | NO | none declared | api/routes/ai/executors/queryExecutors.cjs:343 |
| inspect_quotation_file | quotation | quotation.file.inspect | NO | fileId | api/routes/ai/executors/businessExecutors.cjs:249 |
| build_quotation_draft | quotation | quotation.draft | NO | items | api/routes/ai/executors/businessExecutors.cjs:272 |
| search_customer_history | quotation | quotation.customer.read | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:341 |
| preview_recipe_cost | quotation | recipe.cost.preview | CERTIFIED_NARROW_FACT_ONLY | none declared | api/routes/ai/executors/businessExecutors.cjs:148 |
| explain_cost_change | quotation | quotation.cost.explain | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:422 |
| search_factory_file_archive_targets | file | file.search | NO | targetType | api/routes/ai/executors/businessExecutors.cjs:706 |
| search_templates | recipe | recipe.template.read | NO | none declared | api/routes/ai/executors/queryExecutors.cjs:378 |
| get_template_detail | recipe | recipe.template.read | NO | none declared | api/routes/ai/executors/queryExecutors.cjs:414 |
| get_all_recipes | recipe | recipe.read | NO | none declared | api/routes/ai/executors/queryExecutors.cjs:150 |
| get_recipe_detail | recipe | recipe.read | NO | none declared | api/routes/ai/executors/queryExecutors.cjs:176 |
| get_recipe_technical_files | recipe | recipe.files.read | NO | none declared | api/routes/ai/executors/queryExecutors.cjs:213 |
| build_recipe_bom_draft | recipe | recipe.cost.preview | NO | none declared | api/routes/ai/executors/businessExecutors.cjs:114 |
| preview_pump_shell_cost | recipe | recipe.cost.preview | NO | customBarrelLength | api/routes/ai/executors/businessExecutors.cjs:196 |
| compare_recipes | recipe | recipe.cost.preview | NO | recipe1, recipe2 | api/routes/ai/executors/recipeExecutors.cjs:733 |
| full_calculate | cost | cost.calculate | NO | none declared | api/routes/ai/executors/costExecutors.cjs:52 |
| dynamic_config_cost | cost | cost.calculate | NO | none declared | api/routes/ai/executors/costExecutors.cjs:108 |
| calculate_coil_cost | cost | coil.cost | NO | spec, sheets | api/routes/ai/executors/costExecutors.cjs:62 |
| get_copper_price | cost | coil.cost | NO | none declared | api/routes/ai/executors/costExecutors.cjs:57 |
| get_coil_specs | coil | coil.read | NO | none declared | api/routes/ai/executors/queryExecutors.cjs:100 |
| search_coils | coil | coil.read | CERTIFIED_NARROW_FACT_ONLY | none declared | api/routes/ai/executors/queryExecutors.cjs:105 |
| search_parts | catalog | inventory.read | CERTIFIED_NARROW_FACT_ONLY | none declared | api/routes/ai/executors/queryExecutors.cjs:521 |
| get_rotor_drawing_history | drawing | drawing.read | NO | none declared | api/routes/ai/executors/costExecutors.cjs:214 |

STOP — WAIT FOR SUPERVISOR REVIEW. Do not begin P16-L or resume P17.
