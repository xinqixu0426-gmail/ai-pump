# P17-A — V5 Write Migration Boundary & Contract Freeze

## 1. Executive result / scope

Status: PASS（静态审计与未来契约冻结）。P17_B_READY=NO：尚没有一个完整满足本报告执行 gate 的已认证低风险写 cohort。不是已有写能力故障修复，也不是写执行批准。

基线 `ad86279d2395c7d3276c69b7619d59665c6b49aa`，master。盘点对象为**当前本地实现**，不是把 Legacy 生产旧 revision 当作相同代码。用户既有 V4、文档与测试脏改动保留；伴随 JSON 记录所读源文件 hash。未读取生产业务值、未调用生产 API、未重启或配置生产服务。P16-J 已完成的 owner-read 状态不受本阶段影响。

交付：本报告（未来规范）、[逐操作元数据清单](../data/p17a-write-boundary-inventory.json)、只读生成器 `scripts/audit-v5-write-boundary.cjs`。不新增 HTTP/Tool/schema 实现，不修改现行 API 权威章节或 P16 合同。下述未来状态机不是修改既有 taskState。

## 2. Current mutation inventory and counting rules

- 90 个 canonical 正式写 capability，16 个 registry domain。
- 89 个主 HTTP mutation endpoint，加 2 个真实兼容写入口 = **91 个 mutation API**。
- 1 个内部正式命令：`quotations.expire_overdue`，不算 HTTP API。
- **29 个 AI write Tool**，依据当前 registry 与 AI_TOOLS 实际交集校验，不采用历史 77 等总工具数。
- `/api/ai/chat`、`/api/ai/confirm-tool`、MCP `tools/call` 是已有能力的调度/审批入口，不再重复计为新的业务动作。MCP DELETE 会话清理、auth login/logout 不是业务 mutation API。
- 所有非 GET route 都被生成器列出；cost/preview/draft、只读 entity lookup/span supply、template apply、rotor chat preview、connectivity test 不因 POST 就算业务写入。Preview 签发内存 token 不代表持久化业务 mutation。

90 个动作逐项 risk、entity、route、service、参数契约指针、确认声明/入口证据、幂等、前置条件、回读和恢复分类见 Appendix A 与 JSON。Tool 的 required 参数逐项见 Appendix B。业务端没有统一机器 schema，实际必填/互斥/条件必填由对应 service validator 分支决定：JSON 的 `serviceReferencedInputFields` 是代码引用字段索引，**不是把文件中所有字段宣称为该动作必填**。`bodyValidatorFunctions` 与 `routeCommandFunctions` 给出精确校验权威位置，不能据此直接生成一个通用 executable args 对象。

两个不能混同正式安全入口的兼容 API：

| API | 正式能力 | 实际差异 |
|---|---|---|
| POST /api/coils/:id/stock-adjustment | inventory.coils.adjust_stock | 直接 executeCoilStockBatch；不消费正式 Preview confirmationToken；expectedUpdatedAt 可缺省 |
| POST /api/orders/:id/purchase-items/toggle | purchasing.order.item_progress | buildLegacyPurchaseItemToggleInput 兼容输入；结果转为 order，不能假定完整 command receipt 下发 |

未来 V5 不可选这些路径绕过正式审批/回执要求。

### Supplemental internal side-effect surface（不重复计为 90 个用户业务动作）

| Surface / code authority | Consequence | Frozen risk / future disposition |
|---|---|---|
| api.cjs / quotationExpiry maintenance | 报价自动过期，复用已计数正式命令 | HIGH；不是聊天可调用 capability |
| api.cjs / market sync scheduling | 更新市场指标，复用 market 命令 | HIGH；不得作为 owner write cohort |
| api/db.cjs startup migrations/checkpoint/backup scheduling | schema、DB 文件与备份生命周期 | HIGH；基础设施运维，禁止 proposal 驱动 |
| safeInsert/safeUpdate → notifyKnowledgeSourceChange；commandExecution → requestAutoKnowledgeSync | 命令后触发知识投影/队列；不与业务事务等同 | MEDIUM；必须测量并与正式事实区分 |
| api.cjs → managementActionLifecycle monitor | 派生管理状态复查 | MEDIUM；不得把同步业务回滚称为所有派生效果也已回滚 |
| rotorExternalCommands / worker / printer | 文件与物理设备副作用 | HIGH；90 表已计 draw/print；初期禁止 |
| runtime settings / factory profile / quality rules | runtime 配置、规则、派生状态 | HIGH；不作为“简单文字编辑”降级 |
| MCP service identity + global write gate + per-tool allowlist | 调用已有正式 write Tool | HIGH dispatch boundary；绝非 stable owner 授权 |

