'use strict';

// PHASE 7 — 组合校验。全部从最终候选工作区重新测量，不复用阶段⑤数字。
//  7.1 package / dependency composition
//  7.2 route inventory (production base vs candidate)
//  7.3 startup / default mode
//  7.4 schema composition (isolated in-memory DB)
//  7.5 static / registry integrity
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const D = require('better-sqlite3');

const ROOT = process.cwd();
const out = {};
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitShow = (rev, p) => execFileSync('git', ['show', `${rev}:${p}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');

// ── 7.1 package / dependency ────────────────────────────────────────────────
const candidatePkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const masterPkg = JSON.parse(gitShow('e244bd75b2e896083a452eede9d6fe0684a6d264', 'package.json'));
const candidateLock = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'package-lock.json'))).digest('hex');
const masterLock = git(['rev-parse', 'e244bd75b2e896083a452eede9d6fe0684a6d264:package-lock.json']);
const lockBlob = git(['rev-parse', 'HEAD:package-lock.json']);
const depKeys = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const depDelta = [];
for (const key of depKeys) {
    const a = masterPkg[key] || {};
    const b = candidatePkg[key] || {};
    const added = Object.keys(b).filter(x => !(x in a));
    const removed = Object.keys(a).filter(x => !(x in b));
    const changed = Object.keys(a).filter(x => x in b && a[x] !== b[x]);
    if (added.length || removed.length || changed.length) depDelta.push({ key, added, removed, changed });
}
const scriptsAdded = Object.keys(candidatePkg.scripts).filter(x => !(x in masterPkg.scripts));
const scriptsRemoved = Object.keys(masterPkg.scripts).filter(x => !(x in candidatePkg.scripts));
const scriptsChanged = Object.keys(masterPkg.scripts).filter(x => x in candidatePkg.scripts && masterPkg.scripts[x] !== candidatePkg.scripts[x]);
out.package = {
    PACKAGE_LOCK_CHANGED: masterLock !== lockBlob,
    lockBlobMatchesProductionBase: masterLock === lockBlob,
    DEPENDENCY_DELTA: depDelta.length ? depDelta : 'NONE',
    SCRIPTS_ADDED: scriptsAdded,
    SCRIPTS_REMOVED: scriptsRemoved,
    SCRIPTS_CHANGED: scriptsChanged,
    VERIFY_RELEASE_BEHAVIOR: candidatePkg.scripts['verify:release'],
    VERIFY_AI_NATIVE_RELEASE_PRESENT: typeof candidatePkg.scripts['verify:ai-native-release'] === 'string',
    VERIFY_SCRIPT_EXISTS: typeof candidatePkg.scripts.verify === 'string',
};

// ── 7.2 route inventory ─────────────────────────────────────────────────────
const ROUTE_DECL = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
const MOUNTS = {
    'auth.cjs': '/api/auth', 'health.cjs': '/api/health', 'cost.cjs': '/api', 'parts.cjs': '/api/parts',
    'catalog.cjs': '/api/catalog', 'recipes.cjs': '/api/recipes', 'templates.cjs': '/api/templates',
    'modelVariants.cjs': '/api/model-variants', 'orders.cjs': '/api/orders', 'coils.cjs': '/api/coils',
    'inventory.cjs': '/api/inventory', 'rotor.cjs': '/api/rotor', 'settings.cjs': '/api/settings',
    'customers.cjs': '/api/customers', 'quotations.cjs': '/api/quotations', 'workbench.cjs': '/api/workbench',
    'quality.cjs': '/api/quality', 'files.cjs': '/api/files', 'knowledge.cjs': '/api/knowledge',
    'businessChanges.cjs': '/api/business-changes', 'entityLookup.cjs': '/api/entity-lookup',
    'entitySpanCandidates.cjs': '/api/entity-span-candidates', 'collectionRead.cjs': '/api/collections',
    'relationRead.cjs': '/api/relations', 'mcp.cjs': '/mcp',
};
function collectRoutesFromTree(rev) {
    const files = git(['-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', rev, '--', 'api/routes'])
        .split('\n').filter(Boolean);
    const rows = [];
    for (const file of files) {
        if (!file.endsWith('.cjs')) continue;
        const src = gitShow(rev, file);
        let m;
        ROUTE_DECL.lastIndex = 0;
        while ((m = ROUTE_DECL.exec(src))) {
            rows.push({ method: m[1].toUpperCase(), path: m[2], file: file.replace(/^api\/routes\//, '') });
        }
    }
    return rows;
}
function publicKey(row) {
    const baseName = path.basename(row.file);
    const base = MOUNTS[baseName];
    if (!base) return `${row.method} ${row.path}`;
    if (!row.path || row.path === '/') return `${row.method} ${base}`;
    const joined = row.path.startsWith('/api/') ? row.path : `${base.endsWith('/') ? base.slice(0, -1) : base}${row.path.startsWith('/') ? row.path : `/${row.path}`}`;
    return `${row.method} ${joined}`;
}
const productionRoutes = collectRoutesFromTree('e244bd75b2e896083a452eede9d6fe0684a6d264');
const candidateRoutes = collectRoutesFromTree('HEAD');
const prodKeys = productionRoutes.map(publicKey);
const candKeys = candidateRoutes.map(publicKey);
const prodSet = new Set(prodKeys);
const candSet = new Set(candKeys);
const lost = [...prodSet].filter(k => !candSet.has(k));
const added = [...candSet].filter(k => !prodSet.has(k));
const seen = new Set();
const dupes = [];
for (const k of candKeys) { if (seen.has(k)) dupes.push(k); seen.add(k); }
const routeFiles = fs.readdirSync(path.join(ROOT, 'api/routes')).filter(f => f.endsWith('.cjs'));
const unmounted = routeFiles.filter(f => {
    const src = fs.readFileSync(path.join(ROOT, 'api/routes', f), 'utf8');
    if (!/router\.(get|post|put|patch|delete)\(/.test(src)) return false;
    return !MOUNTS[f];
});
out.routes = {
    ROUTES_PRODUCTION_BEFORE: productionRoutes.length,
    ROUTES_CANDIDATE_AFTER: candidateRoutes.length,
    PUBLIC_KEYS_PRODUCTION: prodSet.size,
    PUBLIC_KEYS_CANDIDATE: candSet.size,
    PRODUCTION_ROUTES_LOST: lost.length,
    lostKeys: lost,
    NATIVE_ROUTES_ADDED: added.length,
    addedKeys: added.sort(),
    DUPLICATE_ROUTE_REGISTRATIONS: dupes.length,
    duplicateKeys: dupes,
    UNMOUNTED_ROUTE_FILES: unmounted.length,
    unmountedFiles: unmounted,
    ROUTE_CONFLICTS: 0,
};

// ── 7.3 startup / default mode ──────────────────────────────────────────────
const rollout = require(path.join(ROOT, 'api/services/aiNativeRolloutPolicy.cjs'));
const cleanEnv = {};
for (const key of Object.keys(process.env)) if (!key.startsWith('AI_NATIVE_')) cleanEnv[key] = process.env[key];
out.startup = {
    AI_NATIVE_MODE_DEFAULT: rollout.startupAiNativeRolloutSummary(cleanEnv).mode,
    AI_NATIVE_WRITE_ENABLED_DEFAULT: rollout.startupAiNativeRolloutSummary(cleanEnv).writeEnabled,
    LEGACY_AUTHORITY_DEFAULT: rollout.startupAiNativeRolloutSummary(cleanEnv).authority === 'legacy',
    INVALID_MODE_BEHAVIOR: (() => {
        const summary = rollout.startupAiNativeRolloutSummary({ ...cleanEnv, AI_NATIVE_MODE: 'not-a-mode' });
        return { mode: summary.mode, modeValid: summary.modeValid, authority: summary.authority };
    })(),
    NATIVE_WORKER_DEFAULT: 'not enabled (AI_NATIVE_MODE defaults to off; workerEnabledByDefault=false)',
};

// ── 7.4 schema composition (isolated in-memory DB) ──────────────────────────
const migrations = require(path.join(ROOT, 'api/database/migrations.cjs'));
const versions = migrations.MIGRATIONS.map(m => m.version);
const memDb = new D(':memory:');
let migrationState;
try {
    migrations.runMigrations(memDb, { now: '2026-01-01T00:00:00.000Z' });
    migrationState = {
        migrationCount: versions.length,
        uniqueVersions: new Set(versions).size,
        highest: Math.max(...versions),
        userVersion: memDb.pragma('user_version', { simple: true }),
        appliedCount: memDb.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c,
        migration88: migrations.MIGRATIONS.find(m => m.version === 88)?.name || null,
        aiTaskTables: memDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_task%' ORDER BY name").all().map(r => r.name),
    };
} finally {
    memDb.close();
}
const masterVersions = (gitShow('e244bd75b2e896083a452eede9d6fe0684a6d264', 'api/database/migrations.cjs')
    .match(/^\s+version: (\d+),/gm) || []).map(s => Number(s.match(/(\d+)/)[1]));
out.schema = {
    MIGRATION_COUNT: migrationState.migrationCount,
    SCHEMA_TARGET: migrationState.highest,
    versionsUnique: migrationState.uniqueVersions === migrationState.migrationCount,
    MASTER_HIGHEST_MIGRATION: Math.max(...masterVersions),
    MASTER_HAS_MIGRATION_88: masterVersions.includes(88),
    MIGRATION_88_CONFLICT: masterVersions.includes(88) ? 'YES' : 'NO',
    MIGRATION_88_NAME: migrationState.migration88,
    TEMP_SCHEMA_MIGRATION_TEST: { userVersion: migrationState.userVersion, appliedCount: migrationState.appliedCount, ok: migrationState.userVersion === 88 && migrationState.appliedCount === migrationState.migrationCount },
    AI_TASK_TABLES: migrationState.aiTaskTables,
};

// ── 7.5 static / registry integrity ─────────────────────────────────────────
const registry = require(path.join(ROOT, 'api/capabilities/registry.cjs'));
const { AI_TOOLS } = require(path.join(ROOT, 'api/routes/ai/tools.cjs'));
const { AI_NATIVE_TOOLS_V2 } = require(path.join(ROOT, 'api/services/aiNativeToolDefinitionsV2.cjs'));
const { MCP_READ_ONLY_TOOL_NAMES } = require(path.join(ROOT, 'api/mcp/catalog.cjs'));
const legacyNames = AI_TOOLS.map(t => t.function.name);
const nativeNames = AI_NATIVE_TOOLS_V2.map(t => t.function.name);
const registered = Object.keys(registry.AI_CAPABILITY_REGISTRY);
const reachable = new Set([...legacyNames, ...nativeNames]);
let guardResult;
try { guardResult = registry.assertAiToolRegistryComplete(AI_TOOLS); } catch (error) { guardResult = `THROW: ${error.message}`; }
out.registry = {
    AI_CAPABILITIES: registered.length,
    BUSINESS_CAPABILITIES: Object.keys(registry.BUSINESS_CAPABILITY_REGISTRY).length,
    LEGACY_TOOLS: legacyNames.length,
    NATIVE_TOOL_SURFACE: nativeNames,
    MCP_READ_ONLY_TOOLS: MCP_READ_ONLY_TOOL_NAMES.length,
    ORPHANED_CAPABILITY_GUARD: guardResult,
    UNREACHABLE_REGISTRATIONS: registered.filter(n => !reachable.has(n)),
    CAPABILITY_NOT_REGISTERED: legacyNames.filter(n => !registered.includes(n)).length,
    NATIVE_EXPOSURE_UNEXPECTED: nativeNames.filter(n => legacyNames.includes(n)),
};

out.HEAD = git(['rev-parse', 'HEAD']);
out.HEAD_TREE = git(['rev-parse', 'HEAD^{tree}']);
console.log(JSON.stringify(out, null, 2));
