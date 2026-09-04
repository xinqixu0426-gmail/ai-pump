# V5 Task Class Semantics V1.1

## Purpose

Task Class Semantics V1.1 revises only the model-facing meaning of the 27 existing Task Classes. Protocol V2, the external interpretation Contract V1, class identities, taxonomy IDs, Source Span selection, exact Source Anchor, Capability routing, and bounded Tool exposure remain unchanged.

The revision was required because the prior catalog combined broad domain descriptions with operation labels. Classes sharing the same business owner and entity type could therefore appear nearly identical even when the requested result types were materially different.

## Version

- External interpretation contract: 1
- Internal Interpreter protocol: 2
- Prompt: 2
- Task Class catalog identity version: 1
- Task Class semantic version: 1.1
- Evaluation variant: `Protocol-V2 + Task-Class-Semantics-1.1`

## Model-Facing Structure

Every class exposes only:

- its existing opaque `classRef`;
- a short `primaryMeaning` describing the result the user expects;
- structurally discovered `localAlternatives`, each with an existing class reference and the alternative result meaning;
- the existing entity slots and safe entity-type descriptions.

Domain, operation, entity type, Capability ID, Tool name, Tool schema, business value, and frozen evaluation examples are not model-selectable outputs.

## Primary Meaning Rules

`primaryMeaning` is deterministically composed from the existing domain owner, operation semantics, and ontology entity meaning. It describes the requested result type rather than paraphrasing an enum label.

Read semantics mean retrieval of existing non-monetary facts, state, details, or records. Cost semantics mean determining a monetary cost, price, or accounting amount. The same result-oriented construction is applied to every operation represented by the catalog; no request string or case ID participates in generation.

## Local Contrast Rules

Sibling discovery is deterministic and symmetric. A class is a local alternative when the two classes share an entity type and either share the same domain or use the same complete entity-type tuple. Alternatives are sorted by stable `classRef`.

This rule finds close semantic siblings throughout the catalog rather than hard-coding a particular pair. Each alternative states only its expected result meaning, keeping the model view bounded and avoiding repetition of the global taxonomy.

## Invariants

- All 27 class references are unchanged.
- All domain, operation, and entity-type IDs are unchanged.
- Every class has a non-empty primary meaning.
- Every alternative reference exists.
- Self references and duplicate alternatives are rejected.
- Duplicate semantic definitions across different operations are rejected.
- The complete semantic view is deterministic.
- Capability Registry, Capability Router, and Tool Exposure remain authoritative downstream gates.

## No-Keyword Guarantee

The semantic layer does not inspect a user request and contains no keyword-to-class routing, regular-expression business routing, frozen request text, case ID, entity exemplar, or punctuation-specific fallback. The model still selects one supplied opaque reference in a single Protocol V2 call.

## No-Tool Guarantee

Tool names and Tool definitions are excluded from the semantic view. Validation scans the model-facing serialization against the current Capability Registry Tool names and fails if any Tool name appears. A selected class must still project through Contract V1 and the unchanged deterministic Capability Router before bounded Tool exposure is calculated.

## Pre-Evaluation Freeze

The approved one-shot evaluation is frozen to these SHA-256 values:

| Surface | SHA-256 |
| --- | --- |
| Prompt V2 | `24b2f09d94e86960e328d5aa63ac66e3439f4f9a39152a9c6564adf555b585d3` |
| Task Class catalog and semantics | `c120fc465004c0424260cf04fdac4d58ef489439fc51264f49e50d53de5121f1` |
| Source Span code | `00b1331e6e8c3ffc8985fb268b861dcbb066d3e409aeda43f1ceef43f3821fd8` |
| Protocol V2 code | `da3a2c98858d16fd6ebe9008d7cd933a1bf1d5266ea876289fa33ae9d81e20ad` |
| Model settings | `2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398` |
| Input Envelope code | `a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded` |
| Source Anchor code | `f31564536b806fd3f3261f4d19d7fd3623726a967204379fc5e633154107a339` |
| Capability Registry code | `c2e9c428c348866d4417a5934d7ec9d36b2d8b85cf147d95e299da8b80b8fc40` |
| Capability Router code | `9a13f47414a306a11e62015865162f82098c434a85c1cd17aaa2e026ee7fce55` |
| Tool Exposure code | `d4f4ce7caa7c12172b42375350d66843f4337e86b9484f360dc9c42e5850e2e4` |

The frozen corpus hash is `315a21d96fdd84f0ecb253772ae942b2cbbfd56842c2a8858e378693f444d4df`; its expected-results projection hash is `6980ffb284a8d82543cb1337dbe4cc9ff70ee5ab3aec59438daf0f39f8ee5590`.