未把技术日志、缓存、备份等无稳定业务 operation 的写入伪装成已具有 idempotency/precondition 的正式能力；这些补充入口一律不在未来初期 V5 allowlist。

## 3. Risk taxonomy（未来准入分类，不改变现有 registry）

每 canonical operation 恰好一个类别，风险覆盖该 API 的**整个可变字段范围**，不是挑一条低风险示例。

- LOW：2。图纸历史 display-name / linkedPumpModel 元数据赋值，可通过正式更新入口恢复先前业务字段；不包含图纸文件、生成、打印。
- MEDIUM：26。普通客户字段、仅草稿记录、文档上传/解析、AI 技术记录等；需要事务、严格审批与上下文边界，绝非无需审批。
- HIGH：62。所有删除、库存、价格/成本、订单状态、BOM/配方/模板/型号配置、bulk、规则/运行配置或外部副作用。包括 registry 旧标记 medium 但完整 API 可改价格的 parts.create/update，也包括 soft delete。

风险是保守的后果分类，不按名称猜测执行意图。实际 mutation 字段仍只能由正式 schema/service 定义。

## 4. Actual authority, confirmation and transaction findings

现有 `api.cjs` 普通 Business API 使用 JWT 或 INTERNAL_SECRET；AI route 自行鉴权。它们**不要求 exact dedicated owner**。`commandActorKey` 使用内部凭据 fingerprint 或 session JWT fingerprint，role fallback 也存在；这不是未来稳定 owner principal。P17 不修改现行认证。

`commandExecution.executePersistentCommand` 在 SQLite `transaction.immediate()` 内完成 operation key 查询、业务 callback、强审计与 business-change receipt；失败回滚 DB 事务。所有 90 个 canonical capability 都可追踪至使用 persistent-command primitive 的命令模块。声明与实现的不同层不可混淆：registry requiresConfirmation=true 不等于 HTTP 中间件消费了确认 token。

`businessConfirmation` 与 `aiToolConfirmation`：32-byte 随机 token、绑定参数 hash/subject/capability、默认 5 分钟、最多 15 分钟、内存最多 2000 条。AI token 有 pending/executing/completed/failed；Business token 绑定一个 idempotencyKey，但相同 key 可取回快照，实际副作用去重依赖业务 operation。重启会丢失未完成 token；不是 durable V5 approval ledger。

`internalApiClient` retries=0，通过 INTERNAL_SECRET 调用正式 API，传 X-Operation-ID。`createChildOperationFetch` 生成新 UUID：未来 composite write 不能靠重新生成 child IDs 达到幂等，初期单 proposal 只允许一个 mutation attempt。

现有 `executor` allowWrite 默认 false，但 Legacy 的 !allowWrite 分支可能执行正式只读 preflight 并签发确认。未来 V5 proposal builder 不可通过调用 Legacy executor 来“借用开关”，更不能把 Legacy confirmation subject 当 owner approval。

## 5. Frozen proposal contract — version 1（非执行规范）

```ts
type WriteRisk = 'LOW' | 'MEDIUM' | 'HIGH';
interface V5WriteProposalV1<C extends ApprovedWriteContract> {
  version: 1;
  proposalId: OpaqueProposalId;
  requestId: OpaqueRequestId;
  taskId: OpaqueTaskId;
  ownerPrincipalRef: ServerOwnedOpaquePrincipalRef;
  contractRef: C['id'];
  contractVersion: C['version'];
  capabilityId: C['capabilityId'];
  operation: C['operation'];
  entityType: C['entityType'];
  target: AuthoritativeCanonicalReference;
  proposedArguments: C['boundedArgumentSchema'];
  argumentsDigest: ServerCanonicalDigest;
  currentStateRef: AuthoritativeSnapshotReference;
  expectedState: C['preconditionSchema'];
  evidenceRefs: NonEmptyBoundedEvidenceRefs;
  riskClass: WriteRisk;
  createdAt: ServerTimestamp;
  expiresAt: ServerTimestamp;
  status: WriteProposalStatus;
  executionEligibility: { allowed: false; reasonCodes: SafeReasonCode[] };
  auditCorrelationId: OpaqueAuditCorrelationId;
}
```

类型为规范 pseudocode，**不是现已可执行 TypeScript**。P17-A 的 ApprovedWriteContract execution allowlist 为空；KnownCapability、ProposalAllowed、ExecutionAllowed 是三道独立 gate。后续每个 C 必须冻结精确 required/optional fields、类型、大小、范围、禁用字段与 formal endpoint；不得使用 Record<string,unknown>、SQL、URL、Tool 自由字符串作为 payload。初期最多一个 existing canonical target、一个 mutation，不接受 bulk 或多 operation。create 的“尚不存在 identity”须使用正式 absence predicate，不能制造 canonicalId。

