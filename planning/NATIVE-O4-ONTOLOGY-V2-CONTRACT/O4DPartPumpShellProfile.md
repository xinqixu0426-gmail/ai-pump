# O4-D Part Base + PumpShell Extension Profile

## Scope and runtime boundary

This O4-D deliverable adds V2.1 declarative definitions only.  The definitions are immutable, have `runtimeEnabled: false`, store no business values, and introduce no database reader, API endpoint, resolver, policy evaluator, or write path.  They do not change the frozen V2 contract or the Coil reference profile.

The profile modules are:

- `api/ontology/v2_1/entities/part.cjs`
- `api/ontology/v2_1/entities/template.cjs`

They are composed additively by `api/ontology/v2_1/contract.cjs`.

## Part Base

`part` remains deliberately small.  Its canonical identity is the positive-integer primary key `parts.id`; it is not a model, supplier, alias, or naming-derived value.  The profile keeps both `permitsDesignationAsCanonicalId` and `permitsNameOnlyCanonicalId` false.

| Semantic item | V2.1 Fact / designation | Current source | Role / boundary |
|---|---|---|---|
| Canonical identity | resource identity | `parts.id -> partRow.id` | Canonical resource ID only |
| Model | `part.model`, `part.modelDesignation` | `parts.model -> partRow.model` | searchable designation and candidate evidence, not canonical and not globally unique |
| Classification | `part.category`, `part.subcategory` | `parts.category`, `parts.subcategory` | searchable candidate/disambiguation evidence; category is also `POLICY_INPUT` |
| Supplier | `part.supplier` | `parts.supplier` | candidate/disambiguation evidence, not identity |
| Commercial price | `part.price` | `parts.price` | `CURRENT_BUSINESS`; not identity and not universal `COST_INPUT` |
| Stock | `part.stock` | `parts.stock` | `CURRENT_BUSINESS`; not identity |
| Lifecycle | `part.deletedAt` | raw `parts.deleted_at` | `LIFECYCLE`; `partRow` does not currently expose `deletedAt` |
| Provenance | `part.createdAt`, `part.updatedAt` | `parts.created_at`, `parts.updated_at` | provenance only |

The current query surface supports model, category, subcategory, and supplier as useful search/disambiguation evidence.  Price and stock may filter operational views in existing code but are deliberately not identity or ontology candidate-identity evidence.

`parts.remark` is not a universal Part Fact.  The source declaration for its one approved PumpShell projection explicitly limits scope to `parts.remark.isStainless`.

## PumpShell as a Category Extension

PumpShell is not a second canonical entity.  It is the `part.pump_shell` extension of base entity `part`:

```text
Part #parts.id
  +-- applies only when part.category == "泵壳"
      +-- part.isStainless
```

The applicability predicate uses the base `part.category` Fact and does not require any generic validator branch for the Chinese category literal.  The extension has no `identity` block.

### Approved PumpShell Fact

`part.isStainless` is the one small authoritative extension Fact.  It is sourced as a current formal metadata projection:

```text
parts.remark.isStainless
  -> existing parsePumpShellMeta projection
  -> part.isStainless
```

It has roles `FUNCTIONAL_TECHNICAL` and `POLICY_INPUT`.  It is neither designation nor direct/candidate identity evidence.  The profile describes its current storage and meaning; it does not add a parser or runtime reader.

### Explicit compatibility-only exclusions

The extension intentionally does **not** declare any of the historic PumpShell technical/default fields below:

- `openOffset`, `openFactor`, `barrelLength`, `barrelLengthPresets`
- `defaultUpperBearing`, `defaultUpperBearingPartId`
- `defaultLowerBearing`, `defaultLowerBearingPartId`
- `defaultOilSealDia`, `defaultBearingSpan`
- `defaultImpellerDia`, `defaultImpellerSpan`, `defaultImpellerDepth`
- `defaultThreadLength`, `defaultThreadDia`, `defaultStackOffset`

They remain compatibility concerns outside this new profile.  In particular, this contract does not make PumpShell a Rotor Drawing or Recipe technical authority; later Recipe functional-profile work owns those facts.

## Minimal Template supporting profile

The `template` profile exists solely so V2.1 can declare the current formal Template-to-Part shell binding.  It has:

- canonical resource identity `pump_shell_templates.id`;
- one minimal `template.shellModel` designation/direct-lookup Fact;
- one formal Relation, `template.uses_shell_part`.

Although current storage declares `pump_shell_templates.shell_model` unique, it remains a non-canonical designation.  Its direct-lookup value never replaces `pump_shell_templates.id`.

No Template rotor parameters, shell-component data, cost mode, costing rules, BOM logic, Recipe behavior, or name heuristics are included.

## Formal Template -> Part shell relation

```text
Template #pump_shell_templates.id
  --template.uses_shell_part-->
Part #parts.id
```

The relation source is the current formal table binding:

```text
catalog_template_shell_bindings.template_id
  -> catalog_template_shell_bindings.shell_part_id
```

It is `OUTBOUND`, targets `part`, requires a canonical endpoint, and has `ZERO_OR_ONE` cardinality.  The global cardinality is not `EXACTLY_ONE`: `template_id` is unique when a binding exists, but components-mode templates may legitimately have no concrete shell-Part binding; bundle-mode validation is existing command/runtime behavior outside this contract.

The relation belongs to the Template profile because Template is the relation source.  `part.pump_shell` owns only the small `part.isStainless` semantic enrichment.  Existing `shellModel`/suffix/name matching in `pumpShellPartResolver` is compatibility resolution and is intentionally not represented as a formal Ontology relation.

## Future Recipe path — static proof only

The V2.1 contract can statically express the terminal path needed by future work:

```text
future Recipe --uses_template--> Template
  --uses_shell_part--> Part
  --targetExtensionId: part.pump_shell--> part.isStainless
```

O4-D does not create a Recipe profile or Relation.  The focused test uses the real Template-to-Part segment in an inert test-only policy FactRef and proves that `targetExtensionId: "part.pump_shell"` is required for the extension-owned terminal Fact.  Removing it fails closed.  No actual relation traversal or applicability evaluation runs at runtime.

## Remaining gaps and later work

- V2.1 has no runtime reader for raw `parts.deleted_at`, `parts.remark.isStainless`, or `catalog_template_shell_bindings`.
- Existing name-based shell resolution remains legacy compatibility behavior outside formal relation authority.
- Recipe functional technical facts, relations, conditional stainless policy, derived values, and Recipe Technical Knowledge remain future O4-E work.
- No data migration, legacy-field cleanup, API/UI change, or business algorithm change is part of O4-D.
