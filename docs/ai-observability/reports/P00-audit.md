# P00 V4 Observability Baseline Audit

审计时间：2026-09-04（Asia/Shanghai）

审计原则：`OBSERVE BEFORE MODIFY`

审计范围：当前 `master` 的已提交 HEAD，加上 P00 开始时已存在、未提交的 V4 工作树。
本报告是 P00 唯一新增文件；本阶段未实现 OpenTelemetry、OpenInference 或 Phoenix，未修改 AI/业务行为、依赖、数据库 schema 或业务数据。

## 1. Executive Result

- `P00_STATUS=PARTIAL`：代码、启动、AI、Tool、Entity、Verification、关联、日志、部署和测试边界已审清；但全量 R4-B/Repeat Stability 未安全重放，Guardian 当前不可用，完整回归与 lint 各有一个现存失败。
- `P01_READY=YES`：当前结构已理解到足以安全设计独立的 Phoenix self-host infrastructure。这个结论不表示 V4 AI 正确。
- 当前真实后端是 Express 5 + CommonJS `.cjs`，根包声明 ESM，整体为 mixed module system；生产由 Mac Mini 系统级 LaunchDaemon 直接执行 `node api.cjs`。
- 主 AI 请求由 `/api/ai/chat` SSE 进入 V3 runtime。V4 Read Investigation 和 R3 Claim Grounding 都是显式 feature flag 路径，默认关闭；P00 进程中相关 flag 未设置。
- 现有 77 个 AI tools 与 77 个 formal capabilities 一一登记，其中 29 个为写工具。执行最终通过 localhost `internalApiClient` 调用正式业务 API。
- `failed_unverified` 是 V4 deterministic state，不由 verifier LLM 决定；存在尚未发生模型 tool selection、也未执行工具就进入该状态的真实代码路径。
- Exact Entity Identity 的当前 blocker 已定位在 resolver 之前：模型把 `v750-tokoy-` 生成成 `recipeName=v750-tokoy`，resolver 收到的已是错误身份。resolver 自身会保留 exact punctuation，但 fuzzy/recovery 层仍有主动去分隔符的路径。
- P00 隔离 Real AI Shadow：`simple-current-1` 的 Legacy/V4 Investigation PASS、V4+R3 FAIL；`flat-knife-800-1` 三路径全部 FAIL。已知失败保持冻结，未修复。

## 2. V4 Frozen Baseline

正式 V4 code baseline 是 P00 开始前的 HEAD；之后即使提交本报告，也不得改写此 SHA：

```text
V4_CODE_BASELINE_COMMIT=53e918587811aa01aa47acf088331f4b020c6fb7
V4_CODE_BASELINE_SUBJECT=fix(ai): complete fact-driven coil investigation
V4_CODE_BASELINE_BRANCH=master
V4_WORKTREE_CLEAN=NO
BASELINE_WORKTREE_CLEAN=NO
```

P00 开始时 `git status --short`：

```text
 M api/services/aiAgentRuntimeV3.cjs
 M api/services/aiEntityResolverV3.cjs
 M api/services/aiEvaluations.cjs
 M api/services/aiPromptComposer.cjs
 M docs/README.md
 M docs/ai-learning-release-gate-guide.md
 M docs/api-contract.md
 M docs/api-reference.md
 M package.json
 M tests/aiDispatcherV2.test.cjs
 M tests/aiEntityResolverV3.test.cjs
 M tests/aiEvaluations.test.cjs
?? api/services/aiAnswerGrounding.cjs
?? api/services/aiShadowComparisonV4.cjs
?? docs/ai-assistant-replanning-brief.md
?? docs/ai-assistant-replanning-prompt.md
?? output/
?? scripts/run-ai-shadow-evaluation.cjs
?? tests/aiShadowComparisonV4.test.cjs
```

这些文件均为 P00 前已存在的用户/V4 工作，不属于本审计。P00 没有 reset、stash、clean、覆盖或提交它们。由于真实 V4 实现的一部分位于未提交工作树，仅用 HEAD 无法复现完整有效行为；复现时必须同时保留上述状态和本报告记录的结果。

Baseline Summary：

```text
V4_CODE_BASELINE_COMMIT=53e918587811aa01aa47acf088331f4b020c6fb7
V4_WORKTREE_CLEAN=NO
R4_B=NOT_RUN_FULL; FOCUSED_REAL_AI=FAIL
REAL_AI_SHADOW=FAIL
LEGACY_ORACLE=FAIL (current-cost-1, flat-knife-800-1); PASS (simple-current-1)
V4_INVESTIGATION_ORACLE=FAIL (current-cost-1, flat-knife-800-1); PASS (simple-current-1)
V4_R3_ORACLE=FAIL (current-cost-1, simple-current-1, flat-knife-800-1)
REPEAT_STABILITY=NOT_RUN
SAFETY_METRICS=FAIL_REAL_FOCUSED; PASS_DETERMINISTIC_CONTRACT_TESTS
EXACT_ENTITY_IDENTITY=FAIL_REAL; PASS_RESOLVER_UNIT
INVENTORY_NUMERIC_FACTS=PASS_DETERMINISTIC; FAIL_V4_R3_REAL_SIMPLE_CURRENT
COIL_STABLE_IDENTITY=PASS_DETERMINISTIC; REAL_NOT_RUN
800_FLAT_BLADE=FAIL_REAL; PASS_DETERMINISTIC_INTEGRATION
FULL_REGRESSION=FAIL (1732/1733)
GUARDIAN=NOT_RUN
```

## 3. Repository / Runtime

| Item | Frozen value |
| --- | --- |
| Repository root | `C:/Users/Dan/Documents/水泵订单及生产管理系统` |
| Branch | `master` |
| HEAD | `53e918587811aa01aa47acf088331f4b020c6fb7` |
| HEAD subject | `fix(ai): complete fact-driven coil investigation` |
| Remote | `origin` fetch/push: `git@gitee.com:lowkeydan/pump-cost-accounting-system.git` |
| Runtime | Node.js on Windows for audit; Node.js on macOS in production |
| Node | `v24.16.0` |
| Package manager | npm, root and Web both use `package-lock.json` |
| npm | `11.13.0` |
| Root application version | `1.0.0` |
| Web package version | `0.1.0` |
| Backend framework | Express `5.2.1` |
| Module system | mixed: root `package.json` has `type=module`; backend/tests/scripts are mainly CommonJS `.cjs`; Next Web uses TS/ESM |
| Normal API port | `3002` |
| Primary Web port | `3000` |
| Parallel Web preview | `3001` |

Relevant scripts:

```text
npm run api        -> node api.cjs
npm run start      -> concurrently "npm run api" "npm run dev"
npm run start:prod -> NODE_ENV=production node api.cjs
npm run dev        -> Next dev on 3000
npm run build      -> npm --prefix apps/web-next run build
npm test           -> node scripts/run-tests.cjs
```

## 4. Application Startup Graph

### Development

```text
npm run start
→ concurrently
  → npm run api → node api.cjs → Express :3002
  → npm run dev → Next.js apps/web-next :3000
```

### Backend / AI startup

