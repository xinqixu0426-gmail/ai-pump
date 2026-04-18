// 后端已使用 SQLite 并返回英文字段，前端直接使用标准化类型

/** 零件 */
export interface Part {
  Id: number;
  model: string;
  category: string;
  price: number;
  supplier: string;
  stock: number;
  remark?: string;
  notes?: string; // JSON 字符串，泵壳类扩展属性（如不锈钢机筒参数）
}

/** 泵壳不锈钢机筒元数据（存于 Part.notes 字段） */
export interface PumpShellMeta {
  isStainless: boolean;
  barrelLength?: number;   // 机筒长度（mm）
  openFactor?: number;     // 开档系数
  // 转子出图备用参数（可选预设）
  defaultUpperBearing?: string;   // 默认上轴承型号 e.g. "6202"
  defaultLowerBearing?: string;   // 默认下轴承型号
  defaultOilSealDia?: number;     // 默认油封孔径（mm）
  defaultBearingSpan?: number;    // 默认开档（mm）
  defaultImpellerDia?: number;    // 默认叶轮孔径（mm）
  defaultImpellerSpan?: number;   // 默认叶轮开档（mm）
  defaultImpellerDepth?: number;  // 默认叶轮厚度（mm）
  defaultThreadLength?: number;   // 默认螺丝长度（mm）
  defaultThreadDia?: number;      // 默认螺纹直径（mm）
  defaultStackOffset?: number;    // 默认定位（mm）
}

/** 泵壳模板配件项 */
export interface TemplatePart {
  name: string;
  model: string;
  qty: number;
  supplier?: string;
}

/** 泵壳模板 */
export interface PumpShellTemplate {
  Id: number;
  shell_model: string;
  description: string;
  parts_json: string;
  assembly_wage: number;
  packing_wage: number;
  painting_wage: number | null;
  CreatedAt?: string;
  UpdatedAt?: string;
}

/** 配方 */
export interface Recipe {
  Id: number;
  name: string;
  spec: string;
  parts_json: string;
  saved_total_cost?: number;
  saved_cost_details?: string;
  // 新增结构化字段
  template_id?: number | null;
  coil_spec?: string;
  coil_sheets?: number;
  has_float?: number;
  float_wire?: string;
  has_cable?: number;
  cable_length?: number;
  cable_wire?: string;
  box_type?: string;
  extra_parts_json?: string;
  // 不锈钢机筒长度覆盖（配方级）
  custom_barrel_length?: number | null;
  // 人工工资（从模板带入，可覆盖）
  assembly_wage?: number;
  packing_wage?: number;
  painting_wage?: number | null;
  management_fee?: number;
  CreatedAt?: string;
  UpdatedAt?: string;
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
