# Ontology V2.1 Invariant Matrix

> Proposed generic static invariants only. Error codes are design targets; no validator implementation is changed by O4.

| Invariant | Why | Valid case | Invalid case | Fail-closed result |
|---|---|---|---|---|
| Formal canonical identity | Prevent a name/code from replacing business resource identity | profile identity points to formal resource ID | designation marked canonical | `ONTOLOGY_V2_DESIGNATION_CANONICAL_IDENTITY_FORBIDDEN` |
| Extension identity | Extension enriches the same resource | extension adds a Fact and relation | extension declares/replaces canonical identity | `ONTOLOGY_V21_EXTENSION_IDENTITY_FORBIDDEN` |
| Extension applicability reference | Applicability must be deterministic and typed | `FACT_EQUALS` uses declared BOOLEAN Fact and boolean literal | unknown Fact or NUMBER compared to string | `ONTOLOGY_V21_APPLICABILITY_REF_INVALID` |
| Extension composition collision | No hidden override order | one applicable extension introduces unique Fact ID | base and extension both define same Fact ID | `ONTOLOGY_V21_COMPOSITION_COLLISION` |
| Source DAG | Provenance must terminate without loops | raw source → projection | A source indirectly references itself | `ONTOLOGY_V2_SOURCE_CYCLE` |
| Derivation DAG | Acyclic sources do not prevent cyclic business Facts | A copies B; B is raw | A derives B; B derives A | `ONTOLOGY_V21_DERIVATION_CYCLE` |
| Derivation input/type | Formula cannot hide type/unit mistakes | numeric mm minus numeric mm | STRING minus NUMBER, or incompatible units | `ONTOLOGY_V21_DERIVATION_INPUT_INVALID` |
| Derivation operation boundary | Ontology is not a business algorithm engine | `COPY`, `SUBTRACT`, `PROJECT_RELATED_FACT` | cost formula or arbitrary JS operation | `ONTOLOGY_V21_DERIVATION_OPERATION_FORBIDDEN` |
| Derived authority | Derived output cannot override inputs | computed view marked `DERIVED` | derived Fact declared canonical/current override | `ONTOLOGY_V21_DERIVED_AUTHORITY_INVALID` |
| Materialized derived cache | Cache cannot become independent truth | cache carries input/version/invalidation metadata | cache lacks freshness metadata or is selectable as default | `ONTOLOGY_V21_DERIVED_CACHE_INVALID` |
| Formal relation endpoint | Relations bind resources, not text resembling a resource | relation endpoint requires target canonical ID | model/name string is declared endpoint | `ONTOLOGY_V21_RELATION_ENDPOINT_INVALID` |
| Relation cardinality | Consumers need declared shape | `EXACTLY_ONE` formal relation | unknown cardinality value | `ONTOLOGY_V21_RELATION_CARDINALITY_INVALID` |
| Relation projection | Related data preserves identity provenance | target Fact projected through declared relation | target Fact named without relation declaration | `ONTOLOGY_V21_RELATION_PROJECTION_INVALID` |
| Cross-entity path | Conditions must follow declared type-safe paths | local relation A then target relation B then terminal Fact | unknown hop, wrong source type, path cycle | `ONTOLOGY_V21_CROSS_ENTITY_PATH_INVALID` |
| Unknown versus not-applicable | Missing upstream data must not select a false branch | known false predicate → `NOT_APPLICABLE` | missing related Fact treated as false | `ONTOLOGY_V21_CONDITION_UNRESOLVED` |
| Compatibility precedence | Legacy data cannot silently win | canonical current Fact beats labelled compatibility source | compatibility adapter overrides confirmed current Fact | `ONTOLOGY_V21_COMPATIBILITY_PRECEDENCE_INVALID` |
| Preset lifecycle | Initialization is not final authority | preset provenance on unsaved draft | saved/confirmed Fact remains effective preset authority | `ONTOLOGY_V21_PRESET_AUTHORITY_INVALID` |
| Snapshot truthfulness | Snapshot is not live current fact | saved snapshot labelled `SAVED_SNAPSHOT` | snapshot declares `CANONICAL_CURRENT` | `ONTOLOGY_V21_SNAPSHOT_AUTHORITY_INVALID` |
| Unresolved safety | Unknown source cannot produce a safe conclusion | unresolved source blocks functional requirement | unresolved source satisfies default/relation/derivation | `ONTOLOGY_V21_UNRESOLVED_UNSAFE` |
| Technical Knowledge non-functionality | Flexible notes must not create business side effects | arbitrary entry is searchable/AI-readable | entry declares selection, relation binding, requiredness, or identity | `ONTOLOGY_V21_KNOWLEDGE_FUNCTIONAL_AUTHORITY_FORBIDDEN` |
| Knowledge promotion | Promotion must be intentional and auditable | new formal Fact has source/role/migration map | label text automatically becomes a Fact | `ONTOLOGY_V21_KNOWLEDGE_PROMOTION_INVALID` |
| Knowledge index boundary | Search index may not determine operational truth | canonical metadata projects to FTS | FTS/vector result used as functional source | `ONTOLOGY_V21_INDEX_AUTHORITY_FORBIDDEN` |
| Runtime isolation | Contract design changes no production behaviour | every new declaration has runtime disabled | one declaration enables runtime/read/write consumer | `ONTOLOGY_V2_RUNTIME_ISOLATION_REQUIRED` |

## Static validator families

1. Contract/profile/extension exact shape and declared-ID uniqueness.
2. Existing V2 identity, designation, source, role, policy, and runtime-isolation checks.
3. Extension base/profile refs, applicability refs, and composition collision checks.
4. Formal relation endpoint/type/direction/cardinality/source checks.
5. Fact source/value-kind/derivation input and independent derivation-DAG checks.
6. Predicate/cross-entity path/type checks, including no undeclared or fuzzy traversal.
7. Authority/purpose/materialization compatibility matrix checks.
8. Technical Knowledge schema restrictions and promotion declaration checks.

None of these families may inspect an entity name, category value, Fact ID, database column, or current DTO field. They validate declared shape, references, types, graph invariants, and prohibited combinations only.