```text
node api.cjs
→ dotenv.config()
→ require('express') and backend modules
→ express()
→ createRequestObservability()
→ auth/CORS/body parsers and business routers
→ require('./api/routes/ai.cjs')
→ ai router registers feedback/evaluations/chat/prompt routers
→ app.use('/', aiRouter)
→ app.listen(PORT, '0.0.0.0')
→ loadSystemPromptFromDB() / startup jobs
→ POST /api/ai/chat
→ handleAiChat()
→ runAiDispatcherV3()
→ runAiAgentRuntimeV3()
```

`api.cjs` is the real HTTP server entrypoint. It loads dotenv at the first statement, then loads Express and database/AI modules before `app.listen`. `api/routes/ai.cjs` is the AI route aggregator; `api/routes/ai/chat.cjs` owns `/api/ai/chat`, SSE headers, 15s heartbeat, client abort and 180s whole-request timeout.

### Frontend entry to SSE

`apps/web-next/lib/ai.ts:streamAiChat()` keeps the last 10 messages, adds normalized `pageContext`, `resolutionContext` and `turnState`, and calls `proxyStreamFetch()`. Local browser mode targets `http://<host>:3002/api/ai/chat`; production uses same-origin `/api/ai/chat`. It parses JSON from SSE `data:` lines and emits `status/provider/tool_plan/tool_call/tool_result/detail/content/turn_state/done/error` events.

### Tests

- `scripts/run-tests.cjs` creates a system-temp directory and launches Node's test runner with `NODE_ENV=test` and `PUMP_TEST_DATABASE_PATH=<temp>/pump-{pid}.db`, then removes it.
- R4-A uses `scripts/run-ai-architecture-acceptance.cjs`, which similarly supplies a temp DB to ten V4 architecture/integration files.
- Deep API copies `pump.db` to a temp project and spawns the actual `api.cjs` against the copy.
- Individual integration tests may mount selected real Express routers on an ephemeral localhost port.

### Production

```text
system LaunchDaemon com.pumpfactory.api
→ /usr/local/libexec/pumpfactory-api-daemon
→ cd /Users/dan/pump-cost-accounting-system
→ /opt/homebrew/bin/node api.cjs

system LaunchDaemon com.pumpfactory.web
→ /usr/local/libexec/pumpfactory-web-daemon
→ cd /Users/dan/pump-cost-accounting-system/apps/web-next
→ node node_modules/next/dist/bin/next start -p 3000
```

`npm run deploy:macmini` invokes the Windows PowerShell wrapper, then the Mac release script performs backup, fast-forward pull, release gate, LaunchDaemon kickstart, local/public health checks and AI release gate.

### Future OTel bootstrap load point

Bootstrap must execute before the first `require('express')`, `require('./api/db.cjs')`, provider module, or any other instrumented module. The safest current entry is a CommonJS preload in the API daemon command, conceptually `node --require <bootstrap.cjs> api.cjs`; placing it after the static requires in `api.cjs` is too late. P00 does not create that module or alter startup commands.

## 5. Current AI Execution Graph

The following is the effective V4-capable path in the current working tree. Rows are real stages; a state mutation means process, DB, network, or controller state, not merely a local variable.

| Stage | File / function | Input | Output | State mutation | Error handling | Next |
| --- | --- | --- | --- | --- | --- | --- |
| User/UI request | `apps/web-next/lib/ai.ts:streamAiChat` | UI messages, attachments, page/resolution/turn context | POST JSON + SSE consumer | none; UI later accumulates events | fetch/SSE errors become UI error | HTTP entry |
| Chat/API entry | `api/routes/ai/chat.cjs:handleAiChat` | authenticated `req.body`, `req.requestId` | SSE stream | timers, abort controller, in-memory telemetry | timeout, disconnect, provider/runtime exception emit error | dispatcher |
| Dispatcher | `api/services/aiDispatcherV3.cjs:runAiDispatcherV3` | normalized route input | runtime result | none | propagates | runtime |
| Context prepare | `aiContext.cjs:trimAiContext/scopeAiContextForIntent`; page/turn/resource normalizers | messages + page/resolution/turn state | bounded/scoped messages | none | invalid context is dropped/normalized | planner/runtime |
| Intent/goal planning | `aiGoalPlannerV3.cjs:planAiGoalV3` | messages and context | deterministic validated V3 intent | model/network calls; usage/timing collection | each of domain/capability structured plans may repair once; then throws | prompt + route |
| Prompt compose | `aiPromptComposer.cjs:composeAiSystemPrompt`; `routes/ai/prompt.cjs:getFactoryProfile` | intent domains, query, factory profile, answer/page/state rules | system message | reads runtime/DB-backed profile | profile has service fallback | model loop |
| Tool availability | `aiCapabilityCatalogV2.cjs:selectToolsForIntent` | intent | bounded definitions | none | unknown capability rejected | V3 loop or V4 broker |
| V4 goal/state | `aiReadInvestigationRuntimeV4.cjs:createReadInvestigationController` | intent, original user text, evidence ledger, budget | InvestigationGoal/State/controller | in-memory state machine | noneligible returns null | V4 broker |
| V4 route | `aiCapabilityBrokerV4.cjs:selectNextCapability` | open FactRequirements, profiles, hints | one selected capability or terminal reason | none | unavailable/budget changes controller terminal state | forced model call |
| Model provider | `aiProvider.cjs:fetchAiProvider` | messages, tools, tool choice, stream flag | OpenAI-compatible response/stream | outbound network, file cache for Kimi | timeout/retry/provider fallback/tool-choice fallback | parser |
| Tool call parse | `aiProviderStream.cjs:readAiProviderStream` or `aiReadInvestigationDriverV4:readProviderMessage` | SSE/nonstream provider response | content, reasoning, usage, raw tool calls | none | malformed/provider errors fail or become V4 technical failure | protocol validation |
| Tool arguments | `aiToolProtocol.cjs:prepareAiToolCalls/parseAiToolArguments`; `aiToolInputValidatorV2.cjs`; `aiToolIdentifierGrounding.cjs` | model tool_calls JSON | schema-validated and normalized args | none | rejected call is returned to model; V4 records behavior rejection | entity resolution |
| Entity resolution | `aiEntityResolverV3.cjs:resolveAiToolTargetV3` | tool name, normalized args | resolved args + receipt, ambiguity, not-found or system error | read-only discovery API calls | verified miss/ambiguity/system failure are explicit | executor |
| Executor | `api/routes/ai/executor.cjs:executeToolCall` | capability + resolved args + `allowWrite` | tool result/confirmation/evidence | reads business API; writes only after confirmed path | schema/allowlist/receipt/size failures fail closed | internal client |
| Internal API client | `api/routes/ai/internalApiClient.cjs:createInternalFetch/requestJson` | local URL, method, body, operation/capability context | camelCase formal API data | localhost HTTP; in-memory call trace | no retry, timeout, structured protocol/not-found/failure | business API |
| Business API | registered Express route → query/service/command layer | authenticated internal HTTP | formal result/operation receipt | reads or transactional writes/audit | route/service error contract | executor evidence |
| Observation/evidence | `aiObservationV3.cjs:observationFromToolResult/createEvidenceLedger`; `aiFactReducerV4.cjs:reduceObservation` | formal result + execution evidence | Observation, EvidenceRecord, updated FactRequirements | V4 in-memory state/ledger | technical failures become unavailable; ambiguity clarifies | loop terminal check |
| Tool result to model | `aiToolProtocol.cjs:buildAiToolResultMessage` | bounded tool result | role=`tool` JSON message | none | oversized result fails closed | next model round or synthesis |
| Verification | V4 reducer/claim validator or legacy `aiExecutionEvidence.cjs` | Fact/evidence/tool results | terminal state / verified status | none beyond controller state | no-evidence and mismatch fail closed | response compose |
| Final response | `synthesizeVerifiedAnswer` or `aiGroundedAnswerV4.cjs:composeGroundedAnswerV4`; failure state reply | verified evidence or Claims | Markdown text + speech + details | optional extra LLM call; SSE output | deterministic safe fallback in R3; legacy synthesis retries once | client |

