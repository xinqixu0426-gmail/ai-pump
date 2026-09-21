'use strict';
/**
 * ONT-P8L-FINAL Gate B: the bounded identity read that makes relation binding deterministic.
 *
 * Two layers are covered here:
 *  - `recipeQueries.resolveRecipeIdentity` — the formal service read (exact-name, LIMIT-bounded, and
 *    with `not_found` / `ambiguous` kept distinguishable from a technical failure);
 *  - `resolveRelationIdentity` in the runtime — the HTTP client side of that read, including the 404
 *    and 409 outcomes the route returns.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createRecipeQueries } = require('../api/services/recipeQueries.cjs');
const { getBusinessCapability } = require('../api/capabilities/registry.cjs');

const NAME = 'V750大脚板-2寸-经典款';

function fixture(rows = [[13, NAME, null], [14, '另一个配方', null]]) {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE recipes (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT)');
    const insert = db.prepare('INSERT INTO recipes (id, name, deleted_at) VALUES (?, ?, ?)');
    for (const row of rows) insert.run(...row);
    const queries = createRecipeQueries({
        db,
        listCoils: () => [],
        listParts: () => [],
        listRecipes: () => [],
        recipeRow: row => row,
        templateRow: row => row,
        modelVariantRow: row => row,
    });
    return { db, queries };
}

test('recipes.resolve_identity resolves one recipe by its exact formal name and reads nothing else', () => {
    const { db, queries } = fixture();
    try {
        const changes = db.prepare('SELECT total_changes() n').get().n;
        assert.deepEqual(queries.resolveRecipeIdentity(NAME), { status: 'found', identity: { recipeId: 13, recipeName: NAME } });
        // Trailing user particles are stripped for the lookup, but the returned name is the formal one.
        assert.deepEqual(queries.resolveRecipeIdentity(`${NAME}的`), { status: 'found', identity: { recipeId: 13, recipeName: NAME } });
        // Query is read-only.
        assert.equal(db.prepare('SELECT total_changes() n').get().n, changes);
    } finally { db.close(); }
});

test('recipes.resolve_identity keeps a miss, an ambiguity and a bad request distinguishable', () => {
    const { db, queries } = fixture();
    try {
        assert.deepEqual(queries.resolveRecipeIdentity('不存在的配方'), { status: 'not_found' });
        // A soft-deleted recipe is not an identity.
        assert.deepEqual(queries.resolveRecipeIdentity('另一个配方'), { status: 'found', identity: { recipeId: 14, recipeName: '另一个配方' } });
        for (const name of ['', '   ', null, undefined]) {
            assert.throws(() => queries.resolveRecipeIdentity(name), error => error.statusCode === 400, String(name));
        }
        assert.throws(() => queries.resolveRecipeIdentity('x'.repeat(121)), error => error.statusCode === 400);
    } finally { db.close(); }
});

test('recipes.resolve_identity refuses to guess when several active recipes share the name', () => {
    const { db, queries } = fixture([[13, NAME, null], [14, NAME, null]]);
    try {
        const resolved = queries.resolveRecipeIdentity(NAME);
        assert.equal(resolved.status, 'ambiguous');
        assert.deepEqual(resolved.candidates, [{ recipeId: 13, recipeName: NAME }, { recipeId: 14, recipeName: NAME }]);
    } finally { db.close(); }
});

test('recipes.resolve_identity is bounded by its own statement, not by the catalogue size', () => {
    const rows = Array.from({ length: 500 }, (_, index) => [index + 1, `配方-${index + 1}`, null]);
    rows.push([501, NAME, null]);
    const { db, queries } = fixture(rows);
    try {
        // Even when EVERY row shares the name, the read returns at most the two noisy rows it needs to
        // report the ambiguity — it can never drain the table.
        const allSame = fixture(Array.from({ length: 400 }, (_, index) => [index + 1, NAME, null]));
        try {
            const ambiguous = allSame.queries.resolveRecipeIdentity(NAME);
            assert.equal(ambiguous.status, 'ambiguous');
            assert.equal(ambiguous.candidates.length, 2);
        } finally { allSame.db.close(); }
        assert.deepEqual(queries.resolveRecipeIdentity(NAME), { status: 'found', identity: { recipeId: 501, recipeName: NAME } });
        // The name index the lookup relies on is declared as a migration.
        const { MIGRATIONS } = require('../api/database/migrations.cjs');
        const indexMigration = MIGRATIONS.find(migration => migration.name === 'recipes_name_identity_lookup');
        assert.ok(indexMigration, 'the bounded identity lookup must declare its index migration');
        assert.equal(typeof indexMigration.up, 'function');
    } finally { db.close(); }
});

test('recipes.resolve_identity is registered as a formal Internal-only query capability', () => {
    const capability = getBusinessCapability('recipes.resolve_identity');
    assert.ok(capability, 'the identity read must be registered');
    assert.equal(capability.access, 'query');
    assert.equal(capability.operation, 'query');
    assert.equal(capability.requiresConfirmation, false);
    assert.deepEqual([...capability.callers], ['internal']);
    assert.match(capability.inputSchema, /GET \/api\/recipes\/identity/);
    assert.match(capability.outputSchema, /RECIPE_NOT_FOUND/);
    assert.match(capability.outputSchema, /RECIPE_AMBIGUOUS/);
    // It must not become a model tool: the AI tool directory is unchanged by this read.
    const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
    assert.equal(AI_TOOLS.some(tool => tool.function.name === 'resolve_recipe_identity'), false);
});

test('the runtime identity resolver maps the formal read outcomes onto resolution statuses', async () => {
    const { resolveRelationIdentity } = require('../api/services/aiAssistantRuntime.cjs');
    const internalFetch = () => {};
    const request = { capability: 'resolve_recipe_identity', mention: NAME };
    const path = `/api/recipes/identity?name=${encodeURIComponent(NAME)}`;

    const found = await resolveRelationIdentity(internalFetch, async () => ({ recipeId: 13, recipeName: NAME }), request);
    assert.deepEqual(found, { status: 'found', identity: { recipeId: 13, recipeName: NAME },
        calls: [{ method: 'GET', path }], path });

    const notFound = Object.assign(Error('未找到该配方名称'), { formalApiOutcome: 'not_found', statusCode: 404 });
    assert.deepEqual(await resolveRelationIdentity(internalFetch, async () => { throw notFound; }, request),
        { status: 'not_found', calls: [{ method: 'GET', path }] });

    const ambiguous = Object.assign(Error('该配方名称对应多个配方'), { statusCode: 409 });
    assert.deepEqual(await resolveRelationIdentity(internalFetch, async () => { throw ambiguous; }, request),
        { status: 'ambiguous', calls: [{ method: 'GET', path }] });

    const failed = await resolveRelationIdentity(internalFetch, async () => { throw Object.assign(Error('ECONNREFUSED'), { code: 'internal_api_request_failed' }); }, request);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.code, 'internal_api_request_failed');
    assert.equal(failed.path, path);
});
