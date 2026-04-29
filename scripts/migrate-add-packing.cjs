// scripts/migrate-add-packing.cjs
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'pump.db');
const db = new Database(dbPath);

console.log('开始迁移：添加 packing_parts_json 字段...');

// 检查字段是否已存在
const cols = db.prepare("PRAGMA table_info(recipes)").all();
const exists = cols.some(c => c.name === 'packing_parts_json');

if (exists) {
  console.log('字段已存在，跳过 ALTER TABLE');
} else {
  db.prepare("ALTER TABLE recipes ADD COLUMN packing_parts_json TEXT DEFAULT '[]'").run();
  console.log('✓ 新增字段 packing_parts_json');
}

// 迁移旧 box_type 数据
const result = db.prepare(`
  UPDATE recipes
  SET packing_parts_json = json_array(
    json_object('model', box_type, 'supplier', '', 'qty', 1)
  )
  WHERE box_type IS NOT NULL
    AND box_type != ''
    AND (packing_parts_json IS NULL OR packing_parts_json = '[]')
`).run();

console.log(`✓ 迁移旧 box_type 数据：${result.changes} 行`);
db.close();
console.log('迁移完成');
