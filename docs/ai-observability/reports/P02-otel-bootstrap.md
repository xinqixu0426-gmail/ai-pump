# P02 Fail-Open OTel/OpenInference Bootstrap

## 1. Executive Result

P02 完成。应用现有 CommonJS 启动入口在加载 Express 之前同步执行隔离的 Observability bootstrap；功能默认关闭，只有 `AI_OBSERVABILITY_ENABLED=true` 精确值启用。Phoenix 不可用时，真实 API 仍能启动且健康端点可用。P02 只生成独立 synthetic smoke span，未启用 HTTP、Express、LLM、Tool、Entity 或 Verifier instrumentation。

`P03_READY=YES`。这只表示 transport/bootstrap 边界已满足进入 P03 的前置条件，不表示 V4 AI 已修复。

## 2. P01 Baseline

- V4 code baseline: `53e918587811aa01aa47acf088331f4b020c6fb7`
- P00 report commit: `2a100ad7166dc31e3b50e3e4abce996c89e1a076`
- P01 commit / P02 start commit: `9a265a4ab69d0d83c5b8651e2d0f276eba9eb85e`
- Phoenix image: `arizephoenix/phoenix:version-20.6.0`
- Phoenix endpoint: `http://127.0.0.1:6006`
- Frozen deterministic baseline: `1732/1733`, only `.guardian/config.yaml` missing.
- Worktree clean at start: `NO`. All pre-existing modified and untracked AI/V4 files were preserved and excluded from the P02 commit.

## 3. Dependency Decision

The npm registry reported `@arizeai/phoenix-otel@2.2.0` as the current stable version. Its declared engine is Node `>=18`; the project runtime is Node `v24.16.0`. The installed package publishes both CommonJS (`dist/src/index.js`) and ESM (`dist/esm/index.js`) exports, so no module-system conversion or dynamic-import wrapper is required.

Only `@arizeai/phoenix-otel` was added as a direct dependency. No HTTP/Express auto-instrumentation, provider instrumentation, Collector, or additional observability backend was added.

## 4. Installed Versions

- `PHOENIX_OTEL_PACKAGE_VERSION=2.2.0` (direct, exact pin)
- `OPENINFERENCE_CORE_VERSION=2.6.1` (transitive lockfile resolution)
- `TRANSITIVE_OTEL_VERSION=2.11.0` for `@opentelemetry/sdk-trace-node` and the top-level `@opentelemetry/sdk-trace-base`
- `@opentelemetry/api=1.9.1`
- OTLP protobuf exporter `0.220.0` also resolves internal OTel `2.9.0` packages; this is package-owned transitive resolution, not an application direct dependency.

The installed version's `README.md`, `docs/`, TypeScript source, package exports, `register()` implementation, masking types, and lifecycle methods were inspected before implementation.

## 5. Bootstrap Location

Startup path:

```text
npm run api / node api.cjs
→ require('dotenv').config()
→ api/services/observability.cjs initializeObservability()
→ existing Express and application initialization
```

The hook is immediately after dotenv loading and before `require('express')`. Disabled mode returns before loading `@arizeai/phoenix-otel`. Shutdown calls `safeShutdown()` inside the existing graceful server-close callback.

## 6. Module-System Compatibility

The root package declares ESM, while the backend entrypoint and services use `.cjs`. Phoenix OTel 2.2.0 explicitly provides a `require` export. Direct CommonJS loading was verified by unit tests and live startup. No backend ESM conversion, route refactor, or import-order expansion was needed.

## 7. Feature Flags

| Setting | Default | Behavior |
| --- | --- | --- |
| `AI_OBSERVABILITY_ENABLED` | `false` | Only exact lowercase `true` enables. Invalid values remain disabled with a sanitized warning. |
| `AI_TRACE_CONTENT` | `metadata` | Accepts `off`, `metadata`, `diagnostic`. Invalid values fall back to the more conservative `off`. P02 records no business content in any mode. |
| `AI_OBSERVABILITY_PROJECT` | `pump-ai-v4-baseline` | Phoenix project name. |
| `PHOENIX_COLLECTOR_ENDPOINT` | `http://127.0.0.1:6006` | Must be a valid HTTP(S) URL; invalid configuration degrades without stopping the application. |

The existing `.env.example` convention was extended without adding secrets.

## 8. Privacy Defaults

P02 does not create any business spans. The module exposes a future OpenInference masking policy using only options confirmed in OpenInference Core 2.6.1 source:

- `hideInputs`, `hideOutputs`
- `hideInputMessages`, `hideOutputMessages`
- `hideInputText`, `hideOutputText`, `hideInputImages`
- `hidePrompts`, `hideLLMTools`, `hideEmbeddingVectors`

All are `true`; `base64ImageMaxLength` is `0`. Phoenix `register()` does not accept masking options, so P02 does not pass invented options to it. This policy is configuration plumbing for a future `OITracer`; it does not authorize content capture when `diagnostic` is selected.

## 9. Fail-Open Design

