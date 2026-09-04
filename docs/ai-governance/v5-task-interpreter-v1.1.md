# V5 Task Interpreter V1.1

## Scope and versioning

- Interpreter version: `1`
- Task Interpretation Contract version: `1` (unchanged)
- Prompt version: `1.1`
- Model: existing DeepSeek provider, `deepseek-v4-flash` (unchanged)
- Model calls: at most one per eligible shadow request
- Retry: `0`
- Tools exposed to the Interpreter: none
- Production routing, Tool execution, Business API calls, writes, and user-visible answers: out of scope

V1.1 is the one-shot revision authorized after the P15R-A audit. The exact source-anchor implementation, Capability Registry IDs, and Business Ontology IDs remain unchanged.

## Prompt V1.1

The system instruction permits only the Contract V1 object: `version`, `domain`, `operation`, `entityCandidates`, `needsClarification`, and `reasonCodes`. Entity candidates permit only `entityType` and `candidateText`. It prohibits reasoning, explanations, answers, Tool names, capability IDs, confidence prose, and all extra fields.

The instruction contains:

- concise definitions for every current domain, operation, and ontology entity type;
- general contrast rules separating business owner, action, and referenced object;
- a strict character-for-character entity-copy rule;
- an explicit instruction to omit an uncertain candidate and request clarification instead of emitting a near match;
- the current allowed route tuples and a structural JSON shape.

It contains no frozen-case string and no keyword-based routing rule.

`PROMPT_V1_1_SHA256=e06a462603eb87ed0161f7ad5d234b842f60ee3111fb9b11f82f9ab0b03020ac`

## Semantic taxonomy

The isolated semantic taxonomy is implemented in `api/services/ai-v5/taskInterpreterSemantics.cjs`. Its validator requires an exact set match against the current Capability Registry domains and operations and the Business Ontology entity types. Missing, stale, or duplicate IDs fail deterministically. No ID is added or changed.

Definitions are mechanism-level semantics. They do not encode `800平刀`, `v750-tokoy-`, or any other frozen input.

`SEMANTIC_TAXONOMY_SHA256=d2ae5fd41ae52d7c6f9ea4501e9d6c1b59ad2d42733219cd829fb250347914bc`

## Safe input context

`V5InterpreterInputEnvelope` contains the transient raw user request, an optional safe pre-routing context, and a stable evaluation-only SHA-256 fingerprint. The raw request is required for interpretation and source anchoring but is never persisted to evaluation data, reports, trace attributes, or ordinary logs.

The only currently approved context is validated order-page structure:

```json
{"surfaceType":"order","view":"requirements|readiness|execution|items|purchase|todos"}
```

The order resource ID is intentionally omitted. Downstream V4 Tool, capability, resolver, normalization, verification, answer, and business-result facts are rejected. Missing context is represented as `null` / `NOT_AVAILABLE`; it is never fabricated. The frozen 15-path corpus supplies no eligible page context.

`INPUT_ENVELOPE_IMPLEMENTATION_SHA256=a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded`

## Deterministic model settings

- `temperature=0`
- `top_p`: omitted (not jointly tuned with temperature)
- `response_format={"type":"json_object"}`
- `max_tokens=512`
- DeepSeek thinking: disabled
- streaming: false
- retry count: 0

These parameters are supported by the current provider client and are passed without adding a provider or dependency. See the official DeepSeek [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) and [JSON Output guide](https://api-docs.deepseek.com/guides/json_mode/).

`MODEL_SETTINGS_SHA256=2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398`

## Source anchor and validation

The deterministic anchor remains exact and unchanged:

- zero matches: invalid entity reference;
- one match: anchored to that exact source substring;
- more than one match: ambiguous entity reference.

No fuzzy matching, punctuation repair, normalization fallback, case conversion, or numeric coercion is introduced. Model output passes strict JSON/schema validation, enum and tuple validation, entity-type validation, then source anchoring. Any failure closes the shadow interpretation without affecting V4.

## One-shot evaluation rule

Before the formal V1.1 real evaluation, Prompt, semantic taxonomy, model settings, and input-envelope hashes are frozen. The frozen corpus remains 15 paths, five source groups, and four distinct Interpreter-input fingerprints. Frozen expected results remain unchanged. After the formal evaluation starts, implementation, Prompt, semantics, context, settings, Contract, Router, Ontology, and Registry may not change; only the safe evaluation dataset and report may be written.
