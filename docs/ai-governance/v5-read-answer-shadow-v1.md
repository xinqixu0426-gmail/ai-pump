# V5 Read Answer Shadow V1 — runtime handoff preflight blocked

## Current status

P16-B2 stopped at runtime-value handoff preflight on frozen B1 commit `62e89d2d076c7265747d39b6b555ac20eeb39041`. The Composer, Prompt V1, Answer Contract, validators and answer-shadow flag are **not implemented**. Version1 is the requested design target, not an available runtime version. Formal answer evaluation runs remain zero.

The frozen read-execution implementation remains authoritative and unchanged. Its15/15 execution/comparator result does not certify arbitrary claims in an answer.

## Required boundary

The intended answer layer is default-OFF and shadow-only, requiring all three shadow/execution/answer flags. It may consume only request-local verified facts after execution success and verification PASS; it has no Tools, API client, write authority or user-response channel. The requested draft contains answerText and evidence-linked claims; numeric/identity/text consistency must be deterministic, and unknown references or unsupported facts must reject the draft without retry.

These requirements are recorded here, not claimed implemented or tested.

## Verified scope gap

P16-B1 resolved the price evidence gap: `price.current` is a DIRECT_FACT with independent formal readback verification and a certified runtime-only value handoff. All 3 price paths passed. This remains valid and unchanged.

The remaining answer requirements are `inventory.quantity` (6 paths), `coil.inventory` (3) and `recipe.cost.preview` (3). They have verified status but no equivalent certified runtime-value handoff. The existing `getVerifiedEvidenceValue` accepts only `price.current`. Synthetic tests confirm that non-price read tasks verify successfully yet return no handle, and that a price handle rejects all three other fact keys.

The execution adapter keeps the Tool DTO and ledger local and constructs its public ToolResult with `data=null`. Non-price evidence records contain metadata, not recoverable business values. A new Composer cannot recover these values from a PASS status. Reading raw Tool results or comparator values would violate the answer boundary.

## Supervisor decision required

Approve narrowly scoped runtime-only handoff coverage for the three existing non-price fact contracts before resuming all 15 answer paths. Preserve price certification, entity/task/execution ownership, existing business semantics, privacy and fail-closed behavior. Do not add unrelated deferred requirements. This prerequisite was not implemented under B2's frozen Evidence/Verification boundary.

Do not change the corpus, drop the 12 affected paths, use V4 answers as authority, repurpose comparator values, or invoke models before certified values are available. An insufficient-information answer cannot count as full required-fact coverage.

## Evidence

See [B1 price certification](reports/V5-F2A-P16B1-price-evidence-certification.md) and [B2 handoff preflight](reports/V5-F2B-P16B2-read-answer-shadow.md). Historical P16-B artifacts remain unchanged. Current availability is 3/15 required answer facts, not a completed answer implementation or model evaluation.
