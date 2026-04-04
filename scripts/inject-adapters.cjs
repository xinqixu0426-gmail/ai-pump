const fs = require('fs');
let f = fs.readFileSync('api.cjs', 'utf8');

const marker = '// ── 通用 SQLite 辅助 ──';
const idx = f.indexOf(marker);
if (idx === -1) { console.log('marker not found'); process.exit(1); }

const insertAt = idx + marker.length;

const funcs = `

/** Row adapters: SQLite英文列 → 前端期望的大写Id + 中文字段(兼容) */
function partRow(r) {
    if (!r) return r;
    return { Id: r.id, model: r.model, category: r.category, price: r.price, supplier: r.supplier, stock: r.stock,
             '型号': r.model, '类别': r.category, '单价': r.price, '供应商': r.supplier, '库存': r.stock, '备注': r.remark || '',
             CreatedAt: r.created_at, UpdatedAt: r.updated_at };
}
function recipeRow(r) {
    if (!r) return r;
    return { Id: r.id, name: r.name, spec: r.spec, parts_json: r.parts_json,
             '配方名称': r.name, '规格': r.spec, '配件JSON': r.parts_json,
             saved_total_cost: r.saved_total_cost, '保存时总成本': r.saved_total_cost,
             saved_cost_details: r.saved_cost_details, '保存时成本明细': r.saved_cost_details,
             CreatedAt: r.created_at, UpdatedAt: r.updated_at };
}
function orderRow(r) {
    if (!r) return r;
    return { Id: r.id, '客户名称': r.customer_name, '合同号': r.contract_no, '备注': r.remark,
             '订单状态': r.status, '型号列表JSON': r.items_json,
             '采购清单JSON': r.purchase_list_json, '采购TodoJSON': r.todos_json,
             CreatedAt: r.created_at, UpdatedAt: r.updated_at };
}
function coilRow(r) {
    if (!r) return r;
    return { Id: r.id, '规格': r.spec, '单价': r.unit_price, '片数': r.sheets,
             '默认线重': r.wire_weight, '铜价基数': r.copper_base,
             '线圈加工费': r.coil_fee, '转子加工费': r.rotor_fee,
             '成本': r.cost, '默认电容_uf': r.default_capacitor, '默认线径': r.default_wire_gauge,
             CreatedAt: r.created_at, UpdatedAt: r.updated_at };
}

// ── 数据访问层 ──
function dbGetAllParts() { return db.prepare('SELECT * FROM parts').all().map(partRow); }
function dbGetAllRecipes() { return db.prepare('SELECT * FROM recipes').all().map(recipeRow); }
function dbGetAllOrders() { return db.prepare('SELECT * FROM orders').all().map(orderRow); }
function dbGetAllCoils() { return db.prepare('SELECT * FROM coils').all().map(coilRow); }
`;

f = f.substring(0, insertAt) + funcs + f.substring(insertAt);
fs.writeFileSync('api.cjs', f);
console.log('✅ Injected row adapters + dbGetAll functions');