proposal 创建/展示/拒绝/过期/批准均**不执行 Business mutation，不启用 allowWrite**。创建阶段只准正式 read/preview；proposal/audit 控制记录与业务实体变更严格分离，未来若要持久化需另行批准，P17-A 不建表。

业务字段与 canonical identity 只存在受控业务/提案存储和内存；不是 metadata。Phoenix 只允许 proposal/task/request opaque refs、类别、状态、时序、数量，不记录 payload、snapshot、raw mention、canonical ID、secret 或可逆内容摘要。

## 6. Frozen owner approval contract

```ts
interface V5WriteApprovalV1 {
  version: 1;
  approvalId: OpaqueApprovalId;
  proposalId: OpaqueProposalId;
  ownerPrincipalRef: ServerOwnedOpaquePrincipalRef;
  decision: 'APPROVE' | 'REJECT';
  proposalDigest: ServerCanonicalDigest;
  approvedAt: ServerTimestamp;
  expiresAt: ServerTimestamp;
  consumption: 'UNUSED' | 'CONSUMED';
}
```

创建与审批、执行前均重新 `verifyAuthentication → isAuthenticatedOwner === true`，绑定稳定 subject；role=admin、session 广泛授权、header、IP 都不能替代。token/credential 不成为 principalRef 的公开值。

显式 UI/action 必须提交 proposalId + 服务端签发的一次性批准凭证；服务端读取已冻结对象，核验 exact digest（包含 owner、target、capability、operation、schema version、规范化 arguments、precondition、risk、expiry）。客户端不能重传新 args 改变批准内容。孤立“是”、自然语言确认、blanket approval 均不可执行。

默认 proposal 与 approval 最长 5 分钟，approval 不得延长 proposal；时间来自服务端。批准后不可编辑；任何变更/过期/stale 都需新 proposal + 新批准。即使同字段相同值也不得把旧授权转移到不同实体/operation。执行 reservation 原子消费授权；进程崩溃不得把 consumed 变回 unused。

## 7. TOCTOU / precondition freeze

读到 A 后再发 mutation 不是 CAS。**最终 precondition 验证必须位于持有业务写锁的同一正式 command 事务内**，覆盖所有会影响本次语义的目标、依赖记录、absence 状态和 operation-specific predicate。

代码现状：resourceVersion 只比较字符串 updated_at，missing 直接 return；safeUpdate 写 `new Date().toISOString()`，不保证单调唯一，不能排除同毫秒覆盖或 ABA。外层读取/哈希无法修补内层只比弱时间戳的问题。不得猜想 expectedUpdatedAt 已经相当于无漏洞版本号。

严格证明的窄 predicate 2 个：

1. parts.batch_create：确认 input 固定；IMMEDIATE 事务内对完整 model+supplier 检查 active identity 不存在；可证明该 absence predicate，不代表价格/其它业务创建依赖都被 CAS 覆盖。bulk HIGH，初期禁止。
2. ai.factory_profile.update：当提供 expectedVersion 时在事务内读取 persisted profile 并比内容 SHA256；仅证明 profile 内容 predicate。缺省仍兼容跳过；其 GET snapshot 有进程内 cache，不能当跨进程 post-write 真相；影响 AI 规则，初期禁止。

其余 88 个为部分/缺失强前置证明；并非 88 个完全没有检查。JSON 保留原 concurrencyControl 与 service。files.archive、orderReadiness 等有 live snapshot hash，是正向基础设施；没有把有限 hash 字段覆盖提升为完整跨资源 ABA/影响域证明。

未来 contract 若不能给出可靠 revision 或事务内 exact approved-field/dependency snapshot comparison，该 C.executionAllowed=false。missing/stale → STALE/REJECTED，mutation=0；禁止用“最新值覆盖”或自动重新审批。

## 8. Idempotency / exactly-once boundary

90/90 有持久化幂等基础：actor+capability+key+canonical request hash，90 天记录。相同 key/hash 返回 receipt；不同 hash 冲突。普通未提供 key 生成 request-scoped key并警告，**跨 HTTP 重试不受保护**。不能把 API 是 PATCH 或赋值操作就标成天然 IDEMPOTENT；审计、副作用与 state toggle 也会重复。

因此逐操作状态为 IDEMPOTENCY_SUPPORTED（条件支持），不是无条件 exactly-once。需新建 Business API 幂等基础层=0；但未来 V5 必须具备**持久化 approval consumption + mutation reservation + stable business key/actor continuity**，目前没有。session/JWT 更新不得让同一 execution 换 actor 逃出去重；不能传一个客户端 owner header 冒充主体。

未来每批准对象最多一次 mutation dispatch，retry=0；timeout/断线/进程退出 = outcome unknown，不是“未写入”。转 RECONCILIATION_REQUIRED，只做正式 operation 查询 + read verification；禁止以新 key 重发。重放授权过期后仍只允许读 receipt，不重新执行。operation key保留期结束也不能让已消费 proposal 被重放。

