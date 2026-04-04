/**
 * NocoDB 数据导入脚本
 * 用法：node scripts/db-import.cjs
 * 
 * 前提：
 *   1. 新电脑上 NocoDB 已启动且能访问
 *   2. 在 NocoDB 后台手动建好空的 base（会自动生成表ID）
 *   3. .env 中已填入新机器的表ID和Token
 *   4. scripts/db-backup/ 下有之前导出的 JSON 文件
 * 
 * 注意：此脚本会向目标表批量插入数据，不会清空已有数据。
 *       如果表里已有数据，建议先手动清空或新建空表。
 */

try { process.loadEnvFile(); } catch {}

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.VITE_NOCO_BASE_URL || 'http://localhost:8080';
const TOKEN = process.env.VITE_NOCO_API_TOKEN || '';

const TABLES = {
  parts:   process.env.VITE_NOCO_PARTS_TABLE,
  recipes: process.env.VITE_NOCO_RECIPES_TABLE,
  orders:  process.env.VITE_NOCO_ORDERS_TABLE,
  coils:   process.env.VITE_NOCO_COILS_TABLE,
  config:  process.env.VITE_NOCO_CONFIG_TABLE,
};

const BACKUP_DIR = path.join(__dirname, 'db-backup');

// NocoDB 内部字段，导入时需要剥离，否则会报错
const STRIP_FIELDS = ['Id', 'CreatedAt', 'UpdatedAt', 'nc_order'];

function cleanRecord(record) {
  const cleaned = {};
  for (const [key, value] of Object.entries(record)) {
    if (STRIP_FIELDS.includes(key)) continue;
    if (key.startsWith('nc_')) continue;  // NocoDB 内部元字段
    cleaned[key] = value;
  }
  return cleaned;
}

async function insertBatch(tableId, records) {
  // NocoDB 批量插入最大 100 条
  const BATCH_SIZE = 100;
  let inserted = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE).map(cleanRecord);
    const res = await fetch(`${BASE_URL}/api/v2/tables/${tableId}/records`, {
      method: 'POST',
      headers: { 'xc-token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    inserted += batch.length;
  }
  return inserted;
}

async function main() {
  console.log('🔄 开始导入数据到 NocoDB...\n');

  // 按依赖顺序导入：零件 → 线圈 → 配方 → 订单 → 配置
  const importOrder = ['parts', 'coils', 'recipes', 'orders', 'config'];

  for (const name of importOrder) {
    const tableId = TABLES[name];
    if (!tableId) { console.log(`⚠️  跳过 ${name}（未配置表ID）`); continue; }

    const filePath = path.join(BACKUP_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  跳过 ${name}（未找到 ${name}.json）`);
      continue;
    }

    try {
      const records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (records.length === 0) {
        console.log(`⏭️  ${name}: 0 条记录，跳过`);
        continue;
      }
      const count = await insertBatch(tableId, records);
      console.log(`✅ ${name}: 成功导入 ${count} 条记录`);
    } catch (err) {
      console.error(`❌ ${name} 导入失败:`, err.message);
    }
  }

  console.log('\n🎉 导入完成！');
  console.log('💡 提示：导入后记录的 Id 会重新自增生成，但数据内容完全一致。');
  console.log('   如果你的 .env 中表ID是新建的表，记得更新 .env 文件。');
}

main().catch(err => { console.error('导入失败:', err); process.exit(1); });
