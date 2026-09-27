# Part Base and Category-Extension Audit

> Audit only. No Part Ontology profile, category extension, database change, API change, or runtime integration is implemented by this ticket.

## Minimal Part base finding

Ordinary Part can remain lightweight. Current resource evidence is `parts` plus `partRow()`:

| proposed semantic item | current source | role / authority | searchable or selection use | default summary |
|---|---|---|---|---|
| Canonical identity | `parts.id` | formal resource identity | direct ID only | no |
| model | `parts.model`, structured `naming_json` when present | designation/display; model+supplier is operational lookup, not canonical identity | yes (`partQueries.listParts`) | yes |
| category / subcategory | `parts.category`, `parts.subcategory` | classification facts | category filter / extension discriminator | category yes |
| supplier | `parts.supplier` | procurement/business fact | supplier filter and reference disambiguation | yes where useful |
| price | `parts.price` | current business/commercial fact | price filtering; BOM catalog price lookup | yes |
| stock | `parts.stock` | current business fact | stock-status filtering | yes on inventory request |
| lifecycle | `parts.deleted_at` | lifecycle / soft deletion | normal lists exclude it | no |
| remark | `parts.remark` / DTO alias `notes` | opaque metadata container, not a universal base Fact | no generic selection | no |
| timestamps / naming profile / aliases | table timestamps; `catalog_identity_profiles`; `catalog_name_aliases` | provenance / internal identity metadata | limited catalog lookup | no |

Evidence: schema `api/database/schema.cjs:121-135`; DTO `api/db.cjs:95-103`; query filters/sort in `api/services/partQueries.cjs`; physical identity guard in `api/services/catalogPhysicalIdentity.cjs`.

**Answer Q1:** Yes. Price, supplier and stock are the operational core; category is a discriminator for optional extensions. A Coil-like selection/default/lifecycle policy is not warranted for every Part.

## Existing category audit

`apps/web-next/lib/part-form-rules.ts:3` lists current built-ins: 轴承、油封、螺丝、泵壳、泵壳搭配、线圈转子、电容、电缆线、浮球、皮垫、配件、包装.

| category | extra current facts / algorithms | future extension assessment |
|---|---|---|
| 泵壳 | structured `remark` engineering data; binding to Template; rotor derivation; bundle/components cost behaviors | **needs richest extension** |
| 电容 | capacitance from structured naming or legacy model parsing; Coil default chooses capacity and ambiguity is rejected (`catalogSpec.capacitorValueOf`, `recipeBomEngine.resolveCapacitorModel`) | likely lightweight technical/spec extension |
| 电缆线 | wire/cross-section from naming/legacy model; length plus accessory cost path (`catalogSpec.selectWirePart`, `costEngine.calculateCompleteCableCost`) | likely extension: technical spec + costing policy |
| 螺丝 | optional `remark.screwPricing`; long screw can derive requested length from barrel length (`costEngine.applyLongScrewRule`) | likely extension only for pricing/dynamic length subset |
| 浮球 | wire spec and accessory delta / configuration behavior | possible lightweight extension, not proven as complex as cable |
| 轴承 / 油封 | catalog items referenced by PumpShell/Template/Recipe | base Part plus typed relation/spec may suffice |
| 泵壳搭配 | Template component catalog category and subassembly semantics | likely template-component domain, not a canonical PumpShell extension |
| 线圈转子 | BOM representation refers to Coil formal scheme/inventory | relation to Coil, not ordinary Part ontology duplication |
| 包装 / 皮垫 / 配件 | mostly BOM/category semantics | plain Part unless future evidence adds algorithmic fields |

## Why PumpShell is special

PumpShell is a Part but anchors a product configuration graph. It has:

1. a formal optional Template relation (`catalog_template_shell_bindings`);
2. technical engineering parameters used for rotor draft defaults and derivation;
3. stainless-length behavior reaching BOM and cost;
4. physical-fingerprint treatment of its metadata;
5. historical name matching when formal binding is absent.

Therefore **Q2: PUMPSHELL_AS_PART_EXTENSION = YES**. The recommended future shape is:

```text
Part Base (part.id, model, category, supplier, price, stock, lifecycle)
  └── category = PumpShell
        ├── intrinsic engineering facts
        ├── recommended/default technical configuration
        ├── derived engineering facts
        ├── Template relation
        └── domain policies (rotor/BOM applicability)
```

This keeps `parts.id` canonical while preventing PumpShell fields from appearing on every Part.

## Category-extension proposal — no implementation

The current V2 profile format can describe an entity’s Facts, Roles, Sources, Policies and Relations, but it has no explicit reusable `base profile + category extension` composition mechanism. A future **generic** contract enhancement is likely needed to declare:

- base entity profile `part`;
- extension applicability predicate based on a category Fact/value;
- extension Fact namespace and source/provenance;
- extension relations and domain policies;
- optional inheritance/merge rules that remain generic and validator-owned.

This is not a request to add PumpShell-only validator logic. It is a design finding: **ONTOLOGY_V2_CATEGORY_EXTENSION_FIT = NEEDS_GENERIC_EXTENSION** for clean composition. A full PumpShell profile could be forced into one Part profile today, but that would over-model every category and obscure ownership.

## No-code versus code-required boundary

After a generic category-extension mechanism exists, the following should be definition-only: adding an approved PumpShell Fact, marking a field intrinsic/default/derived, sourcing an existing field, configuring a relation, or assigning roles/presentation metadata.

Code remains legitimate for a new adapter, new formula/execution semantics, a new cost algorithm, a new projection protocol, schema migration, or runtime Entity Linking. This audit does not authorize any of those changes.

## Current PumpShell cost-chain finding

Owner’s intended chain is PumpShell Part → Template → Recipe → BOM → Cost. Current code supports this as follows:

- `catalog_template_shell_bindings` provides exact Part identity for a template when present.
- Template `cost_mode=bundle` emits one shell BOM item using `bundle_cost`; bound Part supplies identity/model/supplier, not the amount.
- Template `cost_mode=components` expands `shell_components_json` using category `泵壳搭配` prices; PumpShell Part may be absent from BOM pricing.
- Recipe stores `template_id` and a computed `parts_json`/cost snapshot. `recipeBomEngine` builds the BOM, while `costEngine` calculates the full cost boundary.
- Both Template binding and Recipe template ID are optional in some valid current paths; therefore it is a supported workflow, not a universal enforced graph.

## Explicit unresolved / Owner decisions

1. Which of the current `default*` rotor values are intrinsic PumpShell engineering facts versus recommended configuration defaults?
2. Should every technical PumpShell Template, not only bundle templates, require a formal `shellPartId` relation?
3. For non-stainless shells, should fixed bearing span be protected as an intrinsic fact rather than remain an overrideable default?
4. Is historical `remark.barrelLength` still a supported business source, or should it be deprecated after migration planning?
5. Which layer should own each rotor parameter when Template, Recipe JSON and Recipe columns disagree?

## Audit artifacts and boundaries

- Detailed fields, precedence, relation, physical identity and debt register: `PumpShellSemanticAudit.md`.
- This document is a proposed minimal semantic model only; no production Part profile exists.
- DB inspection performed: **NO**. Source/schema audit only.