外部 draw/print/parse 使用 begin/update persistent external operation，能去重受理，不证明物理副作用 exactly-once。必须区分 accepted 与 completed；打印纸张不可逆。初期全部禁止。

## 9. Post-write verification

64 个动作有正式 DB 资源/记录的回读基础；26 个不能据现有入口证明完整结果（删除/tombstone/文件清理、外部效果、波动指标、masked/cache 配置或复合技术记录）。这不是 64 个已通过 V5 verification；本阶段没有写测试，也没有新增 validator。

每个未来 C 必须明确：exact target read endpoint、same entity/operation correlation、expected changed fields、unchanged protected fields、dependency invariants、null/unit/type、result version；执行 receipt 的 operation/capability/audit/target 与批准一致后，独立正式 Query 比对。不能只看 HTTP200、receipt.status 或 model explanation。GET list 需按 canonical identity 唯一匹配并证明完整性；不能 first result 或 capped list 的缺席推导删除。

没有可验证 postcondition → NOT_SAFE_FOR_V5_YET。执行已提交但验证错 → VERIFICATION_FAILED，不宣称未执行或成功，不自动重写。证据语义必须在以后独立 write evidence contract 批准，不修改 P16 read Ledger。

## 10. Rollback vs compensation

DB transaction exception rollback 只保护未提交事务，不是用户请求级撤销。

- 3 个窄业务字段 inverse primitive：customers.update、rotor.rename_history、rotor.link_history。可以通过同正式 API恢复旧字段，保留新增 audit/version/history；必须捕获 before-image、确认无新并发变化并重新审批。**不是当前已认证自动 rollback**，不允许恢复所有 DB 字节/删 audit。
- 3 个 compensation primitive：coil stock 反向 movement、rule review/restore 的正式恢复事件。只修正业务状态，不抹除原 movement/history，不保证恢复后续受影响业务；必须重新批准并通过 stock/status 规则。
- 84 个没有被本审计证明覆盖全部副作用的安全恢复链；即使有 delete/create/update API，也不能假设能撤销已消费库存、订单历史、文件、打印或派生变化。

backup restore 不属于 ordinary per-request rollback。补偿不能自动执行：COMPENSATION_REQUIRED → 新的有界补偿 proposal/approval → 验证成功才 COMPENSATED。无法补偿保持人工处理状态，禁止“补偿成功”猜测。

## 11. Audit contract

未来 append-only control audit 必含 proposalId、approvalId、opaque owner reference/class、capability/operation、private authoritative target reference、contract version/digest、precondition result、executionId/key reference、dispatch/outcome、verification、compensation reference/result、server timestamps、request/task/audit correlation。状态变化由软件记录；失败、未知、过期也要留下可关联记录。

不能将 api_operations 的 90 天 receipt缓存或内存 token Map当永久 immutable approval audit。现有 audit_log 有保留/清理政策，business_change_events 是业务历史，两者不能替代 durable approval consumption。业务 before/after 值仅按现有审计策略写业务审计；OTel/Phoenix/日志只保留安全元数据。credential fingerprint 不应成为可外发 owner ID。错误不得夹带参数/SQL/正文。

## 12. Frozen deterministic state machine

这是独立未来 write-control 状态，P16 task machine 不变。

| From | Allowed next / condition |
|---|---|
| PROPOSED | AWAITING_APPROVAL（合法 owner + 完整约束）；REJECTED；EXPIRED |
| AWAITING_APPROVAL | APPROVED（exact bound explicit approval）；REJECTED；EXPIRED；STALE |
| APPROVED | EXECUTING（重新 owner + 原子授权消费 + 事务内 precondition）；STALE；EXPIRED；REJECTED |
| EXECUTING | EXECUTED_UNVERIFIED（权威提交回执）；EXECUTION_FAILED（证明未提交）；RECONCILIATION_REQUIRED（超时/未知） |
| RECONCILIATION_REQUIRED | EXECUTED_UNVERIFIED（正式 operation确认已提交）；EXECUTION_FAILED（证明未提交）；保持待核对 |
| EXECUTED_UNVERIFIED | VERIFIED_SUCCESS；VERIFICATION_FAILED |
| VERIFICATION_FAILED | COMPENSATION_REQUIRED（可修正）；保持待人工核对 |
| COMPENSATION_REQUIRED | COMPENSATED（独立批准补偿且权威验证通过）；保持待人工核对 |
| VERIFIED_SUCCESS / COMPENSATED / EXECUTION_FAILED / STALE / REJECTED / EXPIRED | terminal；无回到 APPROVED/EXECUTING 的边 |