- Configuration parsing, package loading, and `register()` are contained by the bootstrap boundary.
- Invalid endpoint configuration produces state `degraded` and returns normal control.
- Registration failure produces a sanitized warning and returns normal control.
- Flush and shutdown failures return `false` and never escape into business startup/shutdown.
- Warnings contain only an error type, collector host, and observability state. Raw payloads, credentials, prompts, and error objects are not logged.
- No custom retry loop was added. The package-owned bounded OTel batch processor behavior is retained.
- `instrumentations: []` is explicit. No automatic framework/provider instrumentation package is installed.

## 10. Synthetic Smoke Trace

- Script: `scripts/run-observability-smoke.cjs`
- Span name: `pump.observability.smoke`
- Project: `pump-ai-p02-smoke`
- Trace ID: `f71e47bc8e1294e49dfa85c92756f069`
- Span ID: `2205b9890b6bc0d1`
- Attributes: `test.synthetic=true`, `phase=P02`, `project.identifier=pump-ai-p02-smoke`

The script creates no AI request, reads no business data, and explicitly flushes and shuts down only its diagnostic provider.

## 11. Phoenix-Down Verification

Phoenix was stopped with the existing Compose file; its volume was not removed. With Observability enabled, `scripts/verify-observability-startup.cjs` launched the real `api.cjs` entrypoint using `NODE_TEST_CONTEXT=1`, an isolated temporary database, and port `3192`.

- Application startup: `PASS`
- `GET /api/health/live`: `PASS`
- Offline synthetic exporter flush: contained, returned `false`, no crash or indefinite wait
- Deterministic registration/flush/shutdown failure containment tests: `PASS`

Phoenix was restarted and returned `OK` from `/healthz`; its container status was healthy.

## 12. Disabled Verification

Phoenix before disabled smoke: `0 spans / 0 traces`.

With `AI_OBSERVABILITY_ENABLED=false`, bootstrap returned status `disabled`, did not load/register Phoenix OTel, created no span, and returned successful flush/shutdown no-ops. Phoenix after disabled smoke remained `0 spans / 0 traces`.

`DISABLED_NO_EXPORT=PASS`.

## 13. Enabled Verification

With Phoenix healthy and Observability enabled, the synthetic smoke span was exported and found in Phoenix under `pump-ai-p02-smoke`. A separate real application startup and liveness check also passed with Observability enabled.

After that application check, Phoenix still contained exactly the one synthetic span. No application startup, HTTP, Express, AI, LLM, Tool, Entity, Verifier, or business request span appeared.

## 14. Regression Comparison

Command: `AI_OBSERVABILITY_ENABLED=false npm test` using the existing isolated test runner.

- Current result including eight new passing P02 tests: `1740 passed / 1741 total`
- Frozen baseline: `1732 passed / 1733 total`
- Delta: exactly eight new passing P02 tests
- Same known failure: `YES` — `businessTerminologyContract.test.cjs` cannot read missing `.guardian/config.yaml`
- New regression introduced: `NO`
- Real AI was not called.

## 15. Phoenix Trace Inspection

The Phoenix SQLite store was queried after export. The only span row was `pump.observability.smoke`; its attributes were exactly the three synthetic metadata fields listed above. No prompt, assistant output, system prompt, tool arguments/results, business payload, customer data, credentials, authorization value, or database content was present.

No project other than the pre-existing `default` project and `pump-ai-p02-smoke` received a P02 span.

## 16. Files Changed

- `.env.example`
- `api.cjs`
- `api/services/observability.cjs`
- `package.json` (P02 commit contains only the exact dependency line; pre-existing `test:ai-shadow` work remains uncommitted)
- `package-lock.json`
- `scripts/run-observability-smoke.cjs`
- `scripts/verify-observability-startup.cjs`
- `tests/observability.test.cjs`
- `docs/ai-observability/reports/P02-otel-bootstrap.md`

No AI business logic, prompt, routing, entity, tool, verifier, business API, database schema, business data, Docker architecture, Oracle, Shadow, or Guardian file was changed by P02.

## 17. Known Limitations

- P02 intentionally has no AI/LLM/Tool/Entity/Verifier/business span.
- The privacy configuration is ready for a future OpenInference `OITracer`, but no such business tracer exists in P02.
- Phoenix OTel owns its standard bounded batch/export behavior; P02 adds no retry controls or Collector.
- The working tree contained substantial pre-existing V4/AI edits. They were preserved and excluded from the P02 commit.
- The frozen Guardian-related regression remains deliberately unfixed.

## 18. P03 Preconditions

- Phoenix healthy at completion: `PASS`
- Dependency/runtime compatibility: `PASS`
- Bootstrap isolated and fail-open: `PASS`
- Default disabled and disabled no-export: `PASS`
- Enabled synthetic export: `PASS`
- Synthetic content inspection: `PASS`
- Phoenix-down application startup and health: `PASS`
- Auto HTTP/Express/LLM/Tool/Entity instrumentation absent: `PASS`
- Frozen regression behavior preserved: `PASS`
- Business behavior/database unchanged: `PASS`

`P03_READY=YES`

STOP — WAIT FOR SUPERVISOR REVIEW.
