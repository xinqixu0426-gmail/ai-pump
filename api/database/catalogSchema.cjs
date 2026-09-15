// Additive storage only. Backfilling identities or changing catalog names is an
// explicit business maintenance operation, never a startup migration.
const CATALOG_IDENTITY_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS catalog_identity_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        part_id INTEGER UNIQUE REFERENCES parts(id),
        coil_id INTEGER UNIQUE REFERENCES coils(id),
        template_id INTEGER UNIQUE REFERENCES pump_shell_templates(id),
        recipe_id INTEGER UNIQUE REFERENCES recipes(id),
        model_variant_id INTEGER UNIQUE REFERENCES pump_model_variants(id),
        naming_state TEXT NOT NULL DEFAULT 'legacy' CHECK(naming_state IN ('legacy', 'structured')),
        rule_id TEXT,
        rule_version INTEGER NOT NULL DEFAULT 1 CHECK(rule_version > 0),
        spec_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(spec_json) AND json_type(spec_json) = 'object'),
        spec_fingerprint TEXT NOT NULL DEFAULT '',
        spec_revision INTEGER NOT NULL DEFAULT 1 CHECK(spec_revision > 0),
        name_revision INTEGER NOT NULL DEFAULT 1 CHECK(name_revision > 0),
        external_model TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK((part_id IS NOT NULL) + (coil_id IS NOT NULL) + (template_id IS NOT NULL)
            + (recipe_id IS NOT NULL) + (model_variant_id IS NOT NULL) = 1),
        CHECK(naming_state = 'legacy' OR (rule_id IS NOT NULL AND length(rule_id) > 0 AND length(spec_fingerprint) = 64))
    );
    CREATE TABLE IF NOT EXISTS catalog_name_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES catalog_identity_profiles(id),
        alias TEXT NOT NULL CHECK(length(trim(alias)) BETWEEN 1 AND 180),
        spec_revision INTEGER NOT NULL CHECK(spec_revision > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE(profile_id, alias, spec_revision)
    );
    CREATE INDEX IF NOT EXISTS idx_catalog_alias_lookup ON catalog_name_aliases(alias, deleted_at, profile_id);
    CREATE TABLE IF NOT EXISTS catalog_reference_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL CHECK(source_type IN ('part', 'coil', 'template', 'recipe', 'modelVariant', 'quotation', 'order', 'orderRevision', 'drawing', 'fileLink')),
        source_id INTEGER NOT NULL CHECK(source_id > 0),
        source_version TEXT NOT NULL,
        source_path TEXT NOT NULL CHECK(substr(source_path, 1, 1) = '/'),
        source_hash TEXT NOT NULL CHECK(length(source_hash) = 64),
        target_profile_id INTEGER NOT NULL REFERENCES catalog_identity_profiles(id),
        target_spec_revision INTEGER NOT NULL CHECK(target_spec_revision > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE(source_type, source_id, source_version, source_path, source_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_catalog_binding_source ON catalog_reference_bindings(source_type, source_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_catalog_binding_target ON catalog_reference_bindings(target_profile_id, deleted_at);
    CREATE TABLE IF NOT EXISTS catalog_template_shell_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL UNIQUE REFERENCES pump_shell_templates(id),
        shell_part_id INTEGER NOT NULL REFERENCES parts(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
`;

module.exports = { CATALOG_IDENTITY_SCHEMA_SQL };
