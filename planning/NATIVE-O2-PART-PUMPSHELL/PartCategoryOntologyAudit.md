# Part Base and Category-Extension Audit — R1 Authority Alignment

> Audit only. No Part/Recipe Ontology profile, category extension, database change, API change, UI change, runtime integration, or legacy cleanup is implemented by this ticket.

## Part Base — frozen lightweight model

Ordinary Part stays intentionally simple. It does not inherit Coil-level selection/default complexity merely because one category has engineering history.

| semantic item | current source | current role | proposed future authority |
|---|---|---|---|
| Canonical identity | `parts.id` | formal resource identity | Part Base identity |
| model | `parts.model`; `naming_json` where present | designation/display and operational lookup | Part Base designation |
| category / subcategory | `parts.category`, `parts.subcategory` | classification / extension discriminator | Part Base classification |
| supplier | `parts.supplier` | procurement/current business fact | Part Base fact |
| price | `parts.price` | commercial/current business fact | Part Base fact; not universal cost authority |
| stock | `parts.stock` | current business fact | Part Base fact |
| lifecycle | `parts.deleted_at` | soft deletion | Part Base lifecycle |
| remark / timestamps / aliases | `parts.remark`, timestamps, catalog naming metadata | optional metadata/provenance | not universal Facts without category evidence |

Evidence: `api/database/schema.cjs:121-135`; `api/db.cjs:95-103`; `api/services/partQueries.cjs`; catalog naming/identity services.

## Current category assessment

Current built-ins from `apps/web-next/lib/part-form-rules.ts:3`: 轴承、油封、螺丝、泵壳、泵壳搭配、线圈转子、电容、电缆线、浮球、皮垫、配件、包装。

| category | current extra meaning | future extension assessment |
|---|---|---|
| 泵壳 | `isStainless`; Template relation; historic rotor defaults; stainless BOM/drawing applicability | **yes: focused PumpShell Extension** |
| 电容 | capacitance selection/spec semantics used with Coil defaults | likely lightweight technical/spec extension |
| 电缆线 | wire/cross-section, length and accessory-cost rules | likely technical spec + costing policy extension |
| 螺丝 | optional `remark.screwPricing`; barrel-length rule for a subset | likely pricing extension for the dynamic subset |
| 浮球 | wire/accessory configuration behaviour | possible lightweight extension |
| 轴承 / 油封 | Parts that can be selected by Recipe technical facts | base Part plus typed relation/spec likely sufficient initially |
| 泵壳搭配 | Template component/subassembly catalog role | Template-component domain, not PumpShell identity |
| 线圈转子 | formal Coil-related BOM representation | relation to Coil; do not duplicate Coil ontology |
| 包装 / 皮垫 / 配件 | ordinary BOM/category semantics | plain Part unless future evidence adds special policy |

## PumpShell target model — smaller than V1

The corrected finding is **Part Base + PumpShell Category Extension**, but the extension must not preserve V1’s full rotor profile.

```text
Part Base
  └── PumpShell Extension
        ├── isStainless                         (PumpShell Fact)
        ├── Template --uses_shell_part--> Part  (relation)
        └── configuration applicability          (policy discriminator)
              └── tells Recipe which facts are required/derived

Template
  └── normal materials / configuration skeleton

Recipe
  ├── final BOM and customer differences
  ├── final technical facts
  └── derived technical facts
        └── Rotor Drawing authoritative input
```

`isStainless` is retained on PumpShell because it describes the shell type. It is also a policy discriminator: it determines whether Recipe must carry stainless configuration context. Detailed bearing, oil seal, impeller, thread, stack and span values are **not** current target PumpShell authority.

## Historical implementation compatibility

The source still has a V1 compatibility surface:

- `parts.remark.default*` is read by `rotorTemplateDraft.applyShellMetaDefaults()`.
- `pump_shell_templates.rotor_params_json` is read after Template component heuristics.
- Recipe technical JSON overlays supported rotor keys last.
- `recipes.custom_barrel_length` can derive a span using PumpShell `openOffset`.

