# M4-3A-R2 DeepSeek Provider Diagnostics

## Scope and safety

This diagnosis uses the same experiment dotenv loading and `deepseek-chat` override as M4-3A. It adds only experiment diagnostics and retry observation. Business Agent, Policy Agent, Grounding prompt, frozen cases, Ontology, resolver semantics, production runtime, and database schema were not changed.

## Resolved configuration

| Field | Result |
| --- | --- |
| Provider | DeepSeek |
| Model | `deepseek-chat` (experiment-forced, matching M4-3A) |
| Base URL | `https://api.deepseek.com` |
| Hostname | `api.deepseek.com` |
| API key | Present; value not recorded |
| Base URL source | Registry default; neither process environment nor `.env` overrides it |
| API key source | `.env`; value not recorded |
| Proxy | None of the audited proxy variables was present |
| Transport | Node global `fetch`; no custom dispatcher, proxy agent, or experiment wrapper |

M4-2M and M4-3A both use `scripts/ai-experiments/business-policy-intent/modelClient.cjs`, the same `{ ...process.env, ...dotenv }` loading order, `resolveProviderConfig('deepseek', env)`, and `fetchAiProvider`. The only M4-3A-specific setting remains the pre-existing experiment override `DEEPSEEK_MODEL=deepseek-chat`.

## Sandbox diagnosis

The same Node runtime, without elevated networking, produced:

- `dns.lookup(api.deepseek.com)`: `ENOTFOUND`, errno `-3008`, syscall `getaddrinfo`.
- `resolve4` and `resolve6`: `ECONNREFUSED` from the sandbox resolver.
- `nslookup`: failed while binding a socket with `Operation not permitted`.
- HTTPS: no response; nested cause `ENOTFOUND api.deepseek.com`.
- Project provider client: `AI_PROVIDER_NETWORK_ERROR`; nested error chain retained the same `ENOTFOUND / getaddrinfo / api.deepseek.com` evidence.
- Retry contract: attempt 1 and attempt 2 were observed through the existing `onProvider` retry notifications; attempt 3 is the final failed request and therefore emits no retry notification.

This is `DNS_RESOLUTION_FAILURE` in the sandbox, not an invalid base URL, proxy setting, authentication error, or Grounding failure. Full sanitized evidence is in [M4-3A-R2-Provider-Diagnostics-Sandbox.json](M4-3A-R2-Provider-Diagnostics-Sandbox.json).

## Post-recovery verification

With the environment's elevated network permission, using the identical resolved configuration:

| Check | Result |
| --- | --- |
| Node DNS lookup | PASS: IPv4 and IPv6 records returned |
| Node DNS resolve4 | PASS |
| Node DNS resolve6 | PASS |
| System DNS | PASS (`nslookup` returned an address) |
| HTTPS | PASS; response received with HTTP 401, which proves DNS/TLS/HTTPS reachability without treating authentication as success |
| Project provider client | PASS; exact response `OK` |

No configuration change was applied. The recovery is use of the permitted network execution environment; it does not change the repository, `.env`, provider registry, or production configuration. Post-recovery evidence is in [M4-3A-R2-Provider-Diagnostics.json](M4-3A-R2-Provider-Diagnostics.json).

## Frozen recovery smoke

The required three-case recovery smoke used the unchanged M4-3A harness, prompt, fixture, and evaluator:

| Case | Result | Evidence |
| --- | --- | --- |
| G-01 | PASS | Concept question was `NOT_REQUIRED`; no resolver call |
| G-03 | PASS | `12-120` was grounded as coil and formal resolver returned two candidates as `MULTIPLE` without binding an ID |
| G-12 | FAIL | Grounding model wrote `NOT_REQUIRED`, emitted `Language Target: 木箱 | recipe`, and did not preserve unresolved reference `这个` |

The raw Business Memo, Policy Memo, Grounding Memo, resolver input/output, and timings are retained in [M4-3A-R2-Three-Case-Recovery-2026-10-01.json](M4-3A-R2-Three-Case-Recovery-2026-10-01.json).

## Decision

Provider connectivity is restored and is no longer a blocker. M4-3A remains **REWORK** because G-12 is a confirmed Grounding semantic failure under the frozen prompt and oracle. Per the frozen-smoke rule, the complete M4-3A rerun was not started: its prerequisite three-case smoke did not pass. No semantic prompt or case was changed to accommodate the failure.