Current default path when both flags are absent is V3. The V4 code path is real but gated by `AI_READ_INVESTIGATION_V4_ENABLED=true`; R3 additionally requires `AI_CLAIM_GROUNDING_V4_ENABLED=true`.

## 6. Model Call Architecture

### Provider and configuration

- Common provider wrapper: `api/services/aiProvider.cjs:fetchAiProvider`.
- Protocol: OpenAI-compatible `POST <baseUrl>/chat/completions` using native `fetch`, not the official OpenAI SDK.
- DeepSeek defaults: provider `deepseek`, model `deepseek-v4-flash`, base URL `https://api.deepseek.com`.
- Kimi defaults: provider `kimi`, model `kimi-k3`, base URL `https://api.moonshot.cn/v1`.
- Auto route uses DeepSeek for normal text. Image/file extraction can use Kimi when configured; unavailable Kimi capability falls back to DeepSeek where allowed.
- Per provider HTTP call: default timeout 120s, maximum three attempts, retry delay `200ms * attempt`, retries on configured retryable status/network/timeout. Whole chat defaults to 180s.
- V3 limits: 7 tool rounds, 10 formal tool calls, 3 recovery rounds, 12 entity-discovery calls.
- Streaming chat requests set `stream=true` and `stream_options.include_usage=true`; planners and synthesis are non-streaming.
- `aiProviderStream.cjs` merges fragmented content/reasoning/tool_calls and records TTFT and provider usage.

### System prompt and context

- Main assistant prompt starts at `aiPromptComposer.cjs:CORE_PROMPT`, adds selected `DOMAIN_PROMPTS`, the DB/default factory profile, current governed AI rules, V3 answer contract, page context and prior-turn resolution/turn-state notes.
- The factory profile is served by `api/routes/ai/prompt.cjs`; `api.cjs` calls `loadSystemPromptFromDB()` after listen.
- Planner prompts are separate in `aiGoalPlannerV3.cjs:domainPlannerPrompt/plannerPrompt`.
- R3 renderer uses a separate constrained prompt in `aiGroundedAnswerV4.cjs:rendererMessages`.
- Context assembly is in `trimAiContext`, `scopeAiContextForIntent`, `composeAiSystemPrompt`, and provider attachment preparation.

### Structured output and parser

- Domain and capability planning each force a single planner tool; `parsePlanArguments()` parses tool arguments as JSON and `normalizeIntentPlan()` validates enums, domains, facts and steps.
- Runtime tool calling parses OpenAI-compatible `message.tool_calls`; `prepareAiToolCalls()` enforces the per-turn allowlist, read/write class and JSON schema.
- R3 Claims and AnswerPlan are deterministic objects. Complex multi-claim formatting may ask a no-tool renderer for structured JSON; schema/claim-ref validation is deterministic, with at most one constrained repair and deterministic fallback.
- Legacy synthesis asks for free Markdown with tools disabled and retries once if tool protocol, unsupported configured-BOM amount, or false confirmation language appears.

### Usage data

- Main planner/runtime/synthesis paths collect only provider-reported prompt/completion/total tokens and aggregate them.
- Streaming explicitly requests usage. Missing usage remains unavailable; it is not estimated for the evaluation gate.
- `aiRuntimeTelemetry` keeps actual usage in process memory, but `logger.safeMeta()` redacts JSON keys containing `token`, so console output shows these values as `[REDACTED]`.
- Rotor and quotation helper responses do not expose a unified usage object to runtime telemetry.

### Distinct AI paths

```text
CURRENT DEFAULT PATH
/api/ai/chat → V3 two-stage planner → V3 constrained tool loop/recovery
→ formal API evidence → legacy verified synthesis

CURRENT V4 INVESTIGATION PATH (flagged)
/api/ai/chat → same planner/prompt → FactRequirements → deterministic Broker
→ forced single capability model call → resolver/executor/evidence/state
→ legacy verified synthesis or terminal safe state reply

CURRENT V4+R3 PATH (two flags)
V4 terminal state → deterministic Claims/validation/AnswerPlan
→ deterministic formatter or constrained no-tool renderer → final validator

ONLINE SHADOW PATH (flagged)
completed V3 observations/evidence → replayReadInvestigationShadow()
→ log status only; no extra business API call and no answer replacement

R4-B REAL SHADOW TEST PATH
one DB snapshot/oracle → three isolated envs: legacy_v3, v4_investigation, v4_r3
→ real provider + ephemeral formal APIs → redacted comparison report

OTHER / LEGACY PATHS
quotation inquiry → generateQuotationInquirySummary() → forced Kimi, nonstream, no tools
settings connection test → fetchAiProvider(), nonstream, response body ignored
rotor natural language → direct https.request to DeepSeek, nonstream JSON, 15s, two retries
test path → injected scripted provider or isolated real provider runner
```

The OpenInference OpenAI SDK instrumentation is not a drop-in auto-instrumentation for the main path because this repository calls provider HTTP with native `fetch`; manual LLM spans are required unless the provider layer is later changed.

## 7. Tool Architecture

### Registry and exposure

- Tool schemas: `api/routes/ai/tools.cjs:AI_TOOLS` — 77 OpenAI function definitions.
- Write classification: `WRITE_TOOLS` — 29 tools.
- Formal capabilities: `api/capabilities/registry.cjs` — 77 entries with `capabilityId`, domains, access, entity scopes, execution class, `executorKey`, source of truth, risk and callers.
- Catalog/routing: `aiCapabilityCatalogV2.cjs`. Planner directory is bounded; runtime offers at most 18 definitions. V4 Broker uses `aiReadCapabilityProfilesV4.cjs` and selects exactly one capability for an open FactRequirement.
- V3 dynamic routing exists in two places: planner selects formal steps; runtime exposes the current step and may add bounded read-only discovery/recovery capabilities. V4 route is deterministic after the planner produces Fact intent.
- All model tool calls are checked against a per-turn allowlist and schema. Non-command intent cannot call a write capability.

### Mapping and write confirmation

```text
AI tool name
→ formal capability registry entry
→ executorKey
→ TOOL_EXECUTORS in api/routes/ai/executor.cjs
→ cost/query/order/recipe/business executor
→ createInternalFetch()
→ formal localhost business API
```

