# Pump AI V5 Contracts V1

Status: V5-A isolated contract baseline

Constant: `V5_CONTRACT_VERSION=1`

Implementation: `api/services/ai-v5/contracts.cjs`

These contracts are not imported by the production dispatcher/runtime. They are a deterministic shadow/test boundary only. They do not execute tools, resolve entities, verify evidence, or route requests.

## Contract Version

Every V5 Task and supporting Entity/Tool contract carries `version: 1`. Validation rejects a missing, invalid, or unknown version; it never assumes that an existing object belongs to the current version. Constructors may supply version 1 only while creating a new V5 object. Validators require the version already present.

Top-level task IDs are orchestration identities. `taskId` is not a request ID, operation ID, trace ID, audit ID, or business entity ID. Correlation may be added later without merging those meanings.

## Task Contract

```text
V5Task
  version                 1
  taskId                  non-empty orchestration ID
  state                   one V5 state
  createdAt               ISO timestamp
  updatedAt               ISO timestamp, not before createdAt
  intent                  object | null
  entityContext           EntityReference[]
  requestedCapability     string | null
  execution
    toolRequest            V5ToolRequest | null
    toolResult             V5ToolResult | null
  verification            object | null
  failure                 object | null
  metadata                serializable structural object
  stateHistory            TransitionRecord[]
```

Not-yet-implemented capability, execution, verification, and failure data are represented as `null` or empty collections. The contract does not invent a capability, evidence record, policy decision, or verification result.

Every constructed object is a deep immutable copy. Inputs remain owned by the caller, later caller mutation cannot modify the contract, and contract validation accepts only JSON-compatible plain objects, arrays, strings, finite numbers, booleans, and null. Circular values, functions, symbols, bigint, class instances, undefined values, and non-finite numbers are rejected.

## Entity Identity Contract

```text
EntityReference
  version
  entityType
  rawMention
  normalizedMention       string | null
  canonicalEntityId       string | finite number | null
  resolutionReceiptRef    string | null
  aliasSource             string | null
```

Rules:

- `rawMention` is required, non-empty, copied exactly, and immutable.
- `normalizedMention` is a separate derived field. It may differ from `rawMention`; it cannot replace or overwrite it.
- `canonicalEntityId` is separately nullable until a future formal resolution step supplies it.
- A canonical ID is not inferred from raw or normalized text.
- Empty/invalid raw mentions and invalid field types fail validation.
- V5-A defines the ownership boundary only; it does not call or change the V3 resolver or normalization logic.

The contract can therefore retain both `rawMention="v750-tokoy-"` and `normalizedMention="v750-tokoy"` without loss. The same rule applies to CJK, numeric-like, mixed-case, and punctuation-heavy names.

## ToolRequest

```text
V5ToolRequest
  version
  taskId
  toolName
  capability              string | null
  rawArguments            immutable plain object
  validatedArguments      immutable plain object | null
  entityRefs              EntityReference[]
  riskClass               L0 | L1 | L2 | L3 | L4 | L5
  validationStatus        raw | validated
  executionReady          derived boolean
```

`rawArguments` is the model-produced stage. `validatedArguments` is a distinct semantic and object stage. A raw request is never execution-ready. A request is execution-ready only when validation status is explicit, validated arguments exist, and a capability is present. The state machine additionally requires that the task capability and request capability match.

V5-A does not implement schema, business, entity, or policy validation. It only provides the contract that future deterministic validators must satisfy. No V5 tool executor exists.

## ToolResult

```text
V5ToolResult
  version
  taskId
  toolName
  status                   success | failure
  data                     serializable value | null
  error                    V5ToolError | null
  operationRefs            serializable references[]
```

Status is explicit and cannot be inferred from truthiness. `success` forbids an error. `failure` requires a structured error and does not expose success data.

## ToolError

```text
V5ToolError
  version
  classification
  code
  retryable
  safeMessage              string | null
  operationRefs            serializable references[]
```

Stable V1 classifications:

```text
VALIDATION_ERROR
POLICY_BLOCKED
EXECUTION_ERROR
TIMEOUT
NOT_FOUND
AMBIGUOUS_ENTITY
INTERNAL_ERROR
```

These classifications do not alter or replace V4 errors. They are V5 shadow contracts only.

## Validation Semantics

- Validation is deterministic, synchronous, side-effect free, and throws `V5ContractValidationError` with code `V5_CONTRACT_VALIDATION_FAILED`.
- Constructors build new version-1 values. Validators reject unknown/missing versions.
- Validation never normalizes an entity mention, chooses a capability, changes a tool argument, or auto-corrects invalid data.
- `validateToolRequestForExecution()` returns an explicit valid/invalid result and never turns a raw request into a validated request.
- Failed validation cannot partially mutate caller data.

## No-Fabrication Rule

The V4-to-V5 projection is one-way and best-effort. Missing source facts remain `null`, empty, or an explicit `*_NOT_AVAILABLE` reason. In particular it never reconstructs raw entity content, creates canonical IDs, equates an observed tool name with a capability, marks arguments validated, creates evidence, or claims verification occurred.

The P06 dataset contains safe structural metadata only. Its 15 projections are therefore intentionally partial rather than falsely complete.
