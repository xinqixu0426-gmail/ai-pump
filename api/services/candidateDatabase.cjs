'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');
const { MIGRATIONS, migrationChecksum } = require('../database/migrations.cjs');

function candidateEnabled(env = process.env) {
    return env.PUMP_V5_CANDIDATE_RUNTIME === 'true';
}

function assertCompatibleSchema(db) {
    const rows = db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
    if (rows.length !== MIGRATIONS.length || rows.some((row, i) => {
        const migration = MIGRATIONS[i];
        return row.version !== migration.version || row.name !== migration.name
            || row.checksum !== migrationChecksum(migration);
    }) || db.pragma('user_version', { simple: true }) !== MIGRATIONS.at(-1).version) {
        throw new Error('CANDIDATE_SCHEMA_INCOMPATIBLE');
    }
}

function openCandidateDatabase(file) {
    if (!file || !path.isAbsolute(file)) throw new Error('CANDIDATE_DATABASE_PATH_REQUIRED');
    // Native SQLITE_OPEN_READONLY is permanent for the lifetime of this handle.
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try { assertCompatibleSchema(db); }
    catch { db.close(); throw new Error('CANDIDATE_SCHEMA_INCOMPATIBLE'); }
    const prepare = db.prepare.bind(db);
    const deny = () => { throw new Error('CANDIDATE_MUTATION_BLOCKED'); };
    db.prepare = sql => {
        const statement = prepare(sql);
        // reader includes RETURNING; readonly is SQLite's compiled-statement property.
        if (!statement.readonly || /^\s*(?:PRAGMA|ATTACH|DETACH|VACUUM)/i.test(sql)) {
            for (const method of ['run', 'get', 'all', 'iterate']) statement[method] = deny;
        }
        return statement;
    };
    // No ad-hoc SQL, write/read pragmas, backup destinations or extension loading.
    for (const method of ['exec', 'pragma', 'backup', 'loadExtension']) db[method] = deny;
    return db;
}

module.exports = { candidateEnabled, assertCompatibleSchema, openCandidateDatabase };
