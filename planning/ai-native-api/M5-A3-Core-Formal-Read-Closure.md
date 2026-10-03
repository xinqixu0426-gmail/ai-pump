# M5-A3 Core Formal Read Registration Closure

## Scope and boundary

This phase registers six pre-existing low-risk formal read/preview contracts and
adds eight accurate AI-action metadata links. It does not add a route, change an
executor, alter tool schema, change cost arithmetic, expose an API Index, or
weaken any write guard. The A2 mapping audit remains historical evidence and was
not rewritten.

The audited start commit is `39e3c4ec8db2433da1bd416d4163325d5df682d8`.

## Why these six gaps, not all A2 gaps

They are the small, mature read/preview set needed by the first Owner-facing
investigation surface: order readiness, an order knowledge package, recipe
technical files, formal coil cost preview, current copper price, and coil spec
options. The other A2 gaps remain deliberately unregistered until their route
semantics and future exposure need are separately approved.

| Formal capability | Existing route | Kind | Formal source of truth |
| --- | --- | --- | --- |
| `orders.readiness.read` | `GET /api/orders/:id/readiness` | query | Order/readiness services and their live planning inputs |
| `orders.knowledge_package.read` | `GET /api/orders/:id/knowledge-package` | query | Live order, readiness, confirmed requirements/execution records and linked files |
| `recipes.technical_files.list` | `GET /api/recipes/:id/technical-files` | query | Recipe technical-file query service |
| `coils.cost_preview` | `POST /api/coils/calculate` | preview | Existing `coilCost` calculation service and formal coil data |
| `market.copper_price.read` | `GET /api/copper-price` | query | Daily market snapshot and adopted coil copper basis |
| `coils.spec_options.read` | `GET /api/coils/specs` | query | Formal coil/stator option query |

All six are `riskLevel: low`, callable by `web`, `ai`, and `internal`, require
no confirmation, and add no write capability.

## AI action links

Two direct links are accurate because the Executor delegates to the existing
authoritative recipe-difference route; their extra presentation does not perform
new cost arithmetic:

- `compare_recipes` → `cost.recipe_difference`
- `explain_cost_change` → `cost.recipe_difference`

The six core gap links are:

- `check_order_readiness` → `orders.readiness.read`
- `get_order_knowledge_package` → `orders.knowledge_package.read`
- `get_recipe_technical_files` → `recipes.list`, `recipes.technical_files.list`
- `calculate_coil_cost` → `coils.list`, `coils.cost_preview`
- `get_copper_price` → `market.copper_price.read`
- `get_coil_specs` → `coils.spec_options.read`

`calculate_coil_cost` is intentionally composite: `coils.list` supplies formal
scheme discovery/identity evidence, while `coils.cost_preview` is the cost
authority. Copper-price read is distinct from `market.sync_copper_price`, which
is maintenance/write. The following A2 composites remain unlinked by design:
`search_factory_knowledge`, `get_factory_knowledge_detail`, `get_order_detail`,
and `get_recipe_detail`.

## Contract and safety verification

The A3 regression covers FR-01 through FR-18: registry presence, read/preview
access, confirmation safety, AI action links, route method/path alignment, and
the unchanged executor/schema/broker/main-agent boundary. It also updates the
A2 audit helper to report an approved A2 proposal as
`REGISTERED_SINCE_A2`, without altering A2's frozen artifacts.

Current automated registry facts:

- Formal capability count: **147 → 153**
- AI actions: **84**
- Explicitly linked AI actions: **48 → 56**
- Remaining unlinked actions: **28**
- Broken declared formal links: **0**
- Registry write capability count: **101 → 101**
- A3-added write capabilities and write executions: **0**

The machine-readable registry snapshot, link matrix, and regression evidence
are recorded alongside this report.

## Full gates

| Gate | Result |
| --- | --- |
| `npm test` | PASS — 2239/2239 |
| `npm run verify:api-contract` | PASS — 29/29 |
| `npm run test:deep-api` | PASS — 486/486 (the first isolated-port startup collided with a transient listener; the clean retry passed) |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run test:ai-architecture` | PASS — 9/9 |
| `npm run verify:ai-assistant-release` | PASS |

## API Index readiness

The following existing AI actions now have honest formal backing suitable for a
later API Index decision: recipe difference/comparison, single-order readiness,
single-order knowledge package, recipe technical files, formal coil cost
preview, copper-price read, and coil-spec options. This phase does **not** create
an API Index or alter current tool exposure.

## Recommendation

The core V1 read/preview foundation is ready for Supervisor review once the full
repository gates pass. Remaining composites and A2 gaps should be evaluated by
future exposure policy rather than forced into one-to-one registry mappings.
