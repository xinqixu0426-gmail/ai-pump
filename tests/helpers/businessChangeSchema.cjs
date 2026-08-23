const {
    BUSINESS_CHANGE_INDEXES_SQL,
    BUSINESS_CHANGE_SCHEMA_SQL,
} = require('../../api/database/schema.cjs');

function installBusinessChangeSchema(db) {
    db.exec(BUSINESS_CHANGE_SCHEMA_SQL);
    db.exec(BUSINESS_CHANGE_INDEXES_SQL);
    return db;
}

module.exports = { installBusinessChangeSchema };