This proves current runtime precedence, not current business authority. The revised PumpShell audit labels Shell defaults and Template rotor params as legacy/transitional prefill or compatibility sources. No deletion or behavior change is authorized here.

## Recipe Technical Authority

### Current target business authority

Recipe is the final configured product. It owns:

1. final BOM/material selection;
2. customer-specific differences;
3. final rotor/drawing technical parameters;
4. stainless `barrelLength` and `openOffset` when applicable;
5. derived `bearingSpan` for stainless;
6. explicit fixed final `bearingSpan` for non-stainless.

For target semantics, Rotor Drawing should consume Recipe technical facts/derived facts, not PumpShell defaults or Template params.

### Current implementation gap

`recipes.custom_barrel_length` is an existing persisted Recipe field. `technical_data_json` stores nearly all listed rotor values. But no dedicated Recipe `openOffset` column or fixed JSON key currently exists; UI/server currently get it from PumpShell remark. This is an implementation/semantic gap for a later Recipe authority design, not a reason to relabel PumpShell `openOffset` as the current final authority.

## Stainless and non-stainless policy

| shell policy | target Recipe rule | current implementation status |
|---|---|---|
| `isStainless=true` | Recipe has barrelLength + openOffset; derive `bearingSpan = barrelLength - openOffset`; Rotor Drawing uses final Recipe configuration | partial: Recipe stores length; offset remains Shell compatibility source; backend derivation lacks `isStainless` hard guard |
| `isStainless=false` | Recipe records/determines fixed final bearingSpan; no stainless derivation | partial: Recipe JSON can supply final value, but server still falls back through Shell/Template/Variant/current derivation when absent |

## No-code versus code-required boundary

After a generic category-extension and configuration-policy contract exists, ontology-definition-only changes can add approved Part/PumpShell/Recipe Fact metadata, labels, source mapping, roles, existing relations, and policy declarations.

Code remains legitimate for a new field/schema/API, a new data adapter, new policy execution/validation, a new derivation algorithm, runtime Entity Linking, or legacy migration. In particular, the existing Recipe `openOffset` representation and stainless guard are runtime/model work for a later authorized ticket, not documentation-only work.

## Ontology design impact — no implementation

The earlier category-extension conclusion remains, with one refinement:

- A generic `Part Base + Category Extension` composition mechanism is needed to avoid PumpShell fields on every Part.
- A generic **cross-entity configuration-policy** mechanism is also needed to declare that an upstream extension fact such as `PumpShell.isStainless` determines required/derived fields in a downstream Recipe profile.
- Recipe needs its own future profile with Technical Facts, Derived Facts, source/provenance, final authority designation and rotor-drawing evidence relation.

This is a generic contract-design finding, not a request for PumpShell-specific validator logic.

## Cost boundary remains separate

Technical authority moving to Recipe does not change cost authority:

- Template bundle mode uses `bundle_cost`.
- Components mode uses `shell_components_json` catalog pricing.
- PumpShell `parts.price` is not a universal BOM cost source.
- `recipeBomEngine` remains BOM construction and `costEngine` remains the full cost boundary.

## Genuine remaining Owner decisions

Already-resolved matters are intentionally omitted: detailed rotor parameters belong at Recipe authority; openOffset is not final PumpShell authority; stainless span is length minus offset; customer length is supported.

The remaining business decision is narrow: after Recipe technical authority is implemented, should any non-`isStainless` PumpShell metadata remain as an approved **optional prefill policy**, or should all historic technical defaults be strictly compatibility-only? This does not authorize implementation or legacy cleanup.

## Audit artifacts and boundary

- Detailed field, UI, current precedence, authority and debt register: `PumpShellSemanticAudit.md`.
- DB inspection performed: **NO**. Source/schema audit only.