For writes, `allowWrite=false` never performs the final change. It can run a formal preview, then issues an in-memory, one-time, 5-minute confirmation token bound to subject, tool, canonical args hash, operationId and resource version. `POST /api/ai/confirm-tool` consumes the token and calls the same executor with `allowWrite=true`. Success must include a formal operation receipt containing operation/capability identity and audit IDs; otherwise the AI must not claim success.

Tool results are size-bounded, JSON-serialized by `buildAiToolResultMessage()`, appended as role `tool`, and returned to the model for the next round or synthesis.

### Future tracing boundaries in current code

| Boundary | Existing location |
| --- | --- |
| tool available | `selectToolsForIntent`, planner directory, V4 profile list |
| tool selected | V3 intent steps / `selectNextCapability` |
| tool arguments generated | provider response parser before `prepareAiToolCalls` |
| tool arguments normalized | `prepareAiToolCalls`, schema validator, coil shorthand grounding |
| tool pre-execution | immediately before `executeToolCall` |
| tool execution | `executeToolCall` and mapped executor |
| tool result | executor return plus `enforceAiToolResultBudget` |
| tool result normalization | execution-evidence/Observation adapters |
| tool returned to model | `buildAiToolResultMessage` |

## 8. Entity Pipeline

### Actual pipeline

```text
raw UI user content
→ streamAiChat body.messages (last 10)
→ handleAiChat / trimAiContext / latestUserText().trim()
→ planner LLM sees user text and generates goal/fact intent/capability steps
→ V4 goal chooses intent.targetMentions[0] if present, else raw latest user text, else intent.goal
→ model generates capability tool arguments
→ JSON parse
→ recursive schema normalization: string trim + whitespace collapse
→ explicit coil shorthand normalization when applicable
→ resolveAiToolTargetV3 reads the registered target argument
→ buildSearchProbes(original mention first, then fuzzy probes)
→ formal discovery capability / business API candidate lookup
→ exact normalization and fuzzy scoring are computed separately
→ exact / unique_candidate / ambiguous / not_found decision
→ selected stable numeric ID and stable business identity are written into resolved args/receipt
```

### String mutations in order

1. Frontend preserves message text but limits the conversation to ten messages.
2. `latestUserText()` trims outer whitespace. Context budgeting may truncate older/oversized context, not silently normalize punctuation.
3. Planner `normalizeText()` trims and collapses whitespace for `goal` and objectives. The current normalized intent object does not define a durable `targetMentions` field, although the V4 goal code checks for one; the normal fallback is therefore the whole latest user utterance.
4. `goalFromIntent()` keeps `originalTarget`, while its Fact qualifier applies `NFKC → trim → lowercase` and preserves punctuation.
5. Provider-generated tool arguments are the first model-controlled representation of the entity.
6. `aiToolInputValidatorV2` recursively applies `trim → collapse whitespace`; it does not delete punctuation.
7. `normalizeExplicitCoilShorthandArgs()` may turn an explicitly grounded numeric shorthand such as `12-200` into canonical coil fields.
8. `resolveAiToolTargetV3()` takes the first registered target argument and trims it. This value becomes `receipt.originalMention`; the raw user mention is not automatically substituted.
9. `normalizeExactIdentity()` performs `trim → NFKC → locale lowercase`; punctuation and internal whitespace remain identity-significant.
10. `normalizeFuzzyIdentity()` then removes whitespace and `. _ + # / ( ) （ ） - －` for discovery/scoring only.
11. `candidateView()` marks `matchKind=exact` only when exact-normalized strings match. A unique fuzzy candidate can auto-bind only for reads; writes still require exact.

### Known identities

- `v750-tokoy-`: existing focused real-provider evidence in `output/ai-r4b-handoff.md`, rechecked against the current code, shows the provider generated `recipeName=v750-tokoy`. The resolver therefore correctly exact-matched Recipe 2 (`v750-tokoy`) rather than intended Recipe 8 (`v750-tokoy-`). The first loss is between raw user mention and model tool argument, before resolver entry.
- `800平刀`: deterministic HTTP/Facts tests pass, but P00 real shadow `flat-knife-800-1` failed all three paths. Legacy ended `running`, V4 Investigation `needs_clarification`, V4+R3 `budget_exhausted`.
- Coil stable identity: `aiStableEntityIdentityV4.cjs` carries primary ID plus stable business keys such as `schemeCode`; deterministic tests cover same spec/different scheme, family vs concrete scheme, zero stock, binding reuse and conflicting ID/key fail-closed.
- Numeric identity/facts: `aiNumericScalarFactsV4.cjs` materializes authoritative scalar values with entity identity, predicate, scenario, temporal scope and unit; deterministic tests pass. Real V4+R3 simple inventory still failed because it investigated coil facts instead of the expected part fact.

### Where punctuation can be lost

- Confirmed first-loss point: the model-generated structured tool argument.
- Intended fuzzy loss: `normalizeFuzzyIdentity()` for probes, scoring and `rowsMatchingTarget()` candidate filters.
- Legacy/recovery loss: `aiAgentRuntimeV3.normalizeEntityText()` removes whitespace, quotes, backticks, underscore and hyphen when grounding an empty `search_parts.keyword` from previous verified results.
- Recovery matching in `aiCapabilityGraphV3` uses fragment/semantic normalization and is not an exact-identity guarantee.
- Business-specific helper resolvers may apply their own partial match rules after the shared resolver.

### Bypasses and alternate resolvers

- Tools with no `TOOL_TARGETS` entry bypass `resolveAiToolTargetV3` entirely.
- `aiResourceResolutionV3.resolveUniqueResource()` is an older trim/lowercase exact-or-includes resolver used by resource clarification/binding paths.
- Recipe executors contain local exact/partial matching for recipe rows.
- The order service accepts name/contract query aliases and remains the final authority.
- Coil command/service code has business aliases for input fields; those are not the shared AI entity resolver.
- Quotation inquiry, rotor natural-language parsing, settings AI test, ordinary conversation, and attachment summarization bypass the unified entity resolver.
- Previous-turn resource selection can bind a canonical candidate through `bindResolutionToolCalls()` rather than perform a new fuzzy search.

There is no global alias table that guarantees raw mention → canonical entity across every AI path. Exact identity currently depends on the model preserving the target argument or on a prior structured resolution receipt.

## 9. Verification / failed_unverified

### V4 state and evidence

- Terminal statuses are `completed`, `completed_negative`, `needs_clarification`, `failed_unverified`, and `budget_exhausted`.
- `FactRequirement` specifies identity, accepted evidence kinds, optionality, required source of truth and required authority.
- `Observation` and `EvidenceRecord` are structured deterministic records. Evidence is appended only from an attempted observation with formal execution evidence; Fact reduction validates fact key and accepted evidence kind.
- Technical outcomes (`timeout`, transport/protocol failure and related mapped failures) and business-rule rejection make an open requirement `unavailable`. `deriveInvestigationStatus()` then returns `failed_unverified` when any required requirement is unavailable.
- `failed_unverified` can be produced by the V4 controller/reducer only; the model cannot directly set it.
- R3 Claim validation is deterministic. The optional renderer only arranges validated claim references and cannot turn unverified data into evidence.

