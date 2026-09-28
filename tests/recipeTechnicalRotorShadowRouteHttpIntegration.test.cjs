const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-rotor-shadow-http-'));
process.env.NODE_ENV = 'test'; process.env.PUMP_TEST_DATABASE_PATH = path.join(directory, 'pump-{pid}.db'); process.env.JWT_SECRET = 'rotor-shadow-http-secret';
const express = require('express'); const cookieParser = require('cookie-parser'); const jwt = require('jsonwebtoken');
const auth = require('../api/authMiddleware.cjs'); const router = require('../api/routes/recipes.cjs'); const { db, stopBackupScheduler } = require('../api/db.cjs');
const NOW = '2026-09-28T00:00:00.000Z'; let server; let baseUrl;
function counts() { return Object.fromEntries(['recipe_functional_technical_profiles', 'recipe_technical_knowledge', 'audit_log', 'business_change_events', 'api_operations', 'knowledge_entries'].map(table => [table, Number(db.prepare(`SELECT count(*) count FROM ${table}`).get().count)])); }
test.before(async () => { const app = express(); app.use(express.json()); app.use(cookieParser()); app.use('/api', auth); app.use('/api/recipes', router); server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { stopBackupScheduler(); server?.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); if (db.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
test('HTTP Rotor shadow inspection is authenticated, canonical-aware, and has zero write side effects', async () => {
    const shell = Number(db.prepare(`INSERT INTO parts(model,category,remark,created_at,updated_at) VALUES ('s','泵壳','{"isStainless":false}',?,?)`).run(NOW, NOW).lastInsertRowid);
    db.prepare(`INSERT INTO parts(model,category,created_at,updated_at) VALUES ('轴承-6202','轴承',?,?),('轴承-6303','轴承',?,?)`).run(NOW, NOW, NOW, NOW);
    const template = Number(db.prepare(`INSERT INTO pump_shell_templates(shell_model,created_at,updated_at) VALUES ('s',?,?)`).run(NOW, NOW).lastInsertRowid);
    db.prepare(`INSERT INTO catalog_template_shell_bindings(template_id,shell_part_id,created_at,updated_at) VALUES (?,?,?,?)`).run(template, shell, NOW, NOW);
    const recipe = Number(db.prepare(`INSERT INTO recipes(name,template_id,coil_sheets,technical_data_json,created_at,updated_at) VALUES ('r',?,160,'{"rotorDiameter":52,"upperBearing":"6202"}',?,?)`).run(template, NOW, NOW).lastInsertRowid);
    const cookie = `token=${jwt.sign({ id: 1, username: 'rotor-shadow', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' })}`;
    const before = counts(); const response = await fetch(`${baseUrl}/api/recipes/${recipe}/technical-profile/rotor-shadow`, { headers: { cookie } }); const payload = await response.json();
    assert.equal(response.status, 200); assert.equal(payload.success, true); assert.equal(payload.data.recipeId, recipe); assert.equal(payload.data.canonical.mode, 'LEGACY_COMPATIBILITY_REQUIRED'); assert.equal(payload.data.legacy.mode, 'LEGACY_COMPATIBILITY'); assert.deepEqual(counts(), before);
});
