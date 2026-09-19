'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const Database = require('better-sqlite3');
const { createOntologyRelationResolver } = require('./resolver.cjs');
let db;
try {
    db = new Database(workerData.databasePath, { readonly: true, fileMustExist: true, timeout: 100 });
    db.pragma('query_only = ON');
    const before = db.prepare('SELECT total_changes() AS n').get().n;
    const result = createOntologyRelationResolver({ db }).resolveRelation(workerData.request);
    const after = db.prepare('SELECT total_changes() AS n').get().n;
    parentPort.postMessage(before === after ? result : { success: false, status: 'TECHNICAL_FAILURE' });
} catch {
    parentPort.postMessage({ success: false, status: 'TECHNICAL_FAILURE', code: 'SHADOW_DATABASE_UNAVAILABLE' });
} finally { db?.close(); }