### Before/after execution paths

1. **Before model tool selection and before execution:** `controller.next()` can receive Broker `status=unavailable`; it immediately calls `markOpenRequirementsUnavailable()`. The driver sees the now-terminal state and returns `failed_unverified` without `executeDecision()`.
2. **After Broker capability selection but before model tool selection/execution:** provider timeout/transport/protocol failure inside the forced capability call returns `kind=technical_failure`; the driver calls `controller.failUnverified()` before parsing a valid model tool call or invoking the executor.
3. **After execution:** formal API/tool technical failure becomes an Observation with technical outcome; the reducer marks the requirement unavailable.

Therefore the answer to the required question is **YES**: an actual path can enter `failed_unverified` before the model selects a tool and before any tool executes. A second actual path has a Broker-selected capability but still reaches the same state before the model returns a tool call.

### Legacy verifier and fallback

- `aiExecutionEvidence.cjs` is the legacy deterministic verifier. Read success requires formal API trace evidence; verified empty/not-found is distinguished from unverified failure. Write success requires a registered operation/capability receipt and audit IDs.
- V3 `requiredEvidenceSatisfied()` checks planned capability coverage and verified results. It can enter bounded read recovery (maximum 3 rounds) or produce a safe missing-evidence reply.
- V4 does not use V3 recovery after a normal V4 terminal result. Only an internal implementation exception yields `fallbackReason=v4_internal_failure` and restarts the V3 path. Unknown fallback reasons throw.
- Early exits exist for planner clarification, entity ambiguity, terminal V4 state, pending write confirmation, request abort and budgets.
- The state machine and Broker authorization reject duplicate/out-of-scope/write calls. The pre-execution `failed_unverified` order described above is deliberate current behavior, not an out-of-order executor call.

## 10. Request & Operation Correlation

| Field | Origin | Actual propagation | Loss / limitation |
| --- | --- | --- | --- |
| `requestId` | `createRequestObservability()` accepts safe `X-Request-ID` or UUID | HTTP log → chat → runtime/telemetry/logger | `internalApiClient` does not forward it, so localhost business API creates a new request ID; no end-to-end AI→business correlation |
| `operationId` | confirmation token or command context UUID | AI confirmation → executor → `X-Operation-ID` → command context → `api_operations`/audit/receipt | mainly write path; child internal operations may create new IDs; not a universal read trace ID |
| `actor` / `actorKey` | user session role/issued-at, internal auth, MCP identity | command context → idempotency/operation/audit | AI internal call authenticates with internal secret; original user actor is not propagated to business API |
| `capability` | tool name + registry `capabilityId` | runtime/executor → `X-Capability-ID` → command/receipt/audit | tool name and formal ID are related but distinct; only capability ID crosses write layers consistently |
| `resource` | business command outcome / confirmation context | operation receipt and confirmation card | not universal on reads; not attached to outer request telemetry |
| `version` | expectedUpdatedAt/expectedVersion/resourceVersion | confirmation token → confirmed execution and business concurrency checks | resource-specific; not a request or trace version |
| `timestamp` | request logger, observations/evidence, operations/audits | stored independently at each layer | no single cross-layer timestamp or clock context |
| `audit id` | `safeUpdate`/command transaction | audit table → operation receipt → AI write evidence | write-only; reads do not have audit IDs |

IDs already useful for future trace correlation are outer `requestId`, write `operationId`, formal `capabilityId`, and opaque `auditIds`. Only `operationId/capabilityId/auditIds` currently make a meaningful cross-layer chain for confirmed writes. The outer AI `requestId` is currently a logging field, not a true end-to-end propagated correlation ID.

## 11. Existing Logging / Observability

### Present

- `api/logger.cjs` produces console lines with ISO timestamp, scope, level, message and JSON metadata.
- `safeMeta()` redacts keys matching password/secret/token/API key/Authorization/cookie, handles cycles/errors and caps metadata at 8,000 characters.
- `createRequestObservability()` logs method, path without query, status, duration and requestId at response finish; `/api/health/live` is skipped.
- `aiRuntimeTelemetry` stores a bounded in-memory window (default 100, configurable 10–500) with status/outcome, latency, TTFT, provider/model/fallback/retry, provider-reported usage, stage timings and tool names/durations/error codes. Health endpoints expose aggregates.
- AI runtime console logs completion telemetry. Chat errors include request/provider/action/error codes.
- `internalApiClient` holds an in-memory formal API call trace with method/path/outcome/result/error. Execution evidence projects a safer method/path/operation/capability view.
- V4 keeps structured in-memory Observations, Evidence Ledger, behavior events and Fact state for the response lifecycle.
- SQLite has `audit_log`, `api_operations`, business change events, AI conversations/feedback/evaluation runs, knowledge sync runs and related timestamps.
- Some older routes, notably rotor, still use direct `console.error/warn`.

### Absent

- No trace/span context, W3C propagation, exporter, collector, persistent metrics backend or distributed trace store.
- No current OpenTelemetry, OpenTracing, OpenInference, Phoenix, Sentry, Datadog, New Relic or Prometheus SDK usage.
- Root `npm ls @opentelemetry/api --all` and Web equivalent are empty.
- `apps/web-next/package-lock.json` mentions `@opentelemetry/api` only as optional peer metadata of Next; it is not resolved/installed or used. Classification: `DIRECT=NO`, `TRANSITIVE_INSTALLED=NO`, `LOCK_METADATA_ONLY=YES`, `USED=NO`.

Existing telemetry deliberately avoids prompt, full args and full tool results, but V4 Evidence/ToolResult structures can contain full business payloads. Current logger redaction is secret-key oriented, not a complete PII policy.

## 12. Deployment / Docker

### Current facts

- No `Dockerfile`, `docker-compose*`, or `compose*.yml/yaml` exists in the repository.
- Application production is not containerized. It runs two macOS LaunchDaemons from `/Users/dan/pump-cost-accounting-system`.
- API/Web logs are files under `<repo>/logs`; release/startup backups are under configured backup directories; primary SQLite is `<repo>/pump.db` unless a test path overrides it.
- Ports already reserved by the application are 3000, 3001 and 3002.
- Runtime environment comes from `.env`, LaunchDaemon `NODE_ENV/PATH`, and DB-backed runtime settings. Secrets must not be copied into a Phoenix compose file.

### Phoenix recommendation for P01

Use a **separate compose in a separate observability directory on the same Mac Mini initially**. Do not introduce the application itself into Docker and do not couple application restart/health to Phoenix availability. This gives a reversible infrastructure boundary while preserving the current LaunchDaemon deployment.