非法边 fail closed。EXPIRED 不得撤销已发出的业务 mutation；不得用 REJECTED 覆盖未知结果。model不决定任何状态跃迁。Exactly-once reservation 与事务/网络故障需独立 fixture证明。

## 13. First cohort recommendation / readiness

**当前可执行 cohort：空。** P17_B_READY=NO。

首选下一轮窄 proposal-only / prerequisite cohort：`drawings.rotor.rename_history` 一项，限定 existing historyId + 规范化 drawingName。真实正式 normalizer 会替换文件名非法字符、折叠空白、最多80字符；必须先正式规范化再展示和批准，批准后不能再悄悄改变参数。只改 drawing_name、不生成/删除/打印文件。缺口：强 CAS、durable owner-bound reservation、canonical history targeting 与正式 reread validator/compensation认证。该动作当前无 AI write Tool，不能借相邻 generate/print Tool代替；若未来需要 adapter/schema，必须单独批准。

第二候选（不自动进入同阶段）：customers.update 的 remark-only子契约。原 API可改名字、联系信息、利润率，不能批准整个 API来冒充低风险备注修改；需字段 allowlist与强CAS。P17-A 不新增它。

明确 deferred：所有 medium 技术/草稿动作、其余普通 master-data操作，因同一前置/审批/验证缺口不准执行。初期禁止：全部 HIGH、bulk、price/cost、stock、order state/inbound、recipe/BOM/template、delete、配置/规则、CAD/打印/文件破坏和内部maintenance。Appendix A 每行 initialV5ExecutionEligible=false，覆盖无遗漏。

## 14. Future fixture certification harness

只在后续批准的隔离 DB/file/device fake fixtures 进行，绝不写生产再撤销。测试分层必须包括：

1. proposal-only：所有业务 API/Tool/allowWrite spy计数0；schema required/unknown/type/bounds 与正式normalizer一致。
2. approval：owner稳定主体；sharedadmin/nonowner/伪造header/JWT拒绝；exact proposalId、args digest、entity、operation、expiry绑定；孤立 yes/session grant拒绝。
3. precondition：变更前后、same-millisecond、ABA、依赖变化、absence被创建、读后写前并发；锁内拒绝且mutation0。
4. tamper：字段、canonicalId、contractVersion、unit、op、owner或expectedState替换；全部拒绝。
5. expiry/duplicate：并发双approve/doubleclick、同key同hash、同key异hash、换key复用approval、换session/重启、receipt保留期后；至多一次dispatch。
6. failure：事务中途异常/强审计失败回滚；网络断开于commit前后；进程崩溃；unknown不能自动重试或fallback Legacy重做同一写。
7. verification：假成功回执、wrong target/op/audit、回读差异、protected field变动、missing/tombstone/外部accepted；不得误报成功。
8. recovery：inverse字段恢复、新并发写时补偿拒绝、业务规则不允许反向movement、补偿失败与人工处理；不能恢复备份或擦audit。
9. privacy：payload/values/credentials不进入trace/log/report/error；同任务/主体/approval跨请求隔离。
10. read non-regression：P16 owner read全链保持原flag/runtime/behavior；write gate始终独立默认OFF；非owner无写准入。

## 15. Safety / validation / freeze

静态生成器仅导入纯 registry 与 Tool schema；不导入 service、route、DB、executor，不读 `.env`，不发网络请求，不执行 SQL。检查90个capability有实际route/internaltrigger和command源码、29 Tool schema齐全、risk恰好一次、兼容路径真实存在。逐源hash冻结清单；运行两次仅比较结构输出，不是mutation测试。

V5 Writes=0；allowWrite enabling calls=0；Business Mutation Calls from V5=0；Production Business Mutation Tests=0；Executable V5 Write Tools=0；Production Business Data Modified=NO；P16 Owner Read Production State Changed=NO。没有P17可执行代码、部署、模型调用或生产重启。

唯一准入阻断：**推荐最小 cohort 尚缺事务内强前置比较与持久化 owner-bound approval/dispatch契约的实现认证，且无已认证 write postcondition/recovery adapter**。现有90个幂等基础不等价于该完整gate。P17-A audit PASS不授权进入P17-B执行或扩大P16。

## Appendix A — Canonical operation matrix

Counts are canonical operations, not Tool aliases. Reread availability is not an implemented post-write verifier. Full argument validators and route locations are indexed in the JSON companion.

