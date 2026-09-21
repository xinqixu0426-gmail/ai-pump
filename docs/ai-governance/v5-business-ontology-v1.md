# V5 Business Ontology V1

Status: isolated V5-C identity boundary; not imported by production.

Constant: `V5_BUSINESS_ONTOLOGY_VERSION=1`

Implementation: `api/services/ai-v5/businessOntology.cjs`

## Principles

- The ontology is a versioned, deterministic, deeply read-only code contract. It is not a database or a second source of business truth.
- Database schema, formal Business APIs, the existing V3 entity descriptors, and V5-B capability references are the evidence sources.
- A canonical ID comes from a formal source. Display names, model text, normalized strings, conversation memory, and search probes are never canonical IDs.
- `NOT_AVAILABLE` is explicit rather than guessed. Scope/context types cannot acquire a fabricated ID.
- Alias support is false in V1 because the current entity resolver has alternate candidate fields and fuzzy matching, but no formal entity-alias registry. P10 creates no aliases.

## Entity type registry

| Entity type | Kind | Canonical ID kind and source | Display source | Business key source | Resolver adapter |
| --- | --- | --- | --- | --- | --- |
| `customer` | business entity | DB primary key, `customers.id` | `customers.name` | `customers.name` | V3 formal result |
| `order` | business entity | DB primary key, `orders.id` | `orders.contract_no/customer_name` | `orders.contract_no` | V3 formal result |
| `recipe` | business entity | DB primary key, `recipes.id` | `recipes.name` | `recipes.name` | V3 formal result |
| `part` | business entity | DB primary key, `parts.id` | formal API `parts.model` | `parts.model` | V3 formal result |
| `coil` | business entity | DB primary key, `coils.id` | `coils.scheme_name/spec` | `coils.scheme_code` | V3 formal result |
| `template` | business entity | DB primary key, `pump_shell_templates.id` | `pump_shell_templates.shell_model` | unique `shell_model` | V3 formal result |
| `quotation` | business entity | DB primary key, `quotations.id` | formal quotation customer/status view | NOT_AVAILABLE | NOT_AVAILABLE |
| `purchase` | business aggregate | parent-scoped `orders.id + purchase_list_json` | formal purchase overview | NOT_AVAILABLE | NOT_AVAILABLE |
| `factory` | scope | stable singleton runtime scope | factory scope | NOT_AVAILABLE | NOT_AVAILABLE |
| `global` | scope | NOT_AVAILABLE | global scope marker | NOT_AVAILABLE | NOT_AVAILABLE |
| `workflow` | business entity | DB primary key, `factory_workflow_runs.id` | workflow type | NOT_AVAILABLE | NOT_AVAILABLE |
| `file` | business entity | DB primary key, `factory_files.id` | original filename | unique `file_sha256` | NOT_AVAILABLE |
| `business_record` | business entity | DB primary key, `business_change_events.id` | event summary | unique `operation_id` | NOT_AVAILABLE |
| `knowledge` | business entity | DB primary key, `knowledge_entries.id` | title | `source_table + source_id` | NOT_AVAILABLE |
| `drawing` | business entity | DB primary key, `rotor_drawings.id` | drawing name | unique `job_id` | NOT_AVAILABLE |
| `cost_context` | calculation context | NOT_AVAILABLE | formal cost request context | NOT_AVAILABLE | NOT_AVAILABLE |
| `stator_variant` | business entity | DB primary key, `stator_variants.id` | common name/diameter | `diameter_mm + material + slot_type` | NOT_AVAILABLE |
| `pump_variant` | business entity | DB primary key, `pump_model_variants.id` | unique model name | `model_name` | NOT_AVAILABLE |
| `technical_file` | business entity | DB primary key, `recipe_technical_files.id` | original filename | `recipe_id + file_sha256` | NOT_AVAILABLE |

The identity source is explicitly defined for every entry. `global` and `cost_context` are V5-B structural references rather than independently persisted business entities, so canonical identity is deliberately unavailable. `factory` is a singleton scope, not a database row.

## Resolver support and input ownership

The current `ENTITY_DESCRIPTORS` and stable identity specifications support exactly:

```text
customer, order, recipe, part, coil, template
```

For these six, the existing V4 runtime derives the mention from a configured Tool argument field. The V5-C shadow adapter instead explicitly supplies immutable `rawMention` to `resolveFormalEntityResultV3` together with a caller-provided formal result fixture. It never queries or writes the database. Unsupported types return `V5_RESOLVER_ADAPTER_NOT_AVAILABLE` and are not silently routed to a generic resolver.

## Minimal stable relations

Only direct schema-backed identity relations are declared:

- quotation `BELONGS_TO` customer via `quotations.customer_id`;
- order `BELONGS_TO` customer via `orders.customer_id`;
- recipe `USES` template and coil via `recipes.template_id/coil_id`;
- coil `BELONGS_TO` stator_variant via `coils.stator_variant_id`;
- pump_variant `USES` template and coil via its foreign keys;
- technical_file `BELONGS_TO` recipe via `recipe_technical_files.recipe_id`.

There is no relationship inference, graph database, RAG, knowledge graph, alias generation, or entity resolver replacement.

## Capability consistency

All 16 distinct `requiredEntityTypes` referenced by the frozen V5-B capability registry exist in Ontology V1. Unknown/stale references are zero. Six have current resolver adapters; ten are explicitly unsupported by that resolver. The three additional ontology types are grounded schema entities not yet used by V5-B capabilities.

## Validation

Ontology validation rejects unknown versions, duplicate entity types, missing identity sources, invalid canonical-ID kinds, invalid alias metadata, invalid resolver adapters, and relations that reference absent entity types. Capability reference validation reports unknown types without changing V5-B grouping.

## Non-goals

Ontology V1 does not define product aliases, infer canonical IDs, normalize user text, replace current matching behavior, implement full BOM/inventory ontology, execute capabilities, validate evidence, or participate in production traffic.