- Pin an explicit Phoenix image version rather than `latest` for production-like diagnostics.
- Place persistent Phoenix/Postgres data in a dedicated app-data directory or named Docker volume outside the Git checkout and outside macOS TCC-sensitive `Documents`; do not reuse `pump.db` or application backup volumes.
- Start with Phoenix bound to loopback or trusted LAN plus access control/tunnel; do not expose the UI/collector unauthenticated to the public Internet.
- Phoenix official Docker docs use `6006` for UI + OTLP HTTP and `4317` for OTLP gRPC, with persistent SQLite at `PHOENIX_WORKING_DIR=/mnt/data` or PostgreSQL 14+. UI is normally `http://localhost:6006`. See [Phoenix Docker self-hosting](https://arize.com/docs/phoenix/self-hosting/deployment-options/docker).
- Avoid 3000/3001/3002. Reserve 6006 and 4317 only after verifying Mac host availability; if OTLP HTTP is routed differently in the chosen pinned Phoenix version, follow that version's official endpoint matrix rather than assuming 4318.
- Configure a finite retention policy and recoverable volume backup before diagnostic content is enabled.

Recommendation choice:

```text
same compose=NO (no application compose exists)
separate compose=YES
separate directory=YES
separate host=NOT_REQUIRED_FOR_P01; reconsider for capacity/isolation
```

## 13. Sensitive Data Classification

### NEVER TRACE

- API keys, `Authorization`, cookies, JWT/session/access tokens, passwords.
- `INTERNAL_SECRET`, MCP service tokens, confirmation tokens, runtime encryption keys and database credentials.
- Raw `.env`, DB-backed encrypted secret values, provider request headers and complete auth/session fingerprints.
- Full attachment blobs/base64 and unredacted provider upload/download payloads.

### REDACT

- Phone, email, WhatsApp/other contact handles, physical/shipping/billing addresses.
- Customer/contact names when personally identifying, customer identifiers that are not necessary for diagnosis.
- Order/quotation remarks and free text that may contain personal or commercial contact details.
- Conversation text, feedback notes, attachment original names and extracted customer-document text unless explicitly sampled under an approved diagnostic policy.
- Actor credential fingerprints and internal network/auth headers.

### DIAGNOSTIC-ALLOWED

Only in the self-host diagnostic environment and after central redaction:

- Product/pump/part/template/recipe/coil model and name.
- Raw entity mention, normalized mention, probes, exact/fuzzy kind, candidate scores, canonical ID and stable business identity.
- Inventory quantity, cost, BOM quantities/weights/numeric facts, scenario/temporal scope/unit.
- Capability/tool names, normalized arguments, bounded tool results and formal error codes.
- FactRequirement/Observation/Evidence/Claim status, requestId/operationId/capabilityId/auditId as opaque correlation fields.
- Provider/model, timing, retry, token usage and result sizes.

### Central redaction point

The future authoritative redaction boundary should be a shared span attribute/event serializer immediately before data enters the SpanProcessor/exporter. Both auto and manual spans must pass through it; provider HTTP headers/bodies must be excluded by default. The diagnostic-content flag should be read once in the bootstrap/runtime config and passed as policy, not checked ad hoc in each business function. `logger.safeMeta()` is a useful existing pattern but is insufficient because it does not classify phone/email/address/free text.

OpenInference supports hiding inputs, outputs, messages, tool definitions and related content through trace configuration; these should be deny-by-default even on self-host. See [OpenInference trace configuration](https://arize-ai.github.io/openinference/spec/configuration.html).

## 14. Test / Eval / Guardian Inventory

| Asset | Files / command | Input and output | PASS/FAIL authority | Real model / API / writes | Safe replay |
| --- | --- | --- | --- | --- | --- |
| Legacy Oracle | `scripts/run-ai-shadow-evaluation.cjs`, `api/services/aiShadowComparisonV4.cjs`; `npm run test:ai-shadow` | dynamic snapshot cases; redacted `output/ai-r4b-shadow-latest.json` | deterministic ExpectedClaimSet/oracle comparison | real model, ephemeral real APIs; isolated DB copy includes a fixture update | safe only if report path is isolated; default command overwrites existing output |
| V4 Investigation Oracle | same runner, env path `v4_investigation` | same oracle/snapshot | same deterministic classifier | real model/API, isolated DB | same condition |
| V4+R3 Oracle | same runner, env path `v4_r3` | same oracle/snapshot | same plus claim coverage/grounding | real model/API, isolated DB | same condition |
| R4-A | `scripts/run-ai-architecture-acceptance.cjs`; `npm run test:ai-architecture` | fixtures + temp DB + ephemeral HTTP | Node assertions and deterministic architecture metrics | scripted providers; real local API integration; temp writes only | yes |
| R4-B | `scripts/run-ai-shadow-evaluation.cjs`; `npm run test:ai-shadow` | 35 dynamic cases: 5 inventory plus six repeat groups × five | `runShadowComparisonSuite` rollout readiness and safety metrics | real DeepSeek, formal ephemeral APIs, isolated DB snapshot | data-safe, but costly and default output-destructive |
| Real AI Shadow | same R4-B runner with `--case-key=<key>` | one selected case across three paths | deterministic oracle and comparison | real model/API; isolated copy | yes when runner itself is copied to temp as in P00 |
| Repeat Stability | R4-B groups `simple_current`, `ambiguous`, `current_cost`, `current_saved`, `complex_renderer`, `flat_knife_800` | five V4+R3 runs per group | each group requires 5/5 stable pass | real model/API | costly; do not run casually |
| Safety Metrics | `aiArchitectureAcceptanceV4.cjs`, `aiShadowComparisonV4.cjs`, related tests | unsupported claim, false not-found, ambiguity auto-resolution, write exposure, evidence preservation, required claim coverage | deterministic numerator/denominator rates | tests scripted; R4-B real | tests yes; full real costly |
| Exact Entity Identity | `tests/aiEntityResolverV3.test.cjs`, current-cost shadow evidence | punctuation/collision fixtures and dynamic recipe oracle | unit assertion + real oracle identity | unit no real model; shadow real | unit yes; focused shadow via temp report |
| Inventory Numeric Facts | `tests/aiNumericScalarFactsV4.test.cjs`, R4-A HTTP tests, shadow inventory cases | formal part/coil scalar values | fact/claim identity assertions and oracle | local API; shadow real | deterministic yes |
| Coil Stable Identity | `tests/aiStableEntityIdentityV4.test.cjs` and coil shadow cases | schemeCode/ID/spec/sheets identity fixtures | deterministic identity/claim validation | no real model in focused unit | yes |
| `800平刀` | `aiReadInvestigationV4.test.cjs`, R4-A HTTP, R4-B `flat-knife-800-*` | temp formal part and dynamic DB row | deterministic Fact assertion / real oracle | local API or real model | yes only isolated |
| Performance | `aiRuntimeTelemetry.test.cjs`, provider stream tests, R4-B runtime metrics | latency/TTFT/stages/tools/provider requests/usage | assertions or report aggregation | real only in R4-B | deterministic yes |
| Full Regression | `scripts/run-tests.cjs`; `npm test` | all `tests/*.test.cjs`, per-process temp DB | Node test runner | local APIs and temp DB writes; no intended production writes | yes |
| Deep API | `scripts/run-deep-api-smoke.cjs`; `npm run test:deep-api` | copied DB/temp app, actual backend | 437 scenario assertions + DB integrity/FK check | real local API; isolated write flows | yes |
| Guardian | expected `.guardian/config.yaml` and `guardian`/`adf` CLI | absent in current checkout/runtime | unavailable | not run | no current replay path |

The existing R4-B report and handoff in untracked `output/` are baseline artifacts, not authoritative source code. P00 used them only as current evidence and independently rechecked the relevant functions/tests.

## 15. Baseline Test Results

| Check | Result | Evidence / safety |
| --- | --- | --- |
| `npm run test:ai-architecture` | PASS | 120/120; temp DB; R4-A architecture, driver, evidence, claims and HTTP integration |
| Focused entity/numeric/shadow/telemetry/provider tests | PASS | 70/70; no repository DB import/write |
| `npm run verify:api-contract` | PASS | 26/26 |
| `npm run build` | PASS | Next production compile/type check/static generation completed |
| `npm run test:deep-api` | PASS | 437/437; temp DB integrity `ok`, FK violations 0 |
| `npm test` | FAIL | 1732/1733; only failure is `businessTerminologyContract.test.cjs` opening absent `.guardian/config.yaml` (`ENOENT`) |
| focused terminology contract | FAIL | 5/6; reproduces the same missing `.guardian/config.yaml` failure |
| `npm run lint` | FAIL | `api/services/aiEntityResolverV3.cjs:4:5` unused `normalizeResourceText`; pre-existing dirty V4 code, not fixed |
| Guardian check/read-only | NOT_RUN | `.guardian` absent; `guardian` and `adf` commands unavailable |
| Full R4-B | NOT_RUN | 35 cases × three real paths is materially costly; default runner overwrites the user's existing `output/ai-r4b-shadow-latest.json` |
| Repeat Stability | NOT_RUN | requires six groups × five real V4+R3 runs; materially costly |
| Real shadow `simple-current-1` | FAIL overall | temp copy only: Legacy PASS/completed; V4 Investigation PASS/completed; V4+R3 FAIL/needs_clarification, `TERMINAL_STATE_MISMATCH`; suite blocker `UNSUPPORTED_BUSINESS_CLAIM` |
| Real shadow `flat-knife-800-1` | FAIL | temp copy only: Legacy FAIL/running; V4 Investigation FAIL/needs_clarification; V4+R3 FAIL/budget_exhausted; `BOTH_FAIL=1`; blocker `UNSUPPORTED_BUSINESS_CLAIM` |
| Existing focused `current-cost-1` | FAIL | pre-P00 current artifact: all three paths 0/1; exact `v750-tokoy-` identity lost before resolver; no P00 rerun |

The P00 shadow setup copied current `api/`, `shared/`, runner and `pump.db` into a verified system-temp directory, linked dependencies, let the existing runner create its own secondary DB snapshot, read only the redacted result, then removed the temp tree. Repository `pump.db` timestamp and size remained unchanged.

## 16. Future Instrumentation Map

`Existing Stage?=YES` means a genuine callable boundary already exists. `NO` means the proposed semantic name would be synthetic unless a future design explicitly groups existing work; P00 must not invent a business stage.

| Future Span | Existing Code Location | Function | Existing Stage? | Instrumentation Risk |
| --- | --- | --- | --- | --- |
| `invoke_agent pump_factory_assistant` | `api/services/aiAgentRuntimeV3.cjs` | `runAiAgentRuntimeV3` | YES | medium: parent lifetime includes multiple model/tool calls and SSE abort |
| `pump.ai.request` | `api/routes/ai/chat.cjs` | `handleAiChat` | YES | low/medium: must end on disconnect/timeout exactly once |
| `pump.ai.context.prepare` | `aiContext.cjs`, page/resource/turn state modules | `trimAiContext`, `scopeAiContextForIntent`, normalizers | YES | low if only counts/modes; high if message text is captured |
| `pump.ai.intent.resolve` | `aiGoalPlannerV3.cjs` | `planAiGoalV3` | YES | medium: contains two provider calls and one repair each |
| `pump.ai.entity.extract` | planner/provider output | no independent authoritative extractor | NO | high: do not claim extraction timing or correctness as a separate stage |
| `pump.ai.entity.normalize` | `aiToolInputValidatorV2.cjs`, `aiToolIdentifierGrounding.cjs`, `aiEntityResolverV3.cjs` | string validator, coil shorthand, exact/fuzzy normalizers | YES, multiple boundaries | high: raw/normalized values may be sensitive and identity-significant |
| `pump.ai.entity.resolve` | `aiEntityResolverV3.cjs` | `resolveAiToolTargetV3`, `resolveFormalEntityResultV3` | YES | medium/high: nested discovery API calls and candidate payloads |
| `pump.ai.route` | `aiCapabilityCatalogV2.cjs`, `aiCapabilityBrokerV4.cjs` | `selectToolsForIntent`, `selectNextCapability` | YES | low if recording IDs/status only |
| `chat <model>` | `api/services/aiProvider.cjs` | `fetchAiProvider` / inner `requestProvider` | YES | high: retries/fallback may create multiple attempts; never capture auth headers by default |
| `pump.ai.provider.attempt` | `fetchProviderWithRetry` | per-attempt loop | YES | medium: parent/attempt semantics and streaming response lifetime |
| `pump.ai.tool.available` | capability catalog | selection/list construction | YES | low; record count and capability IDs, not full schemas by default |
| `execute_tool <tool>` | `api/routes/ai/executor.cjs` | `executeToolCall` | YES | medium/high: args/results and write confirmation boundary |
| `pump.ai.tool.arguments` | `aiToolProtocol.cjs` | `prepareAiToolCalls`, `parseAiToolArguments` | YES | high: distinguish generated vs validated vs resolved values |
| `pump.ai.tool.execute` | executor maps | `TOOL_EXECUTORS[executorKey]` | YES | medium: avoid duplicate spans with HTTP auto-instrumentation |
| `pump.ai.internal_api` | `internalApiClient.cjs` | `requestJson` | YES | low/medium: method/path/outcome safe; bodies require redaction |
| `pump.ai.evidence.collect` | `aiObservationV3.cjs`, V4 controller | `observationFromToolResult`, `ledger.appendObservation` | YES | medium/high: full tool results may contain sensitive data |
| `pump.ai.verify` | `aiFactReducerV4.cjs`, `aiExecutionEvidence.cjs`, `aiClaimGroundingV4.cjs` | reducer/evidence/claim validators | YES, distinct implementations | medium: record deterministic reason codes, not duplicate payloads |
| `pump.ai.response.compose` | runtime / `aiGroundedAnswerV4.cjs` | `synthesizeVerifiedAnswer`, `composeGroundedAnswerV4` | YES | high: response text may contain customer data; R3 and legacy differ |
| `pump.ai.failed_unverified` | V4 controller/reducer | `failUnverified`, `markOpenRequirementsUnavailable` | YES | low if event contains only requirement ID/reason; must support zero-tool trace |
| `pump.ai.shadow.compare` | `aiShadowComparisonV4.cjs` | `runShadowComparisonSuite` | YES (test-only) | medium: never mix shadow traces with production project without tags |
| `pump.ai.oracle` | `aiArchitectureAcceptanceV4.cjs` | case/oracle evaluation | YES (test-only) | medium: oracle expected values are diagnostic business facts |
| `pump.ai.alias.resolve` | scattered business/recovery helpers | no single shared stage | NO | high: would falsely imply one authoritative alias pipeline |

Recommended parentage is HTTP request → agent → planner/model/tool/internal HTTP/evidence/verify/compose. Provider retry attempts are children of a logical model call. Auto HTTP spans should be linked beneath manual tool/provider spans without recording duplicate bodies.

## 17. OTel / OpenInference Bootstrap Risks

1. **Bootstrap location:** preload before `api.cjs` requires Express/database/provider modules. Production wrapper and test spawns must use the same explicit preload only when tracing is enabled.
2. **Load order:** Node instrumentation patches `require/import`; loading Express, HTTP, native fetch/Undici or provider wrappers first can permanently miss auto spans. OpenInference likewise states instrumentation must run before application code. See [OpenInference JS](https://arize-ai.github.io/openinference/js/) and [OTel JS instrumentation loading](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md).
3. **CJS/ESM:** backend is CJS despite root `type=module`, so a `.cjs` bootstrap with `--require` is the least risky backend choice. ESM/Next instrumentation may require `--import` and an experimental loader hook; do not force one bootstrap model across both processes without validation.
4. **HTTP/Express auto-instrumentation behavior:** it patches core HTTP and Express middleware, adds async context and propagation headers, and can create spans for health checks, internal localhost calls, provider calls and SSE. Risks are span volume, duplicate provider/internal spans, altered timing, context leaks around SSE and tests, and accidental header capture. Use explicit ignore hooks for `/api/health/live`, exporter traffic and selected internal paths; HTTP must be enabled with Express. See [OTel JS instrumentation libraries](https://opentelemetry.io/docs/languages/js/libraries/) and [HTTP instrumentation options](https://github.com/open-telemetry/opentelemetry-js/blob/main/experimental/packages/opentelemetry-instrumentation-http/README.md).
5. **Provider instrumentation:** OpenInference JS has OpenAI SDK instrumentation, but the main project uses native `fetch` against DeepSeek/Kimi OpenAI-compatible endpoints, so it will not automatically create semantic LLM spans. Quotation shares the wrapper; rotor uses direct `https.request`. All require manual LLM semantics unless a supported client is adopted later. No client adoption is recommended in P00.
6. **Manual spans required:** agent invocation, two-stage planning, V4 Broker decision, raw/validated/resolved tool args, entity resolution/discovery, executor result, Observation/Evidence/Fact reduction, `failed_unverified`, claim validation, response composition, online/test shadow and Oracle evaluation.
7. **Fail-open exporter:** initialize tracing behind an explicit enable flag; catch bootstrap/export errors, use bounded batch queues/timeouts, drop telemetry on queue/export failure, and never await exporter success on the AI response path. SDK shutdown should be best-effort during process termination only.
8. **Phoenix unavailable:** application/provider/business API behavior must not depend on collector health. No readiness/liveness dependency, no retry loop on the request path, no Phoenix call in verifier, and no propagation exception allowed to fail a request. Export failures should be rate-limited diagnostic logs only.
9. **Diagnostic content flag:** place policy in the bootstrap/runtime observability config and enforce centrally in the span serializer/processor. Default false; changing it should not change prompt, router, executor or verifier behavior.
10. **Tests off:** default tracing disabled under `NODE_ENV=test` and `NODE_TEST_CONTEXT` unless a dedicated observability integration test explicitly enables an in-memory exporter. Real Shadow should use a separate project/tag and redacted content policy.

OpenTelemetry's Node auto-instrumentation can be preloaded, but only manual spans can represent the current semantic AI graph. Phoenix should receive standard OTLP and must remain a replaceable backend, not a business dependency.

## 18. Known V4 Failures — DO NOT FIX

- R4-B is not green. The current one-case report is `FAIL` with `UNSUPPORTED_BUSINESS_CLAIM`; full suite was not rerun in P00.
- Exact Entity Identity is broken end-to-end for the frozen `v750-tokoy-` example because the provider drops the trailing hyphen in the tool argument before resolver entry.
- Resolver exact/fuzzy separation tests pass, but that does not repair or prove preservation from raw user text to resolver input.
- `800平刀` deterministic Fact/API tests pass while P00 real-provider shadow fails all three paths.
- P00 simple inventory: Legacy and V4 Investigation pass, V4+R3 selects/investigates coil data and ends `needs_clarification`, so expected part inventory claim is unsupported.
- The current V4+R3/current-cost evidence includes downstream cross-entity ambiguity/budget symptoms after the first identity divergence.
- Full test suite fails because `.guardian/config.yaml` is absent; lint fails because of an unused import in the dirty resolver file.
- Guardian is neither configured in the checkout nor available as `guardian`/`adf` command.

No prompt, planner, routing, resolver, normalization, executor, API, verifier, Oracle, Shadow, Guardian or fallback change was made to address these items.

## 19. P01 Preconditions

```text
P01_READY=YES
```

This means only that startup/deployment/storage/network boundaries are clear enough to design Phoenix infrastructure safely. Before P01 execution:

1. Preserve `V4_CODE_BASELINE_COMMIT` and the dirty-worktree inventory; P01 must not absorb or rewrite V4 behavior changes.
2. Use a separate observability directory/compose and dedicated persistent volume; do not containerize or rewire the application in P01.
3. Pin Phoenix/Postgres versions, choose retention/backup, and verify host ports 6006/4317 are free.
4. Bind UI/collector to loopback or trusted network and define authentication/tunnel policy before broader access.
5. Keep application health independent of Phoenix and do not add SDK/bootstrap/instrumentation until the later instrumentation phase.
6. Define resource budget and rollback for Mac Mini; a separate host remains optional if Phoenix load or data isolation requires it.

P01 blockers: none for infrastructure design. V4 correctness failures, missing Guardian and dirty user worktree remain explicit constraints, not blockers to an isolated Phoenix infrastructure design.

## 20. Audit Limitations

- Effective V4 code is not represented by a clean commit; part of it is uncommitted user work. HEAD plus this report is not a standalone reproducible source snapshot.
- Full R4-B and five-run Repeat Stability were not executed because they are materially costly and the default runner would overwrite an existing user report.
- P00 executed two focused real-provider cases only. Provider nondeterminism means those results are evidence for this run, not a stability claim.
- The Exact Identity real failure uses the pre-P00 current handoff/report artifact plus code-level verification; P00 did not rerun `current-cost-1`.
- Guardian status is limited to current checkout and PATH inspection; there is no `.guardian` configuration or installed command to exercise.
- Production Mac Mini, public endpoint and NAS were not contacted. Deployment conclusions come from current executable scripts/plists, not a live production inspection.
- Phoenix/OpenInference/OTel conclusions are design recommendations based on current official documentation; no package compatibility, container image, port or resource test was performed.
- No secrets were printed. P00 verified only whether a required provider was configured, not credential values.

Final boundary confirmation:

```text
Business Code Changed=NO
AI Behavior Changed=NO
Dependencies Changed=NO
Database Schema Changed=NO
Business Data Changed=NO
Observability Implemented=NO
```
