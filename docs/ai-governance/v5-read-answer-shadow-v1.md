# V5 Read Answer Shadow V1 — implementation blocked

## Current status

P16-B stopped at authority preflight. The Composer, Prompt V1, Answer Contract, validators and answer-shadow flag are **not implemented**. Version1 is the requested design target, not an available runtime version. No real answer/interpreter/model/API evaluation was started.

The frozen read-execution implementation remains authoritative and unchanged. Its15/15 execution/comparator result does not certify arbitrary claims in an answer.

## Required boundary

The intended answer layer is default-OFF and shadow-only, requiring all three shadow/execution/answer flags. It may consume only request-local verified facts after execution success and verification PASS; it has no Tools, API client, write authority or user-response channel. The requested draft contains answerText and evidence-linked claims; numeric/identity/text consistency must be deterministic, and unknown references or unsupported facts must reject the draft without retry.

These requirements are recorded here, not claimed implemented or tested.

## Verified scope gap

Current inventory.read evidence has claimType inventory.quantity. The frozen read inspection verifies canonical row uniqueness, completeness and finite stock. It does not inspect price. The frozen formal-comparator harness compares price against an API reference, but that callback is evaluation-only and does not extend the ledger's claim type or verification decision.

Three frozen paths ask for price while routing to inventory.read. A normal price answer cannot currently be described as grounded in a verified price ledger entry. It would be incorrect to reinterpret inventory.quantity as a blanket certificate for every Tool-returned field.

The execution adapter also keeps the Tool DTO, ledger and verification local, creates the public ToolResult with data=null, and returns safe counts/statuses only. A future minimal transient handoff is needed; it must never place raw values into safe shadow outcomes, logs, Phoenix or datasets.

## Supervisor decision required

Approve a narrowly scoped field-level price evidence contract and its authoritative validation, together with a runtime-only verified-value handoff, before continuing the15-path answer implementation. Existing generic ledger/verifier algorithms need not necessarily change; however, the approved verified-claim scope must explicitly cover price rather than silently expanding the frozen inventory requirement.

Do not change the corpus, drop the price paths, use V4 answers as authority, repurpose the evaluation-only comparator as production verification, or use an LLM to certify the missing fact. An insufficient-information answer could be safe but cannot be counted as passing required price-fact coverage.

## Evidence

See [P16-B preflight report](reports/V5-F2-P16B-read-answer-shadow.md) and the safe dataset. Three synthetic probes establish that absent, nonnumeric and numeric price fields all receive the same existing inventory verification. This is correct for the frozen inventory contract, not a newly introduced defect.