| Capability | API / trigger | Risk | Precondition | Verification | Recovery | Source |
|---|---|---|---|---|---|---|
| inventory.parts.batch_adjust_stock | POST /api/parts/batch-stock | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/inventoryCommands.cjs:20 |
| inventory.coils.adjust_stock | POST /api/coils/stock-adjustments | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | COMPENSATION_ONLY_REQUIRES_NEW_APPROVAL | api/services/inventoryCommands.cjs:23 |
| workflow.quotation.convert_to_order | POST /api/quotations/:id/convert | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/quotationConversion.cjs:27 |
| customers.create | POST /api/customers | MEDIUM | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/customerCommands.cjs:16 |
| customers.update | PATCH /api/customers/:id | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | EXACT_BUSINESS_FIELDS_WITH_FRESH_APPROVAL_NOT_HISTORY_ERASURE | api/services/customerCommands.cjs:17 |
| customers.delete | DELETE /api/customers/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/customerCommands.cjs:18 |
| parts.create | POST /api/parts | HIGH | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/partCommands.cjs:29 |
| parts.batch_create | POST /api/parts/batch-create | HIGH | ABSENCE_OF_EXACT_MODEL_SUPPLIER_INSIDE_IMMEDIATE_TRANSACTION | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/partCommands.cjs:31 |
| parts.update | PATCH /api/parts/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/partCommands.cjs:33 |
| parts.delete | DELETE /api/parts/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/partCommands.cjs:37 |
| parts.save_profile | POST /api/parts/:id/save | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/partCommands.cjs:35 |
| parts.batch_delete | POST /api/parts/batch-delete | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/partCommands.cjs:39 |
| parts.batch_update_prices | PATCH /api/parts/prices | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/partCommands.cjs:42 |
| coils.create | POST /api/coils | HIGH | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/coilCommands.cjs:32 |
| coils.update | PATCH /api/coils/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/coilCommands.cjs:33 |
| coils.delete | DELETE /api/coils/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/coilCommands.cjs:34 |
| coils.batch_update_unit_price | PATCH /api/coils/spec/:spec | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/coilCommands.cjs:36 |
| templates.create | POST /api/templates | HIGH | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/templateCommands.cjs:22 |
| templates.update | PATCH /api/templates/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/templateCommands.cjs:23 |
| templates.delete | DELETE /api/templates/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/templateCommands.cjs:24 |
| model_variants.create | POST /api/model-variants | HIGH | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/modelVariantCommands.cjs:20 |
| model_variants.update | PATCH /api/model-variants/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/modelVariantCommands.cjs:23 |
| model_variants.delete | DELETE /api/model-variants/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/modelVariantCommands.cjs:26 |
| settings.update_business_value | PUT /api/settings/:key | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/businessSettingCommands.cjs:17 |
| settings.update_runtime | PUT /api/settings/runtime | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/runtimeSettingCommands.cjs:20 |
| market.sync_copper_price | POST /api/copper-price/update | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/marketIndicatorCommands.cjs:11 |
| market.sync_indicators | POST /api/market-indicators/update | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/marketIndicatorCommands.cjs:14 |
| orders.requirements.save_draft | PUT /api/orders/:id/requirements/draft | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderRequirementCommands.cjs:20 |
| orders.requirements.confirm | POST /api/orders/:id/requirements/confirm | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderRequirementCommands.cjs:22 |
| orders.requirements.revoke | POST /api/orders/:id/requirements/revoke | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderRequirementCommands.cjs:24 |
| orders.execution_records.create_draft | POST /api/orders/:id/execution-records | MEDIUM | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderExecutionRecordCommands.cjs:21 |
| orders.execution_records.update_draft | PUT /api/orders/:id/execution-records/:recordId/draft | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderExecutionRecordCommands.cjs:23 |
| orders.execution_records.confirm | POST /api/orders/:id/execution-records/:recordId/confirm | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderExecutionRecordCommands.cjs:25 |
| orders.execution_records.revoke | POST /api/orders/:id/execution-records/:recordId/revoke | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderExecutionRecordCommands.cjs:27 |
| orders.execution_records.delete | DELETE /api/orders/:id/execution-records/:recordId | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderExecutionRecordCommands.cjs:29 |
| quotations.create | POST /api/quotations | HIGH | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/quotationCommands.cjs:22 |
| quotations.update | PATCH /api/quotations/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/quotationCommands.cjs:23 |
| quotations.change_status | POST /api/quotations/:id/status | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/quotationCommands.cjs:25 |
| quotations.delete | DELETE /api/quotations/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/quotationCommands.cjs:27 |
| quotations.expire_overdue | INTERNAL INTERNAL quotation-expiry scheduler | HIGH | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/quotationExpiry.cjs:12 |
| purchasing.order.item_progress | POST /api/orders/:id/purchase-items/progress | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/purchasingItemProgress.cjs:36 |
| purchasing.task.batch_order | POST /api/orders/purchase-items/batch | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/purchasingBatchOrder.cjs:26 |
| purchasing.order.complete_inbound | POST /api/orders/:id/complete-purchase | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/purchasingInbound.cjs:33 |
| orders.create | POST /api/orders | HIGH | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderCommands.cjs:44 |
| orders.change_status | POST /api/orders/:id/status | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderCommands.cjs:45 |
| orders.execute_readiness_action | POST /api/orders/:id/readiness-actions/:actionId | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderReadinessCommands.cjs:23 |
| orders.todos.toggle | POST /api/orders/:id/todos/toggle | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderTodoCommands.cjs:13 |
| orders.update_draft | PATCH /api/orders/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderCommands.cjs:46 |
| orders.delete | DELETE /api/orders/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/orderCommands.cjs:47 |
| recipes.create | POST /api/recipes | HIGH | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/recipeCommands.cjs:35 |
| recipes.update | PATCH /api/recipes/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/recipeCommands.cjs:36 |
| recipes.delete | DELETE /api/recipes/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/recipeCommands.cjs:37 |
| recipes.technical_files.upload | POST /api/recipes/:id/technical-files | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/recipeTechnicalFiles.cjs:15 |
| recipes.technical_files.delete | DELETE /api/recipes/:id/technical-files/:fileId | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/recipeTechnicalFiles.cjs:18 |
| drawings.rotor.save_parameters | POST /api/rotor/save | MEDIUM | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/rotorCommands.cjs:21 |
| drawings.rotor.rename_history | PATCH /api/rotor/history/:id/name | LOW | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | EXACT_BUSINESS_FIELDS_WITH_FRESH_APPROVAL_NOT_HISTORY_ERASURE | api/services/rotorCommands.cjs:24 |
| drawings.rotor.link_history | PATCH /api/rotor/history/:id/link | LOW | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | EXACT_BUSINESS_FIELDS_WITH_FRESH_APPROVAL_NOT_HISTORY_ERASURE | api/services/rotorCommands.cjs:27 |
| drawings.rotor.delete_history | DELETE /api/rotor/history/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/rotorCommands.cjs:30 |
| drawings.rotor.generate_pdf | POST /api/rotor/draw | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/rotorExternalCommands.cjs:24 |
| drawings.rotor.print_pdf | POST /api/rotor/print/:jobId | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/rotorExternalCommands.cjs:27 |
| knowledge.sync_derived | POST /api/knowledge/sync | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/knowledgeSyncCommand.cjs:22 |
| knowledge.documents.upload | POST /api/knowledge/documents | MEDIUM | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/knowledgeDocuments.cjs:16 |
| knowledge.documents.delete | DELETE /api/knowledge/documents/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/knowledgeDocuments.cjs:19 |
| files.upload | POST /api/files | MEDIUM | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/factoryFileLifecycleCommands.cjs:30 |
| files.upload_business_attachment | POST /api/files/business-attachment | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/factoryFileLifecycleCommands.cjs:34 |
| files.parse | POST /api/files/:id/parse | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/factoryFileLifecycleCommands.cjs:31 |
| files.delete | DELETE /api/files/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/factoryFileLifecycleCommands.cjs:32 |
| ai.conversations.create | POST /api/ai/conversations | MEDIUM | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiConversationCommands.cjs:18 |
| ai.conversations.messages.append | POST /api/ai/conversations/:id/messages | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiConversationCommands.cjs:21 |
| ai.conversations.messages.update_metadata | PATCH /api/ai/conversations/:id/messages/:messageId | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiConversationCommands.cjs:24 |
| ai.conversations.delete | DELETE /api/ai/conversations/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiConversationCommands.cjs:27 |
| ai.evaluations.runs.start | POST /api/ai/evaluations/runs | MEDIUM | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiEvaluationCommands.cjs:22 |
| ai.evaluations.results.record | POST /api/ai/evaluations/runs/:id/results | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiEvaluationCommands.cjs:25 |
| ai.evaluations.runs.complete | POST /api/ai/evaluations/runs/:id/complete | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiEvaluationCommands.cjs:28 |
| ai.evaluations.cases.review | PATCH /api/ai/evaluations/cases/:id | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiEvaluationCommands.cjs:31 |
| ai.evaluations.system_cases.configure | PATCH /api/ai/evaluations/system-cases/:id | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiEvaluationCommands.cjs:34 |
| ai.feedback.submit | POST /api/ai/feedback | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiFeedbackCommands.cjs:19 |
| ai.feedback.diagnose | POST /api/ai/feedback/:id/diagnose | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiFeedbackCommands.cjs:22 |
| ai.feedback.retest | POST /api/ai/feedback/:id/retest | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiFeedbackCommands.cjs:25 |
| ai.feedback.review | PATCH /api/ai/feedback/:id | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiFeedbackCommands.cjs:28 |
| ai.learning_rules.update | PATCH /api/ai/learning-rules/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/aiFeedbackCommands.cjs:31 |
| ai.factory_profile.update | PUT /api/ai/system-prompt | HIGH | PERSISTED_PROFILE_CONTENT_SHA256_INSIDE_TRANSACTION_WHEN_VERSION_PROVIDED | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/factoryProfileService.cjs:10 |
| quality.recipe_feedback.save | POST /api/quality/recipes/:recipeId/feedback | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/qualityRuleCommands.cjs:22 |
| quality.recipe_feedback.resolve | POST /api/quality/recipe-feedback/:id/resolve | MEDIUM | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/qualityRuleCommands.cjs:25 |
| quality.rule_candidates.refresh | POST /api/quality/rule-candidates/refresh | MEDIUM | NO_PROPOSAL_STALE_STATE_GUARD | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/qualityRuleCommands.cjs:28 |
| quality.rule_candidates.review | PATCH /api/quality/rule-candidates/:id | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | COMPENSATION_ONLY_REQUIRES_NEW_APPROVAL | api/services/qualityRuleCommands.cjs:31 |
| quality.rule_events.restore | POST /api/quality/rule-events/:id/restore | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | COMPENSATION_ONLY_REQUIRES_NEW_APPROVAL | api/services/qualityRuleCommands.cjs:34 |
| workbench.execution_runs.record | POST /api/workbench/execution-runs | MEDIUM | NO_PROPOSAL_STALE_STATE_GUARD | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/factoryWorkflowCommands.cjs:9 |
| files.archive | POST /api/files/:id/archive | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | AUTHORITATIVE_DB_RESOURCE_REREAD_AVAILABLE_NOT_YET_V5_VERIFIED | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/factoryFileCommands.cjs:19 |
| files.links.delete | DELETE /api/files/:id/links/:linkId | HIGH | EXISTING_PARTIAL_GUARD_NOT_FULL_V5_CAS_PROOF | INDIRECT_OR_INCOMPLETE | NO_PROVEN_COMPLETE_SAFE_RECOVERY | api/services/factoryFileCommands.cjs:21 |

