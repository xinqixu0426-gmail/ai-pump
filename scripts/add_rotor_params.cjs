const db = require('better-sqlite3')('pump.db');

// Add rotor_params_json column
try {
    db.exec("ALTER TABLE pump_shell_templates ADD COLUMN rotor_params_json TEXT DEFAULT '{}'");
    console.log('Column added');
} catch (e) {
    if (e.message.includes('duplicate column')) console.log('Column already exists');
    else throw e;
}

// Pre-fill V750 with known rotor params
const v750Params = {
    bearing_span: 165,
    stack_offset: 24
};
db.prepare("UPDATE pump_shell_templates SET rotor_params_json = ? WHERE shell_model = 'V750'")
    .run(JSON.stringify(v750Params));
console.log('V750 rotor params set:', v750Params);

db.close();
