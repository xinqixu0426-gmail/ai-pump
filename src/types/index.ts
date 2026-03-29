// NocoDB API 配置
export const NOCO_CONFIG = {
  baseUrl: 'http://localhost:8080',
  apiToken: '***REMOVED***',
  partsTable: 'mzsysnoaq7g36h9',
  recipesTable: 'm9pygo8pmn86kbk',
  ordersTable: 'md70160vnmyjs4w'
};

// 零件类型
export interface Part {
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

// 配方配件项
export interface RecipePart {
  model: string;
  name: string;
  supplier: string;
  qty: number;
  snapshotPrice?: number; // 保存配方时的单价快照
}

// 配件选择（表单用）
export interface PartSelection {
  model: string;
  supplier: string;
  qty: number;
}

// 配方类型
export interface Recipe {
  Id: number;
  配方名称?: string;
  name?: string;
  规格?: string;
  spec?: string;
  配件JSON?: string;
  parts_json?: string;
  saved_total_cost?: number;
  保存时总成本?: number;  // NocoDB 中文字段名
  saved_cost_details?: string;
  保存时成本明细?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
}

// 成本计算结果项
export interface CostDetail {
  name: string;
  model: string;
  supplier: string;
  price: string;
  qty: number;
  subtotal: string;
  source: string;
  snapshotPrice?: string;    // 保存时的快照单价
  snapshotSubtotal?: string; // 保存时的快照小计
}

// 成本计算结果
export interface CostResult {
  totalCost: string;
  snapshotTotalCost?: string; // 保存时的总成本快照
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

// 订单中的单个型号条目
export interface OrderItem {
  id: string;            // 本地唯一ID（uuid-like）
  recipeId?: number;     // 关联配方ID，临时型号则无
  recipeName: string;    // 型号/配方名称
  spec?: string;         // 规格
  qty: number;           // 生产数量
  partsJson: string;     // JSON字符串，RecipePart[]
  unitCost: number;      // 单台成本（从配方 saved_total_cost）
  profitMargin: number;  // 利润率倍数，如 1.15 = 15% 利润
  unitPrice: number;     // 不含税出厂价 = unitCost × profitMargin（可手动覆盖）
}

// 采购清单中的单条零件汇总
export interface PurchaseItem {
  model: string;
  name: string;
  supplier: string;
  totalQty: number;      // 所有型号需求总量
  currentStock: number;  // 当前库存
  needToBuy: number;     // max(0, totalQty - currentStock)
  purchased: boolean;    // 是否已采购（逐条勾选）
  partId?: number;       // NocoDB Parts表Id，用于更新库存
}

// 采购 to-do 条目
export interface TodoItem {
  id: string;
  supplier: string;
  description: string;   // 如："联系张记配件采购：201×4, 12双面×2"
  done: boolean;
}

// 订单状态
export type OrderStatus = '待采购' | '采购中' | '已完成';

// 订单
export interface Order {
  id: string;
  customerName: string;
  contractNo?: string;   // 合同号
  remark?: string;
  status: OrderStatus;
  items: OrderItem[];            // 型号列表
  purchaseList: PurchaseItem[];  // 采购汇总清单
  todos: TodoItem[];             // 采购 to-do
  totalCost: number;             // 所有型号 unitCost × qty 之和
  totalPrice: number;            // 所有型号 unitPrice × qty 之和
  totalProfit: number;           // totalPrice - totalCost
  createdAt: string;             // ISO字符串
  updatedAt: string;
}
