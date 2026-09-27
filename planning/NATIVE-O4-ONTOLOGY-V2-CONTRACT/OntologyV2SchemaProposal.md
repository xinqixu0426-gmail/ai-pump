# Ontology V2.1 Schema Proposal

> Pseudocode only. This is neither executable JavaScript nor a production profile. It intentionally uses synthetic names to prove the proposal is generic.

## Preferred additive schema

```text
OntologyContract {
  version: 2,
  contractRevision: "2.1",
  runtimeEnabled: false,
  storesBusinessValues: false,
  isBusinessSourceOfTruth: false,
  access: "CONTRACT_ONLY_NO_RUNTIME",
  sources: Source[], roleCatalog: Role[],
  profiles: BaseProfile[],
  extensions: ExtensionProfile[],
  relations: Relation[],
  policies: ConditionalPolicy[],
  technicalKnowledgeTypes: TechnicalKnowledgeCollection[]
}

BaseProfile extends CurrentV2Profile {
  relationIds?: string[], derivedFactIds?: string[], policyIds?: string[],
  technicalKnowledge?: { collectionId: string } | null
}

Fact extends CurrentV2Fact {
  valueKind?: "DIRECT" | "RELATION_PROJECTION" | "DERIVED",
  relationProjection?: { relationId, targetFactRef, displayProjection? },
  derivation?: Derivation,
  applicableWhen?: Predicate,
  requiredWhen?: Predicate,
  prohibitedWhen?: Predicate
}
```

## Fully worked synthetic example

```text
profiles: [
  {
    entityType: "assembly",
    identity: formalResourceId("assembly.current", "assembly.id"),
    facts: [
      directFact("assembly.category", STRING, "assembly.current", { searchable:true }),
      directFact("assembly.length", NUMBER, "assembly.current", { unit:"mm" }),
      directFact("assembly.offset", NUMBER, "assembly.current", { unit:"mm" }),
      directFact("assembly.span", NUMBER, "assembly.derived", {
        valueKind:"DERIVED", authority:"DERIVED",
        derivation:{ operation:"SUBTRACT", inputs:["assembly.length", "assembly.offset"],
          missingInputPolicy:"UNRESOLVED", materialization:"COMPUTE_ON_READ" },
        applicableWhen: FACT_EQUALS(RELATED(["assembly.uses_housing"], "housing.adjustable"), true),
        prohibitedWhen: FACT_EQUALS(RELATED(["assembly.uses_housing"], "housing.adjustable"), false)
      }),
      directFact("assembly.explicitSpan", NUMBER, "assembly.current", {
        unit:"mm",
        requiredWhen: FACT_EQUALS(RELATED(["assembly.uses_housing"], "housing.adjustable"), false),
        prohibitedWhen: FACT_EQUALS(RELATED(["assembly.uses_housing"], "housing.adjustable"), true)
      }),
      relationProjectionFact("assembly.componentDiameter", NUMBER, {
        relationId:"assembly.uses_component",
        targetFactRef:"component.diameter",
        sourceRef:"assembly.component_projection"
      })
    ],
    relationIds:["assembly.uses_housing", "assembly.uses_component"],
    technicalKnowledge:{ collectionId:"assembly.technical_notes" },
    selectionPolicy:{ policyType:"NONE", runtimeEnabled:false },
    eligibilityPolicy:{ policyType:"NONE", runtimeEnabled:false },
    costingPolicy:null, relationBridge:null
  }
]

extensions: [
  {
    extensionId:"housing-adjustability",
    baseEntityType:"component",
    applicability: FACT_EQUALS(LOCAL("component.category"), "HOUSING"),
    facts:[directFact("component.adjustable", BOOLEAN, "component.current")],
    designations:[], relationIds:[], policyIds:[],
    technicalKnowledge:null, runtimeEnabled:false
  }
]

relations: [
  {
    relationId:"assembly.uses_housing", sourceEntityType:"assembly",
    target:{ entityType:"component", canonicalEndpointRequired:true },
    direction:"OUTBOUND", cardinality:"EXACTLY_ONE",
    sourceRef:"assembly.current", runtimeEnabled:false
  },
  {
    relationId:"assembly.uses_component", sourceEntityType:"assembly",
    target:{ entityType:"component", canonicalEndpointRequired:true },
    direction:"OUTBOUND", cardinality:"ZERO_OR_ONE",
    sourceRef:"assembly.current", runtimeEnabled:false
  }
]

technicalKnowledgeTypes: [
  {
    collectionId:"assembly.technical_notes", ownerEntityType:"assembly",
    entrySchema:["key", "label", "value", "unit?", "valueType?", "sourceRef?", "updatedAt?", "version?", "evidenceRelationIds?"],
    allowsArbitraryKeys:true, searchable:true, aiReadable:true,
    defaultClassification:"TECHNICAL_KNOWLEDGE", runtimeEnabled:false
  }
]
```

### What the example proves

- `assembly` retains one formal resource ID; the extension cannot create another one.
- Extension applicability is typed/declarative; no category-specific validator branch exists.
- Both relations require a canonical target endpoint, so a display name cannot bind a component.
- `componentDiameter` is provenance-preserving relation projection, not a copied identity.
- `span` is a `SUBTRACT` derived Fact, has declared inputs, and is subject to the Fact derivation DAG.
- A related Fact controls generic conditional requiredness without naming a concrete business domain.
- A compatibility source could be declared with `provenancePurpose: COMPATIBILITY_ADAPTER`; it could not outrank the direct/derived facts above.
- `assembly.technical_notes` permits arbitrary knowledge entries but has no field through which an entry becomes a Fact, relation, or policy input.

## Mapping to frozen real cases (design validation only)

| Real semantic need | V2.1 construct |
|---|---|
| Coil | existing standalone V2 profile; no new optional constructs required |
| Part Base | lightweight `BaseProfile` |
| PumpShell semantics | applicability-gated Part extension with no separate identity |
| Template binding | formal canonical-ID relation |
| Recipe bearings | `EXACTLY_ONE` relations to Part; display model and 62xx code are projections/compatibility only |
| stainless conditions | related Fact predicate controls required/derived versus explicit fields |
| stainless span | `SUBTRACT` derived Fact with `COMPUTE_ON_READ` |
| Coil sheets to piece count | `PROJECT_RELATED_FACT` / declared relation projection |
| old defaults/params | source purpose `COMPATIBILITY_ADAPTER`, non-authoritative rank |
| Recipe memo fields | generic Technical Knowledge collection |

## V2.1 acceptance tests to implement later

1. A legacy Coil-only V2 profile validates unchanged under the V2.1 reader.
2. A synthetic base plus conditional extension validates with no validator entity-name change.
3. Extension identity replacement and ID collisions fail closed.
4. A canonical-ID relation validates; a display-string endpoint fails.
5. Relation projection preserves target identity provenance.
6. Valid `SUBTRACT` and related projection derivations validate; self and indirect Fact cycles fail.
7. Predicate references/path types validate; missing/wrong/looping paths fail.
8. Compatibility, preset, snapshot, derived, and unresolved source declarations cannot claim forbidden authority.
9. Arbitrary Technical Knowledge entries validate without field-specific Fact definitions; attempts to use them as policy/identity/relation input fail.
10. Contract-wide runtime isolation remains false.
