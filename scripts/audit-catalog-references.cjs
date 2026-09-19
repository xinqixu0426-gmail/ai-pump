const path = require('node:path');
const Database = require('better-sqlite3');
const { auditCatalogReferences } = require('../api/services/catalogReferenceAudit.cjs');

function run(args = process.argv.slice(2)) {
    if (args.length > 1 || args.some(arg => arg.startsWith('-'))) throw new Error('用法：node scripts/audit-catalog-references.cjs [数据库路径]；该命令仅支持只读盘点');
    const databasePath = path.resolve(args[0] || path.join(__dirname, '..', 'pump.db'));
    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
        db.pragma('query_only = ON');
        const report = auditCatalogReferences(db);
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (!report.complete) process.exitCode = 2;
    } finally {
        db.close();
    }
}

if (require.main === module) {
    try { run(); }
    catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { run };
