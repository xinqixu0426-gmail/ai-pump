import { NOCO_CONFIG, Part, Recipe, RecipePart, CostResult, ApiResponse } from '../types';

/**
 * NocoDB API 请求封装
 */
export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${NOCO_CONFIG.baseUrl}${path}`;
  const headers: Record<string, string> = {
    'xc-token': NOCO_CONFIG.apiToken,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 递归分页抓取所有记录
 */
async function fetchAllRecords<T>(tableId: string): Promise<T[]> {
  const PAGE_SIZE = 100;
  let offset = 0;
  const all: T[] = [];

  while (true) {
    const data = await apiRequest<{ list: T[] }>(
      `/api/v2/tables/${tableId}/records?limit=${PAGE_SIZE}&offset=${offset}`
    );
    const list = data.list || [];
    if (list.length === 0) break;
    all.push(...list);
    if (list.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

/**
 * 获取所有零件
 */
export async function getAllParts(): Promise<Part[]> {
  return fetchAllRecords<Part>(NOCO_CONFIG.partsTable);
}

/**
 * 创建零件
 */
export async function createPart(part: Omit<Part, 'Id'>): Promise<Part> {
  const record: Record<string, unknown> = {
    型号: part.型号 || part.model,
    类别: part.类别 || part.category,
    单价: part.单价 || part.price,
    供应商: part.供应商 || part.supplier
  };
  
  if (part.库存 !== undefined || part.stock !== undefined) {
    record.库存 = part.库存 ?? part.stock ?? 0;
  }

  return apiRequest<Part>(`/api/v2/tables/${NOCO_CONFIG.partsTable}/records`, {
    method: 'POST',
    body: JSON.stringify(record)
  });
}

/**
 * 更新零件
 */
export async function updatePart(id: number, part: Partial<Part>): Promise<Part> {
  const record: Record<string, unknown> = {
    Id: id
  };
  if (part.型号 !== undefined || part.model !== undefined) {
    record.型号 = part.型号 || part.model;
  }
  if (part.类别 !== undefined || part.category !== undefined) {
    record.类别 = part.类别 || part.category;
  }
  if (part.单价 !== undefined || part.price !== undefined) {
    record.单价 = part.单价 || part.price;
  }
  if (part.供应商 !== undefined || part.supplier !== undefined) {
    record.供应商 = part.供应商 || part.supplier;
  }
  if (part.库存 !== undefined || part.stock !== undefined) {
    record.库存 = part.库存 ?? part.stock;
  }

  return apiRequest<Part>(`/api/v2/tables/${NOCO_CONFIG.partsTable}/records`, {
    method: 'PATCH',
    body: JSON.stringify(record)
  });
}

/**
 * 删除零件
 */
export async function deletePart(id: number): Promise<void> {
  await apiRequest(`/api/v2/tables/${NOCO_CONFIG.partsTable}/records`, {
    method: 'DELETE',
    body: JSON.stringify([{ Id: id }])
  });
}

/**
 * 批量扣减库存（生产用）
 * deductions: [{ partId, deductQty }]
 * 返回扣减后更新过的零件列表
 */
export async function batchDeductStock(
  deductions: Array<{ partId: number; currentStock: number; deductQty: number }>
): Promise<void> {
  // 逐条更新库存（NocoDB PATCH 支持单条更新）
  for (const d of deductions) {
    const newStock = Math.max(0, d.currentStock - d.deductQty);
    await apiRequest(`/api/v2/tables/${NOCO_CONFIG.partsTable}/records`, {
      method: 'PATCH',
      body: JSON.stringify({ Id: d.partId, 库存: newStock })
    });
  }
}

/**
 * 获取所有配方
 */
export async function getAllRecipes(): Promise<Recipe[]> {
  return fetchAllRecords<Recipe>(NOCO_CONFIG.recipesTable);
}

/**
 * 获取单个配方
 */
export async function getRecipe(id: number): Promise<Recipe | null> {
  try {
    const data = await apiRequest<{ list: Recipe[] }>(
      `/api/v2/tables/${NOCO_CONFIG.recipesTable}/records?where=(Id,eq,${id})`
    );
    return data.list?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * 创建配方
 */
export async function createRecipe(recipe: Omit<Recipe, 'Id'>): Promise<Recipe> {
  const record = {
    配方名称: recipe.配方名称 || recipe.name,
    规格: recipe.规格 || recipe.spec,
    配件JSON: recipe.配件JSON || recipe.parts_json || '[]'
  };

  return apiRequest<Recipe>(`/api/v2/tables/${NOCO_CONFIG.recipesTable}/records`, {
    method: 'POST',
    body: JSON.stringify(record)
  });
}

/**
 * 删除配方
 */
export async function deleteRecipe(id: number): Promise<void> {
  await apiRequest(`/api/v2/tables/${NOCO_CONFIG.recipesTable}/records`, {
    method: 'DELETE',
    body: JSON.stringify([{ Id: id }])
  });
}

/**
 * 计算配方成本
 */
export async function calculateCost(parts: RecipePart[]): Promise<CostResult> {
  const response = await fetch('/api/cost/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts })
  });

  const result: ApiResponse<CostResult> = await response.json();
  if (!result.success || !result.data) {
    throw new Error(result.error || '计算成本失败');
  }
  return result.data;
}

/**
 * 按名称搜索配方
 */
export async function searchRecipeByName(name: string): Promise<Recipe | null> {
  try {
    const response = await fetch(`/api/cost/recipe/by-name?name=${encodeURIComponent(name)}`);
    const result: ApiResponse<{ recipeId: number; recipeName: string; recipeSpec: string }> = await response.json();
    if (!result.success || !result.data) {
      return null;
    }
    return getRecipe(result.data.recipeId);
  } catch {
    return null;
  }
}
