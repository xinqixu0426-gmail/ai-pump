// NocoDB API 配置
export const NOCO_CONFIG = {
  baseUrl: 'http://localhost:8080',
  apiToken: '***REMOVED***',
  partsTable: 'mzsysnoaq7g36h9',
  recipesTable: 'm9pygo8pmn86kbk'
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
