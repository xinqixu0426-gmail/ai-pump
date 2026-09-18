# V5 Task Interpreter Protocol V2

## Status and scope

Protocol V2 is an internal model protocol for the read-only V5 shadow interpreter. It projects into the unchanged `V5TaskInterpretation` Contract V1 and does not route production requests, execute Tools, call business APIs, write data, or answer users.

V1 and V1.1 required the model to independently emit several coupled semantic enums and to rewrite an entity candidate. Their frozen evaluations showed semantic disagreement, non-verbatim entity output, same-input inconsistency, and false blocks. Protocol V2 removes those degrees of freedom instead of adding case-specific prompt rules.

## Versions and frozen model settings

- Internal protocol: `2`
- Prompt version: `2`
- External interpretation contract: `1` (unchanged)
- Task Class Catalog: `1`
- Provider/model: DeepSeek / `deepseek-v4-flash`
- Temperature: `0`
- `top_p`: omitted
- Response format: `json_object`
- Maximum output tokens: `512`
- Retry count: `0`
- Maximum calls per shadow request: `1`

## Task Class Catalog

The catalog is generated deterministically from the existing Capability Registry entries already marked exposable in V5-B plus the frozen interpreter semantic taxonomy. Equal `(domain, operation, requiredEntityTypes)` tuples collapse into one class. Sorted tuples receive stable opaque refs such as `tc_001`.

The model view contains only `classRef`, a semantic description, and class-local entity slot/type refs. It contains no Tool names, Tool schemas, Tool arguments, capability IDs, business values, or frozen evaluation examples. Catalog validation rejects duplicate refs, stale domain/operation/entity IDs, non-capability tuples, nondeterministic output, and Tool-name leakage.

A class ref never bypasses routing. Projection resolves the class into domain, operation, and constrained entity type; the existing deterministic Capability Router then independently validates that tuple.

## Source Span Catalog

The Source Span Catalog is generated from the raw request without normalization, case conversion, punctuation stripping, spelling correction, translation, or numeric coercion. It uses Unicode word segmentation, bounded adjacent-segment combinations, quoted substrings, and generic identifier-like runs that preserve `-`, `_`, `+`, `.`, and `/`.

Every entry contains an opaque `spanRef` and exact source boundaries. Its transient model view also contains the exact substring so the model can select a ref. Span text is never persisted to Phoenix, logs, evaluation datasets, or reports.

- Maximum spans: `128`
- Maximum adjacent segments: `6`
- Duplicate `start/end` pairs: removed
- Ordering: start position ascending, then length descending
- Overflow: `SPAN_CATALOG_LIMIT`, fail closed

Numeric-looking spans remain strings. Exact forms such as punctuation-ending identifiers therefore remain available without adding business keywords or frozen-case special cases.

## Protocol schema

The model may output only:

```json
{
  "protocolVersion": 2,
  "taskClassRef": "tc_001",
  "entitySelections": [
    { "slotRef": "slot_01", "spanRef": "sp_001" }
  ],
  "needsClarification": false
}
```

Unknown or extra fields fail closed. The model cannot output domain, operation, entity type, candidate text, raw or normalized mention, capability, Tool, answer, or reasoning. Invalid class, slot, or span refs and missing required selections are rejected; they are never repaired or guessed.

## Projection to Contract V1

After strict protocol validation, deterministic projection performs:

1. `taskClassRef` to domain and operation.
2. class-local slot to ontology entity type.
3. `spanRef` to the exact transient source substring.
4. construction and validation of the existing `V5TaskInterpretation` Contract V1.
5. unchanged exact Source Anchor validation.
6. existing deterministic Capability Router and bounded Tool exposure.

There is no reverse adapter and no V5 execution.

## Identity and privacy guarantees

The model cannot rewrite entity identity because it does not own a candidate-text field. The final `rawMention` is obtained only from the selected catalog span, then revalidated by the unchanged exact Source Anchor. Catalog generation is lexical and generic; it contains no rule for any product, identifier, or frozen case.

Raw request and span text exist only in transient model input and in-memory projection. Persisted evidence is restricted to refs, match/status booleans, safe reason codes, fingerprints, trace IDs, and shadow task IDs.

## One-shot evaluation freeze

Before the one formal frozen-corpus run, deterministic tests and the full regression passed and the implementation was frozen with these SHA-256 values:

- Prompt V2: `24b2f09d94e86960e328d5aa63ac66e3439f4f9a39152a9c6564adf555b585d3`
- Task Class Catalog: `c298bcf127030602b5f82cdcc8aed61554a789aacc1b082ade70eed1ca5d0ef9`
- Source Span code/config: `00b1331e6e8c3ffc8985fb268b861dcbb066d3e409aeda43f1ceef43f3821fd8`
- Protocol V2 implementation/schema: `da3a2c98858d16fd6ebe9008d7cd933a1bf1d5266ea876289fa33ae9d81e20ad`
- Model settings: `2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398`
- Input envelope: `a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded`

The same 15 frozen paths, five source groups, four input fingerprints, and frozen expected results are used. After the formal run begins, interpreter implementation, prompt, catalogs, settings, Contract, Router, Registry, Ontology, and Source Anchor are frozen. Results are reported as observed; no post-result tuning or second formal run is permitted.

