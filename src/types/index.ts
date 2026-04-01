// NocoDB Token 和 Table ID 已收口到后端 api.cjs，前端不再暴露

// ─── NocoDB 原始数据（含中文字段）─────────────────────
/** NocoDB 返回的 Part 原始格式 */
export interface RawPart {
  Id: number;
  型号?: string;
  model?: string;
  类别?: string;
  category?: string;
  单价?: number;
  price?: number;
  供应商?: string;
  supplier?: string;
  库存?: number;
  stock?: number;
}

/** NocoDB 返回的 Recipe 原始格式 */
export interface RawRecipe {
  Id: number;
  配方名称?: string;
  name?: string;
  规格?: string;
  spec?: string;
  配件JSON?: string;
  parts_json?: string;
  saved_total_cost?: number;
  保存时总成本?: number;
  saved_cost_details?: string;
  保存时成本明细?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
}

// ─── Normalize 后的统一类型（前端全部使用这些）───────
/** 标准化后的零件 */
export interface Part {
  Id: number;
  model: string;
  category: string;
  price: number;
  supplier: string;
  stock: number;
}

/** 标准化后的配方 */
export interface Recipe {
  Id: number;
  name: string;
  spec: string;
  parts_json: string;
  saved_total_cost?: number;
  saved_cost_details?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
}

// ─── Normalize 函数 ──────────────────────────────────
export function normalizePart(raw: RawPart): Part {
  return {
    Id: raw.Id,
    model: (raw.型号 || raw.model || '').trim(),
    category: (raw.类别 || raw.category || '').trim(),
    price: Number(raw.单价 ?? raw.price ?? 0),
    supplier: (raw.供应商 || raw.supplier || '').trim(),
    stock: Number(raw.库存 ?? raw.stock ?? 0),
  };
}

export function normalizeRecipe(raw: RawRecipe): Recipe {
  return {
    Id: raw.Id,
    name: (raw.配方名称 || raw.name || '').trim(),
    spec: (raw.规格 || raw.spec || '').trim(),
    parts_json: raw.配件JSON || raw.parts_json || '[]',
    saved_total_cost: raw.saved_total_cost ?? raw.保存时总成本,
    saved_cost_details: raw.saved_cost_details ?? raw.保存时成本明细,
    CreatedAt: raw.CreatedAt,
    UpdatedAt: raw.UpdatedAt,
  };
}

// ─── 配方配件项 ──────────────────────────────────────
export interface RecipePart {
  model: string;
  name: string;
  supplier: string;
  qty: number;
  snapshotPrice?: number;
}

// 配件选择（表单用）
export interface PartSelection {
  model: string;
  supplier: string;
  qty: number;
}

// ─── 成本相关 ────────────────────────────────────────
export interface CostDetail {
  name: string;
  model: string;
  supplier: string;
  price: string;
  qty: number;
  subtotal: string;
  source: string;
  snapshotPrice?: string;
  snapshotSubtotal?: string;
}

export interface CostResult {
  totalCost: string;
  snapshotTotalCost?: string;
  itemCount: number;
  details: CostDetail[];
  missingParts: string[];
}

// API 响应类型
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ====== 订单相关类型 ======

export interface OrderItem {
  id: string;
  recipeId?: number;
  recipeName: string;
  spec?: string;
  qty: number;
  partsJson: string;
  unitCost: number;
  profitMargin: number;
  unitPrice: number;
}

export interface PurchaseItem {
  model: string;
  name: string;
  supplier: string;
  totalQty: number;
  currentStock: number;
  needToBuy: number;
  purchased: boolean;
  partId?: number;
}

export interface TodoItem {
  id: string;
  supplier: string;
  description: string;
  done: boolean;
}

export type OrderStatus = '待采购' | '采购中' | '已完成';

export interface Order {
  id: string;
  customerName: string;
  contractNo?: string;
  remark?: string;
  status: OrderStatus;
  items: OrderItem[];
  purchaseList: PurchaseItem[];
  todos: TodoItem[];
  totalCost: number;
  totalPrice: number;
  totalProfit: number;
  createdAt: string;
  updatedAt: string;
}
