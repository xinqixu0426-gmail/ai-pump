# Pump AI Trace Contract V1

> 历史观测基线：本文的 V1 指 P05 阶段 Trace Schema，不是“水泵ai管理系统V1”发布版本。旧实体路由/验证链已退出默认助理，以下阶段顺序不能作为当前运行要求。保留原始定义用于追溯；当前链路见 [私人 AI 助理](../ai-assistant.md)，实际观测字段以 `api/services/observability.cjs` 为准。本目录 reports 为历史证据，不据此恢复已撤除框架。

Status: locked by P05 after integrity verification
Schema version: `1`
Root attribute: `pump.ai.trace.schema_version=1`

## Span structure

Exactly one root is allowed per traced assistant execution:

```text
invoke_agent pump_factory_assistant  [AGENT]
```

Allowed descendants reflect current real code boundaries only:

```text
chat <actual_model>                   [LLM]
execute_tool <actual_tool_name>       [TOOL]
pump.ai.entity.normalize              [CHAIN]
pump.ai.entity.resolve                [CHAIN]
pump.ai.route                         [CHAIN]
pump.ai.verify                        [CHAIN]
```

`pump.ai.entity.extract` is not part of V1 because the current application has no independent extraction stage. Business API, database, HTTP, and Express spans are also outside V1.

Every descendant must share the root trace ID, reference an existing parent in the same trace, start no earlier than the root, and end no later than the root. A normalization span may be nested under entity resolution when normalization genuinely occurs inside that resolver. No span may be emitted after the root ends.

For a complete deterministic normal path, the canonical observed order is:

```text
AGENT start
→ LLM #1
→ entity normalization where invoked
→ route
→ TOOL
→ LLM #2
→ verify
→ AGENT end
```

Stages absent from a particular real execution are not fabricated to satisfy the diagram.

## Naming and semantic conventions

- Root name is exactly `invoke_agent pump_factory_assistant`.
- Model names use `chat <actual_model>`.
- Executed tools use `execute_tool <actual_tool_name>` only after actual selection/preparation.
- OpenInference span kinds remain `AGENT`, `LLM`, `TOOL`, or `CHAIN` as listed.
- Custom attributes use only `pump.*` or `pump.ai.*`.
- `gen_ai.*` is used only for fields defined by the installed OpenTelemetry semantic conventions: operation name, request model, provider name, and request stream flag.

## Safe attributes

V1 permits bounded structural metadata already defined by P03/P04:

- Agent runtime/route/stream flag and schema version;
- model provider/model/operation/stream flag and tool-definition count;
- tool name, executor/access/capability, argument field names/count, status and result type;
- entity type, length/punctuation deltas, candidate count, match flags/path and stable ID hash;
- route source/decision/tool/executor/domain/access/count;
- verification decision/status/counts/early-exit and pre-tool signal;
- sanitized error type;
- safe request, operation and audit correlation IDs or their policy-approved hashes.

All attributes emitted by the application tracing helpers pass through the central sanitizer before export. Strings, arrays, and object inspection are bounded by the constants in `api/services/observability.cjs`.

## Correlation rules

- A normalized existing HTTP request ID may appear on the Agent as `pump.request.id`.
- A nonconforming request ID may appear only as `pump.request.id_hash`; raw and hash must not coexist.
- Existing operation/audit IDs may appear on Tool spans. Multiple IDs use bounded arrays and counts; IDs are never fabricated or overwritten.
- Read tools with no existing operation ID retain an explicit correlation gap.
- Trace/span IDs remain telemetry-only and are not returned through application API/SSE contracts or written to business storage.

## Content modes

| Mode | Contract |
| --- | --- |
| `off` | Span name, kind, timing, status, and root schema version only. |
| `metadata` | Approved safe structural and correlation metadata; no business/content values. |
| `diagnostic` | Same content boundary as metadata, with bounded safe structure such as counts, lengths, deltas, types, statuses and approved hashes. Raw business content remains disabled. |

## Forbidden content

V1 never traces:

- authorization, cookies, passwords, API keys, tokens, sessions, database credentials, or private keys;
- email, phone, WhatsApp, address, contacts, customer identity, or consignee data;
- user/system prompts, conversation history, assistant response text, or documents;
- raw/normalized entity strings, candidate names, or raw business IDs;
- tool argument values or tool result payloads;
- costs, prices, inventory quantities, BOM/recipe/order/supplier/customer content;
- business database contents.

Privacy failure is fail-open for the application and fail-closed for telemetry: unsafe attributes are omitted, while the business result/error semantics remain unchanged.
