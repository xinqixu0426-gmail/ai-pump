const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'pump.db');

console.log('🌱 开始生成水泵ERP系统的演示数据...');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- 清空现有数据 (可选，这里先清空以便可以重复运行) ---
db.exec(`
    DELETE FROM parts;
    DELETE FROM recipes;
    DELETE FROM orders;
    DELETE FROM coils;
    
    -- 重置自增ID
    UPDATE sqlite_sequence SET seq = 0 WHERE name IN ('parts', 'recipes', 'orders', 'coils');
`);

console.log('✅ 已清空旧数据');

// --- 插入 配件 (Parts) ---
const partsData = [
    { model: '100Y-120 铸铁泵壳', category: '泵体', price: 45.5, supplier: '立信铸造', stock: 120, remark: '黑色烤漆' },
    { model: 'WQD 系列不锈钢电机壳', category: '壳体', price: 32.0, supplier: '晨光五金', stock: 85, remark: '304不锈钢' },
    { model: '6202-2RS 轴承', category: '轴承', price: 3.2, supplier: 'NSK代理商', stock: 500, remark: '高速静音' },
    { model: '6303-2RS 轴承', category: '轴承', price: 5.5, supplier: 'NSK代理商', stock: 400, remark: '' },
    { model: '100Y 不锈钢叶轮', category: '叶轮', price: 18.0, supplier: '永锋机床', stock: 150, remark: '双流道' },
    { model: '104-16 机械密封', category: '机封', price: 8.5, supplier: '汉克密封', stock: 200, remark: '碳化硅对石墨' },
    { model: '20uF/450V 电容', category: '电子件', price: 4.0, supplier: '中容电子', stock: 300, remark: '带线' },
    { model: '30uF/450V 电容', category: '电子件', price: 5.5, supplier: '中容电子', stock: 200, remark: '铝壳' },
    { model: '1.5平方 3芯水下电缆 10米', category: '线缆', price: 25.0, supplier: '远东电缆', stock: 150, remark: '国标铜芯' },
    { model: '2.5平方 3芯水下电缆 15米', category: '线缆', price: 45.0, supplier: '远东电缆', stock: 80, remark: '国标铜芯' },
    { model: 'M8*25 不锈钢内六角螺丝', category: '紧固件', price: 0.15, supplier: '天天螺丝', stock: 5000, remark: 'A2-70' },
    { model: '丁腈橡胶 O型圈 100*3.5', category: '密封件', price: 0.8, supplier: '汉克密封', stock: 1000, remark: '耐油防腐' }
];

const insertPart = db.prepare(`
    INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let partIds = {};
db.transaction(() => {
    for (const p of partsData) {
        const info = insertPart.run(
            p.model, p.category, p.price, p.supplier, p.stock, p.remark,
            new Date().toISOString(), new Date().toISOString()
        );
        partIds[p.model] = info.lastInsertRowid;
    }
})();
console.log(`✅ 已插入 ${partsData.length} 个配件(Parts)数据`);

// --- 插入 定子/转子 线圈 (Coils) ---
const coilsData = [
    { spec: '90机座 2极 定转子', sheets: 65, unit_price: 15.0, wire_weight: 0.8, copper_base: 70.0, coil_fee: 12.0, rotor_fee: 8.0, cost: 91.0, default_wire_gauge: '0.85', default_capacitor: '20uF' },
    { spec: '100机座 2极 定转子', sheets: 85, unit_price: 22.0, wire_weight: 1.2, copper_base: 70.0, coil_fee: 15.0, rotor_fee: 10.0, cost: 131.0, default_wire_gauge: '0.90', default_capacitor: '30uF' },
    { spec: '112机座 4极 定转子', sheets: 105, unit_price: 35.0, wire_weight: 1.8, copper_base: 70.0, coil_fee: 20.0, rotor_fee: 15.0, cost: 196.0, default_wire_gauge: '1.0', default_capacitor: '40uF' }
];

const insertCoil = db.prepare(`
    INSERT INTO coils (spec, sheets, unit_price, wire_weight, copper_base, coil_fee, rotor_fee, cost, default_wire_gauge, default_capacitor, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
    for (const c of coilsData) {
        insertCoil.run(
            c.spec, c.sheets, c.unit_price, c.wire_weight, c.copper_base, c.coil_fee, c.rotor_fee, c.cost, c.default_wire_gauge, c.default_capacitor,
            new Date().toISOString(), new Date().toISOString()
        );
    }
})();
console.log(`✅ 已插入 ${coilsData.length} 个线圈(Coils)数据`);

