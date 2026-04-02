import {
  Part,
  Recipe,
  RecipePart,
  CostResult,
  ApiResponse,
  RawPart,
  RawRecipe,
  normalizePart,
  normalizeRecipe,
} from '../types';

// ─── 通用请求封装（走后端代理，不暴露 NocoDB Token）──

async function proxyRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

// ─── 零件 CRUD ──────────────────────────────

/**
 * 获取所有零件（已 normalize）
 */
export async function getAllParts(): Promise<Part[]> {
  const res = await proxyRequest<{ success: boolean; data: RawPart[] }>('/api/parts');
  return (res.data || []).map(normalizePart);
}

/**
 * 创建零件
 */
export async function createPart(part: Omit<Part, 'Id'>): Promise<Part> {
  const record = {
    型号: part.model,
    类别: part.category,
    单价: part.price,
    供应商: part.supplier,
    库存: part.stock ?? 0,
  };

  const res = await proxyRequest<{ success: boolean; data: RawPart }>('/api/parts', {
    method: 'POST',
    body: JSON.stringify(record),
  });
  return normalizePart(res.data);
}

/**
 * 更新零件
 */
export async function updatePart(id: number, part: Partial<Part>): Promise<Part> {
  const record: Record<string, unknown> = { Id: id };
  if (part.model !== undefined) record.型号 = part.model;
  if (part.category !== undefined) record.类别 = part.category;
  if (part.price !== undefined) record.单价 = part.price;
  if (part.supplier !== undefined) record.供应商 = part.supplier;
  if (part.stock !== undefined) record.库存 = part.stock;

  const res = await proxyRequest<{ success: boolean; data: RawPart }>('/api/parts', {
    method: 'PATCH',
    body: JSON.stringify(record),
  });
  return normalizePart(res.data);
}

/**
 * 删除零件
 */
export async function deletePart(id: number): Promise<void> {
  await proxyRequest('/api/parts', {
    method: 'DELETE',
    body: JSON.stringify([{ Id: id }]),
  });
}

/**
 * 批量扣减库存（生产用）— 并行
 */
export async function batchDeductStock(
  deductions: Array<{ partId: number; currentStock: number; deductQty: number }>
): Promise<void> {
  await Promise.all(deductions.map((d) => {
    const newStock = Math.max(0, d.currentStock - d.deductQty);
    return proxyRequest('/api/parts', {
      method: 'PATCH',
      body: JSON.stringify({ Id: d.partId, 库存: newStock }),
    });
  }));
}

/**
 * 批量增加库存（采购入库用）— 并行
 */
export async function batchAddStock(
  additions: Array<{ partId: number; addQty: number; currentStock: number }>
): Promise<void> {
  await Promise.all(additions.map((a) => {
    const newStock = a.currentStock + a.addQty;
    return proxyRequest('/api/parts', {
      method: 'PATCH',
      body: JSON.stringify({ Id: a.partId, 库存: newStock }),
    });
  }));
}

// ─── 配方 CRUD ──────────────────────────────

/**
 * 获取所有配方（已 normalize）
 */
export async function getAllRecipes(): Promise<Recipe[]> {
  const res = await proxyRequest<{ success: boolean; data: RawRecipe[] }>('/api/recipes');
  return (res.data || []).map(normalizeRecipe);
}

/**
 * 获取单个配方
 */
export async function getRecipe(id: number): Promise<Recipe | null> {
  try {
    const res = await proxyRequest<{ success: boolean; data: RawRecipe }>(`/api/recipes/${id}`);
    return res.data ? normalizeRecipe(res.data) : null;
  } catch {
    return null;
  }
}

/**
 * 创建配方
 */
export async function createRecipe(recipe: Omit<Recipe, 'Id'>): Promise<Recipe> {
  const record = {
    配方名称: recipe.name,
    规格: recipe.spec,
    配件JSON: recipe.parts_json || '[]',
    saved_total_cost: recipe.saved_total_cost,
    saved_cost_details: recipe.saved_cost_details,
  };

  const res = await proxyRequest<{ success: boolean; data: RawRecipe }>('/api/recipes', {
    method: 'POST',
    body: JSON.stringify(record),
  });
  return normalizeRecipe(res.data);
}

/**
 * 删除配方
 */
export async function deleteRecipe(id: number): Promise<void> {
  await proxyRequest('/api/recipes', {
    method: 'DELETE',
    body: JSON.stringify([{ Id: id }]),
  });
}

/**
 * 更新配方
 */
export async function updateRecipe(id: number, recipe: Partial<Omit<Recipe, 'Id'>>): Promise<Recipe> {
  const record: Record<string, unknown> = { Id: id };
  if (recipe.name !== undefined) record['配方名称'] = recipe.name;
  if (recipe.spec !== undefined) record['规格'] = recipe.spec;
  if (recipe.parts_json !== undefined) record['配件JSON'] = recipe.parts_json;
  if (recipe.saved_total_cost !== undefined) record['saved_total_cost'] = recipe.saved_total_cost;
  if (recipe.saved_cost_details !== undefined) record['saved_cost_details'] = recipe.saved_cost_details;

  const res = await proxyRequest<{ success: boolean; data: RawRecipe }>('/api/recipes', {
    method: 'PATCH',
    body: JSON.stringify(record),
  });
  return normalizeRecipe(res.data);
}

// ─── 成本计算（已走后端代理）──────────────────

/**
 * 计算配方成本
 */
export async function calculateCost(parts: RecipePart[]): Promise<CostResult> {
  const response = await fetch('/api/cost/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts }),
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
