import { colors } from '../../utils/theme';

// ─── 常量 & 类别管理 ──────────────────────────────────

/** 内置类别（不可删除） */
export const BUILTIN_CATEGORIES: string[] = [
  '轴承', '油封', '螺丝', '泵壳', '线圈转子',
  '电容', '电缆线', '皮垫', '配件', '包装',
];

/** 内置图标 */
export const BUILTIN_ICONS: Record<string, string> = {
  轴承: '⚙️', 油封: '🔧', 螺丝: '🔩', 泵壳: '🏠',
  线圈转子: '⚡', 电容: '🔋', 电缆线: '📡', 皮垫: '🟤',
  配件: '🛠️', 包装: '📦',
};

/** 内置颜色映射 */
export const BUILTIN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  轴承:   { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  油封:   { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
  螺丝:   { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  泵壳:   { bg: colors.purple.bg, text: colors.purple.dark, border: colors.purple.border },
  线圈转子:{ bg: '#fff7ed', text: '#9a3412', border: '#fed7aa' },
  电容:   { bg: '#f0f9ff', text: '#075985', border: '#bae6fd' },
  电缆线: { bg: '#fdf4ff', text: '#701a75', border: '#f0abfc' },
  皮垫:   { bg: '#fef3c7', text: '#78350f', border: '#fcd34d' },
  配件:   { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
  包装:   { bg: '#f8fafc', text: '#334155', border: '#cbd5e1' },
};

/** 自定义类别的候选颜色池（循环使用） */
export const CUSTOM_COLOR_POOL: Array<{ bg: string; text: string; border: string }> = [
  { bg: '#fff1f2', text: '#be123c', border: '#fecdd3' },
  { bg: '#f0fdf4', text: '#166534', border: '#86efac' },
  { bg: '#fefce8', text: '#854d0e', border: '#fde047' },
  { bg: '#f0f9ff', text: '#0c4a6e', border: '#7dd3fc' },
  { bg: '#fdf4ff', text: '#6b21a8', border: '#e879f9' },
  { bg: '#fff7ed', text: '#7c2d12', border: '#fdba74' },
  { bg: '#f8fafc', text: '#1e293b', border: '#94a3b8' },
];

const LS_KEY = 'pump:part-categories';

/** 从 localStorage 读取自定义类别，并去重 */
export function loadCustomCategories(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return parsed.filter((c) => typeof c === 'string' && c.trim() && !BUILTIN_CATEGORIES.includes(c));
  } catch {
    return [];
  }
}

export function saveCustomCategories(cats: string[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(cats));
}

/** 返回某个类别的显示颜色 */
export function getCatColor(cat: string, customCategories: string[]): { bg: string; text: string; border: string } {
  if (BUILTIN_COLORS[cat]) return BUILTIN_COLORS[cat];
  const idx = customCategories.indexOf(cat);
  return CUSTOM_COLOR_POOL[idx % CUSTOM_COLOR_POOL.length] ?? { bg: '#f8fafc', text: '#475569', border: '#e2e8f0' };
}

/** 返回某个类别的 emoji 图标 */
export function getCatIcon(cat: string): string {
  return BUILTIN_ICONS[cat] ?? '🏷️';
}

// ─── 库存状态 ─────────────────────────────────────────

export function stockStatus(stock: number): { label: string; color: 'error' | 'warning' | 'success'; gradient: string } {
  if (stock === 0) return { label: '缺货', color: 'error', gradient: 'linear-gradient(135deg,#ef4444,#dc2626)' };
  if (stock <= 5) return { label: '低库存', color: 'warning', gradient: 'linear-gradient(135deg,#f59e0b,#d97706)' };
  return { label: '充足', color: 'success', gradient: 'linear-gradient(135deg,#10b981,#059669)' };
}

