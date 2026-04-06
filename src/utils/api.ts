import {
  Part,
  Recipe,
  RecipePart,
  CostResult,
  ApiResponse,
  PumpShellTemplate,
} from '../types';

// ─── 通用请求封装 ─────────────────────────────

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

export async function getAllParts(): Promise<Part[]> {
  const res = await proxyRequest<{ success: boolean; data: Part[] }>('/api/parts');
  return res.data || [];
}

export async function createPart(part: Omit<Part, 'Id'>): Promise<Part> {
  const res = await proxyRequest<{ success: boolean; data: Part }>('/api/parts', {
    method: 'POST',
    body: JSON.stringify({
      model: part.model,
      category: part.category,
      price: part.price,
      supplier: part.supplier,
      stock: part.stock ?? 0,
    }),
  });
  return res.data;
}

export async function updatePart(id: number, part: Partial<Part>): Promise<Part> {
  const record: Record<string, unknown> = { Id: id };
  if (part.model !== undefined) record.model = part.model;
  if (part.category !== undefined) record.category = part.category;
  if (part.price !== undefined) record.price = part.price;
  if (part.supplier !== undefined) record.supplier = part.supplier;
  if (part.stock !== undefined) record.stock = part.stock;

  const res = await proxyRequest<{ success: boolean; data: Part }>('/api/parts', {
    method: 'PATCH',
    body: JSON.stringify(record),
  });
  return res.data;
}

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
      body: JSON.stringify({ Id: d.partId, stock: newStock }),
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
      body: JSON.stringify({ Id: a.partId, stock: newStock }),
    });
  }));
}

// ─── 配方 CRUD ──────────────────────────────

export async function getAllRecipes(): Promise<Recipe[]> {
  const res = await proxyRequest<{ success: boolean; data: Recipe[] }>('/api/recipes');
  return res.data || [];
}

export async function getRecipe(id: number): Promise<Recipe | null> {
  try {
    const res = await proxyRequest<{ success: boolean; data: Recipe }>(`/api/recipes/${id}`);
    return res.data || null;
  } catch {
    return null;
  }
}

export async function createRecipe(recipe: Omit<Recipe, 'Id'>): Promise<Recipe> {
  const res = await proxyRequest<{ success: boolean; data: Recipe }>('/api/recipes', {
    method: 'POST',
    body: JSON.stringify({
      name: recipe.name,
      spec: recipe.spec,
      parts_json: recipe.parts_json || '[]',
      saved_total_cost: recipe.saved_total_cost,
      saved_cost_details: recipe.saved_cost_details,
      template_id: recipe.template_id || null,
      coil_spec: recipe.coil_spec || '',
      coil_sheets: recipe.coil_sheets || 0,
      has_float: recipe.has_float || 0,
      float_wire: recipe.float_wire || '',
      has_cable: recipe.has_cable || 0,
      cable_length: recipe.cable_length || 0,
      cable_wire: recipe.cable_wire || '',
      box_type: recipe.box_type || '',
      extra_parts_json: recipe.extra_parts_json || '[]',
    }),
  });
  return res.data;
}

export async function deleteRecipe(id: number): Promise<void> {
  await proxyRequest('/api/recipes', {
    method: 'DELETE',
    body: JSON.stringify([{ Id: id }]),
  });
}

export async function updateRecipe(id: number, recipe: Partial<Omit<Recipe, 'Id'>>): Promise<Recipe> {
  const record: Record<string, unknown> = { Id: id };
  if (recipe.name !== undefined) record.name = recipe.name;
  if (recipe.spec !== undefined) record.spec = recipe.spec;
  if (recipe.parts_json !== undefined) record.parts_json = recipe.parts_json;
  if (recipe.saved_total_cost !== undefined) record.saved_total_cost = recipe.saved_total_cost;
  if (recipe.saved_cost_details !== undefined) record.saved_cost_details = recipe.saved_cost_details;
  if (recipe.template_id !== undefined) record.template_id = recipe.template_id;
  if (recipe.coil_spec !== undefined) record.coil_spec = recipe.coil_spec;
  if (recipe.coil_sheets !== undefined) record.coil_sheets = recipe.coil_sheets;
  if (recipe.has_float !== undefined) record.has_float = recipe.has_float;
  if (recipe.float_wire !== undefined) record.float_wire = recipe.float_wire;
  if (recipe.has_cable !== undefined) record.has_cable = recipe.has_cable;
  if (recipe.cable_length !== undefined) record.cable_length = recipe.cable_length;
  if (recipe.cable_wire !== undefined) record.cable_wire = recipe.cable_wire;
  if (recipe.box_type !== undefined) record.box_type = recipe.box_type;
  if (recipe.extra_parts_json !== undefined) record.extra_parts_json = recipe.extra_parts_json;

  const res = await proxyRequest<{ success: boolean; data: Recipe }>('/api/recipes', {
    method: 'PATCH',
    body: JSON.stringify(record),
  });
  return res.data;
}

// ─── 成本计算 ─────────────────────────────────

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

// ─── 泵壳模板 CRUD ──────────────────────────

export async function getAllTemplates(): Promise<PumpShellTemplate[]> {
  const res = await proxyRequest<{ success: boolean; data: PumpShellTemplate[] }>('/api/templates');
  return res.data || [];
}

export async function getTemplate(id: number): Promise<PumpShellTemplate | null> {
  try {
    const res = await proxyRequest<{ success: boolean; data: PumpShellTemplate }>(`/api/templates/${id}`);
    return res.data || null;
  } catch {
    return null;
  }
}

export async function createTemplate(tpl: Omit<PumpShellTemplate, 'Id'>): Promise<PumpShellTemplate> {
  const res = await proxyRequest<{ success: boolean; data: PumpShellTemplate }>('/api/templates', {
    method: 'POST',
    body: JSON.stringify({
      shell_model: tpl.shell_model,
      description: tpl.description || '',
      parts_json: tpl.parts_json || '[]',
    }),
  });
  return res.data;
}

export async function updateTemplate(id: number, tpl: Partial<Omit<PumpShellTemplate, 'Id'>>): Promise<PumpShellTemplate> {
  const res = await proxyRequest<{ success: boolean; data: PumpShellTemplate }>(`/api/templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(tpl),
  });
  return res.data;
}

export async function deleteTemplate(id: number): Promise<void> {
  await proxyRequest(`/api/templates/${id}`, { method: 'DELETE' });
}
