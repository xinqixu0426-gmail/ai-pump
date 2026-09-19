'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const Database = require('better-sqlite3');
const { createOntologyRelationResolver } = require('./resolver.cjs');
const { createOntologyTraversal } = require('./traversal.cjs');
let db;
try {
    db = new Database(workerData.databasePath, { readonly: true, fileMustExist: true, timeout: 100 });
    db.pragma('query_only = ON');
    const before = db.prepare('SELECT total_changes() n').get().n;
    // One consistent readonly SQLite snapshot spans both hops.
    const result = db.transaction(() => createOntologyTraversal({ resolver: createOntologyRelationResolver({ db }) }).traverse(workerData.request))();
    parentPort.postMessage(before === db.prepare('SELECT total_changes() n').get().n ? result : null);
} catch { parentPort.postMessage(null); }
finally { db?.close(); }
