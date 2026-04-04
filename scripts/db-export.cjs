/**
 * NocoDB 数据导出脚本
 * 用法：node scripts/db-export.cjs
 * 输出：scripts/db-backup/ 目录下生成各表 JSON 文件
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

async function fetchAll(tableId) {
  const PAGE_SIZE = 200;
  let offset = 0;
  const all = [];
  while (true) {
    const url = `${BASE_URL}/api/v2/tables/${tableId}/records?limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, { headers: { 'xc-token': TOKEN } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for table ${tableId}`);
    const data = await res.json();
    const list = data.list || [];
    if (list.length === 0) break;
    all.push(...list);
    if (list.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function main() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  console.log('🔄 开始导出 NocoDB 数据...\n');

  for (const [name, tableId] of Object.entries(TABLES)) {
    if (!tableId) { console.log(`⚠️  跳过 ${name}（未配置表ID）`); continue; }
    try {
      const records = await fetchAll(tableId);
      const filePath = path.join(BACKUP_DIR, `${name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');
      console.log(`✅ ${name}: ${records.length} 条记录 → ${name}.json`);
    } catch (err) {
      console.error(`❌ ${name} 导出失败:`, err.message);
    }
  }

  // 同时备份 .env (去敏感信息前的完整版，方便新机器直接用)
  const envSrc = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envSrc)) {
    fs.copyFileSync(envSrc, path.join(BACKUP_DIR, '.env.backup'));
    console.log('✅ .env 已备份');
  }

  console.log(`\n🎉 导出完成！备份目录: ${BACKUP_DIR}`);
  console.log('📦 把 scripts/db-backup/ 文件夹拷贝到新电脑即可。');
}

main().catch(err => { console.error('导出失败:', err); process.exit(1); });
