# M4-2C — Three-Agent Isolation Prototype

## Purpose

This is an experimental, non-production harness for separating three concerns
that had been combined in one semantic-model call:

```text
User input
  -> Business Understanding Agent
  -> Business Meaning Contract
  -> Semantic Agent
  -> Semantic Contract
  -> Ontology Agent
  -> Grounding Contract
```

It does not plan, select business tools, read business facts, calculate,
write, or generate a user answer. It is not imported by the production AI
runtime.

## Prototype location

`scripts/ai-experiments/three-agent-isolation/`

The prototype contains independent Business and Semantic DeepSeek calls and a
deterministic, fixture-backed Ontology grounding adapter. The latter deliberately
uses no LLM call: identity resolution is a formal/contract concern, not a
language-generation task. It reuses the existing ontology projection contract
only; the fixture has no production data.

## Context boundaries

| Agent | Included | Explicitly excluded |
| --- | --- | --- |
| Business Understanding | Raw user input; full Company Business Model V1 | Domain Policy, ontology, database, tool/capability definitions, canonical IDs |
| Semantic | Raw user input; Business Meaning Contract; optional prior user wording | Full Business Model, Domain Policy, ontology, database, tools/capabilities, canonical IDs |
| Ontology | Semantic Contract; Business concept hints; existing ontology projection contract; identity-only fixture | Domain Policy, costs, inventory, preview/write tools, planning and answer generation |

Automated focused tests assert these profiles and assert that runtime, Judge,
Main Agent and Capability Broker source files do not import this prototype.

## Contracts

Business Meaning Contract:

```json
{
  "concepts": [],
  "businessMeanings": [],
  "businessRelations": [],
  "unknownBusinessTerms": []
}
```

Semantic Contract:

```json
{
  "mentions": [],
  "requestedChanges": [],
  "requestedInformation": [],
  "explicitPersistenceSignal": "SAVE|DO_NOT_SAVE|NONE",
  "references": [],
  "missingSemanticInformation": []
}
```

Grounding Contract:

```json
{
  "bindings": [],
  "unresolvedMentions": [],
  "relationBindings": []
}
```

Only the grounding contract can contain fixture canonical identities. A binding
is `UNIQUE`, `AMBIGUOUS`, `NOT_FOUND`, or `NOT_APPLICABLE`.

## Isolated fixture

The fixture intentionally contains only identities needed to test grounding:

- recipes: V750-通用款, V750-豪贝款, V550-通用款;
- two distinct formal coil schemes sharing common designation `12-120`;
- templates: 通用款 and 豪贝款;
- one catalog part.

It contains no cost, stock, pricing, order, write or production data. In
particular, `12-120` resolves to two candidates and therefore cannot silently
bind to a first result.

## Smoke method

On 2026-09-30, the ten specified ISO cases ran independently through Business
then Semantic then Ontology. ISO-02, ISO-03, ISO-04, ISO-05, ISO-06 and ISO-09
were each run once more for stability. The validated smoke set therefore had
16 end-to-end executions, 32 DeepSeek calls (`deepseek-chat`) and zero Ontology
LLM calls. Tools exposed to Business/Semantic were zero; Ontology had only the
deterministic identity fixture adapter. No database was accessed.

This was an observation run. Prompts, Business Model, policy candidate and
fixture were not changed to repair the observed output.

## Results

| Case | Business | Semantic | Ontology | Overall | Observation |
| --- | --- | --- | --- | --- | --- |
| ISO-01 | PASS | PASS | PASS | PASS | `12-120` remained semantically clear and grounded as two formal candidates. |
| ISO-02 | PASS | PASS | PASS | PASS | Cost request stayed a language request; grounding was ambiguous. |
| ISO-03 | PASS | FAIL | PASS | FAIL | Semantic output introduced formal-data gaps as missing information instead of only extracting the stated change/outcome. |
| ISO-04 | PASS | FAIL | PASS | FAIL | Semantic output omitted the stainless-shaft requested change. |
| ISO-05 | PASS | FAIL | PASS | FAIL | `SAVE` was preserved, but semantic output inferred an unstated source package and treated identity uniqueness as semantic missing information. |
| ISO-06 | PASS | FAIL | PASS | FAIL | `DO_NOT_SAVE` was preserved, but both cable and packaging changes were omitted. |
| ISO-07 | PASS | PASS | FAIL | FAIL | Ontology attempted a template lookup for a conceptual comparison; expected `NOT_APPLICABLE`. |
| ISO-08 | PASS | FAIL | PASS | FAIL | The request was understood but semantic output added non-linguistic missing information. |
| ISO-09 | PASS | FAIL | FAIL | FAIL | Conversation reference was preserved, but incorrectly treated as semantic missing information; the prototype did not hand prior textual mention `12-120` into grounding. |
| ISO-10 | PASS | PASS | PASS | PASS | Missing change detail remained a semantic missing-information result; V750 grounded ambiguously. |

### Stability repeats

| Case | Stability | Material observation |
| --- | --- | --- |
| ISO-02 | STABLE | Common-designation request stayed separate from formal identity ambiguity. |
| ISO-03 | STABLE | Packaging change and cost-difference request remained visible, but semantic added formal-data gaps. |
| ISO-04 | STABLE | Stainless-shaft change continued to be omitted by Semantic. |
| ISO-05 | STABLE | Explicit `SAVE` continued to be retained; identity ambiguity remained in Ontology. |
| ISO-06 | STABLE | Explicit `DO_NOT_SAVE` continued to be retained; requested changes continued to be lost. |
| ISO-09 | STABLE | Conversation reference continued to be preserved but not grounded from the preceding textual mention. |

## Failure classification

There were no context leaks, ID leaks into the first two layers, business-tool
planning leaks, cost/inventory reads, writes, database access, or production
imports. The observed failures are experimental-contract failures:

1. **Semantic extraction fidelity:** the isolated Semantic model sometimes
   omits configuration changes and sometimes converts formal identity/data
   uncertainty into `missingSemanticInformation`.
2. **Ontology admission boundary:** a conceptual Template/Recipe comparison
   needs an explicit `NOT_APPLICABLE` admission rule rather than an entity
   lookup.
3. **Reference handoff:** the prototype needs a contract-approved way to pass
   prior *textual* mentions to grounding without letting Semantic invent a
   canonical identity.

These findings are not repaired in M4-2C. They are evidence for Supervisor
review, not a basis for integrating the prototype.

## Runtime integration decision

**Do not integrate.** The isolation architecture is demonstrated, but the
semantic and reference-handoff evidence above prevents production adoption in
this stage. Production runtime behavior, published policy, ontology contract,
database schema, Business APIs and cost engine remain unchanged.