## Appendix B — AI write Tool projection

| Tool | Formal capabilities | Required schema fields | Executor | Risk |
|---|---|---|---|---|
| execute_order_readiness_action | orders.execute_readiness_action, workbench.execution_runs.record | orderId, actionId | order | HIGH |
| execute_factory_workflow_step | workflow.quotation.convert_to_order, workbench.execution_runs.record | workflowType, quotationId, actionId | business | HIGH |
| sync_factory_knowledge | knowledge.sync_derived | (none declared; semantic validator still applies) | business | HIGH |
| set_recipe_analysis_feedback | quality.recipe_feedback.save | recipeId, findingKey, findingType, decision | business | MEDIUM |
| refresh_factory_rule_candidates | quality.rule_candidates.refresh | (none declared; semantic validator still applies) | business | MEDIUM |
| review_factory_rule_candidate | quality.rule_candidates.review | candidateId, status | business | HIGH |
| restore_factory_rule_event | quality.rule_events.restore | eventId | business | HIGH |
| generate_purchase_list | orders.update_draft | orderId, reason | order | HIGH |
| save_order_requirement_draft | orders.requirements.save_draft | orderId, summaryText | order | MEDIUM |
| save_order_execution_draft | orders.execution_records.create_draft | orderId, phase, recordType, summaryText | order | MEDIUM |
| create_order | orders.create | customerName | order | HIGH |
| update_order_status | orders.change_status | orderId, status | order | HIGH |
| add_recipe_to_order | orders.update_draft | orderId, recipeName, qty, reason | order | HIGH |
| remove_recipe_from_order | orders.update_draft | orderId, orderItemId, reason | order | HIGH |
| update_order_item | orders.update_draft | orderId, orderItemId, reason | order | HIGH |
| delete_order | orders.delete | orderId | order | HIGH |
| archive_factory_file | files.archive | fileId, targetType | business | HIGH |
| create_recipe | recipes.create | name | recipe | HIGH |
| update_recipe | recipes.update | recipeName | recipe | HIGH |
| delete_recipe | recipes.delete | recipeName | recipe | HIGH |
| adjust_coil_stock | inventory.coils.adjust_stock | items | query | HIGH |
| create_part | parts.create | model, price | query | HIGH |
| batch_create_parts | parts.batch_create | parts | query | HIGH |
| adjust_part_stock | inventory.parts.batch_adjust_stock | items | query | HIGH |
| update_part | parts.update | model | query | HIGH |
| delete_part | parts.delete | model | query | HIGH |
| batch_update_prices | parts.batch_update_prices | (none declared; semantic validator still applies) | query | HIGH |
| generate_rotor_drawing | drawings.rotor.generate_pdf | piece_count | cost | HIGH |
| print_rotor_drawing | drawings.rotor.print_pdf | jobId | cost | HIGH |

STOP — WAIT FOR SUPERVISOR REVIEW.