// --- 插入 配方/BOM (Recipes) ---
const recipe1_parts = [
    { partId: partIds['100Y-120 铸铁泵壳'], quantity: 1, unitCost: 45.5, name: '100Y-120 铸铁泵壳' },
    { partId: partIds['WQD 系列不锈钢电机壳'], quantity: 1, unitCost: 32.0, name: 'WQD 系列不锈钢电机壳' },
    { partId: partIds['6202-2RS 轴承'], quantity: 2, unitCost: 3.2, name: '6202-2RS 轴承' },
    { partId: partIds['100Y 不锈钢叶轮'], quantity: 1, unitCost: 18.0, name: '100Y 不锈钢叶轮' },
    { partId: partIds['104-16 机械密封'], quantity: 1, unitCost: 8.5, name: '104-16 机械密封' },
    { partId: partIds['20uF/450V 电容'], quantity: 1, unitCost: 4.0, name: '20uF/450V 电容' },
    { partId: partIds['1.5平方 3芯水下电缆 10米'], quantity: 1, unitCost: 25.0, name: '1.5平方 3芯水下电缆 10米' },
    { partId: partIds['M8*25 不锈钢内六角螺丝'], quantity: 12, unitCost: 0.15, name: 'M8*25 不锈钢内六角螺丝' },
    { partId: partIds['丁腈橡胶 O型圈 100*3.5'], quantity: 3, unitCost: 0.8, name: '丁腈橡胶 O型圈 100*3.5' }
];

const recipe1_total = recipe1_parts.reduce((sum, p) => sum + p.quantity * p.unitCost, 0) + 91.0; // 假设加上定转子成本91.0

const recipesData = [
    { 
        name: 'WQD10-15-1.5 污水潜水泵', 
        spec: '1.5kW 2极 220V',
        parts_json: JSON.stringify(recipe1_parts),
        saved_total_cost: recipe1_total,
        saved_cost_details: JSON.stringify([
            { category: '配件总价', cost: recipe1_total - 91.0 },
            { category: '线圈及加工', cost: 91.0 },
            { category: '人工装配预估', cost: 15.0 }
        ])
    }
];

const insertRecipe = db.prepare(`
    INSERT INTO recipes (name, spec, parts_json, saved_total_cost, saved_cost_details, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
    for (const r of recipesData) {
        insertRecipe.run(
            r.name, r.spec, r.parts_json, r.saved_total_cost, r.saved_cost_details,
            new Date().toISOString(), new Date().toISOString()
        );
    }
})();
console.log(`✅ 已插入 ${recipesData.length} 个配方/BOM(Recipes)数据`);

// --- 插入 订单 (Orders) ---
const ordersData = [
    {
        customer_name: '建工集团项目部',
        contract_no: 'HT2026-04001',
        status: '待采购',
        remark: '急单，要求下周三发货。配备10米加长线缆。',
        items_json: JSON.stringify([
            { recipe_name: 'WQD10-15-1.5 污水潜水泵', quantity: 50, unit_price: 350.0 }
        ]),
        purchase_list_json: JSON.stringify([
            { name: '100Y 不锈钢叶轮', required_qty: 50, stock: 150, to_buy: 0 },
            { name: '100Y-120 铸铁泵壳', required_qty: 50, stock: 120, to_buy: 0 },
            { name: '6202-2RS 轴承', required_qty: 100, stock: 500, to_buy: 0 }
        ]),
        todos_json: JSON.stringify([
            { task: '联系供应商采购缺失物料', done: false },
            { task: '安排车间生产排期', done: false }
        ])
    },
    {
        customer_name: '绿化工程有限公司',
        contract_no: 'HT2026-04015',
        status: '采购中',
        remark: '喷泉配套使用',
        items_json: JSON.stringify([
            { recipe_name: 'WQD10-15-1.5 污水潜水泵', quantity: 15, unit_price: 360.0 }
        ]),
        purchase_list_json: JSON.stringify([]),
        todos_json: JSON.stringify([
            { task: '确认电机测试通过', done: true },
            { task: '水泵整机打水测试', done: false }
        ])
    }
];

const insertOrder = db.prepare(`
    INSERT INTO orders (customer_name, contract_no, remark, status, items_json, purchase_list_json, todos_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
    for (const o of ordersData) {
        insertOrder.run(
            o.customer_name, o.contract_no, o.remark, o.status, o.items_json, o.purchase_list_json, o.todos_json,
            new Date().toISOString(), new Date().toISOString()
        );
    }
})();
console.log(`✅ 已插入 ${ordersData.length} 个订单(Orders)数据`);

db.close();
console.log('🎉 演示数据生成成功！');
