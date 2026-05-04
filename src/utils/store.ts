import { create } from 'zustand';
import { Part, Recipe, PumpShellTemplate } from '../types';
import { Order } from '../types';
import { getAllParts, getAllRecipes, getAllTemplates } from './api';
import { getAllOrders } from './orderStore';

// ─── Store 状态定义 ──────────────────────────

interface AppState {
  // 数据
  parts: Part[];
  recipes: Recipe[];
  orders: Order[];
  templates: PumpShellTemplate[];
  customers: any[];
  quotations: any[];

  // 加载状态
  partsLoading: boolean;
  recipesLoading: boolean;
  ordersLoading: boolean;
  templatesLoading: boolean;

  // 错误
  partsError: string | null;
  recipesError: string | null;
  ordersError: string | null;
  templatesError: string | null;

  // 上次加载时间（用于 stale-while-revalidate）
  partsLoadedAt: number;
  recipesLoadedAt: number;
  ordersLoadedAt: number;
  templatesLoadedAt: number;

  // Actions
  fetchParts: (force?: boolean) => Promise<Part[]>;
  fetchRecipes: (force?: boolean) => Promise<Recipe[]>;
  fetchOrders: (force?: boolean) => Promise<Order[]>;
  fetchTemplates: (force?: boolean) => Promise<PumpShellTemplate[]>;
  fetchCustomers: (force?: boolean) => Promise<any[]>;
  fetchQuotations: (force?: boolean) => Promise<any[]>;
  fetchAll: (force?: boolean) => Promise<void>;

  // 局部更新（避免全量 refetch）
  setParts: (parts: Part[]) => void;
  setRecipes: (recipes: Recipe[]) => void;
  setOrders: (orders: Order[]) => void;
  setTemplates: (templates: PumpShellTemplate[]) => void;
  invalidateParts: () => void;
  invalidateRecipes: () => void;
  invalidateOrders: () => void;
  invalidateTemplates: () => void;

  // Snackbar 全局通知
  snackbar: { open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' };
  showSnackbar: (message: string, severity?: 'success' | 'error' | 'info' | 'warning') => void;
  hideSnackbar: () => void;
}

// 缓存过期时间：30秒内不重复请求
const STALE_MS = 30_000;

function isStale(loadedAt: number): boolean {
  return Date.now() - loadedAt > STALE_MS;
}

// ─── Zustand Store ──────────────────────────

export const useAppStore = create<AppState>((set, get) => ({
  // 初始状态
  parts: [],
  recipes: [],
  orders: [],
  templates: [],
  customers: [],
  quotations: [],
  partsLoading: false,
  recipesLoading: false,
  ordersLoading: false,
  templatesLoading: false,
  partsError: null,
  recipesError: null,
  ordersError: null,
  templatesError: null,
  partsLoadedAt: 0,
  recipesLoadedAt: 0,
  ordersLoadedAt: 0,
  templatesLoadedAt: 0,
  
  snackbar: { open: false, message: '', severity: 'success' },
  showSnackbar: (message, severity = 'success') => 
    set({ snackbar: { open: true, message, severity } }),
  hideSnackbar: () => 
    set((state) => ({ snackbar: { ...state.snackbar, open: false } })),

  // ── 零件 ────────
  fetchParts: async (force = false) => {
    const state = get();
    if (!force && !isStale(state.partsLoadedAt) && state.parts.length > 0) {
      return state.parts;
    }
    if (state.partsLoading) return state.parts;

    set({ partsLoading: true, partsError: null });
    try {
      const data = await getAllParts();
      set({ parts: data, partsLoading: false, partsLoadedAt: Date.now() });
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载零件失败';
      set({ partsError: msg, partsLoading: false });
      return state.parts;
    }
  },

  // ── 配方 ────────
  fetchRecipes: async (force = false) => {
    const state = get();
    if (!force && !isStale(state.recipesLoadedAt) && state.recipes.length > 0) {
      return state.recipes;
    }
    if (state.recipesLoading) return state.recipes;

    set({ recipesLoading: true, recipesError: null });
    try {
      const data = await getAllRecipes();
      set({ recipes: data, recipesLoading: false, recipesLoadedAt: Date.now() });
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载配方失败';
      set({ recipesError: msg, recipesLoading: false });
      return state.recipes;
    }
  },

  // ── 订单 ────────
  fetchOrders: async (force = false) => {
    const state = get();
    if (!force && !isStale(state.ordersLoadedAt) && state.orders.length > 0) {
      return state.orders;
    }
    if (state.ordersLoading) return state.orders;

    set({ ordersLoading: true, ordersError: null });
    try {
      const data = await getAllOrders();
      set({ orders: data, ordersLoading: false, ordersLoadedAt: Date.now() });
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载订单失败';
      set({ ordersError: msg, ordersLoading: false });
      return state.orders;
    }
  },

  // ── 泵壳模板 ────────
  fetchTemplates: async (force = false) => {
    const state = get();
    if (!force && !isStale(state.templatesLoadedAt) && state.templates.length > 0) {
      return state.templates;
    }
    if (state.templatesLoading) return state.templates;

    set({ templatesLoading: true, templatesError: null });
    try {
      const data = await getAllTemplates();
      set({ templates: data, templatesLoading: false, templatesLoadedAt: Date.now() });
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载模板失败';
      set({ templatesError: msg, templatesLoading: false });
      return state.templates;
    }
  },

  // ── 客户 ────────
  fetchCustomers: async (force = false) => {
    const state = get();
    if (!force && state.customers.length > 0) return state.customers;
    try {
      const { fetchCustomers: fetchC } = await import('./api');
      const data = await fetchC();
      set({ customers: data });
      return data;
    } catch (err) { console.error(err); return state.customers; }
  },

  // ── 报价单 ────────
  fetchQuotations: async (force = false) => {
    const state = get();
    if (!force && state.quotations.length > 0) return state.quotations;
    try {
      const { fetchQuotations: fetchQ } = await import('./api');
      const data = await fetchQ();
      set({ quotations: data });
      return data;
    } catch (err) { console.error(err); return state.quotations; }
  },

  // ── 批量加载 ────
  fetchAll: async (force = false) => {
    const { fetchParts, fetchRecipes, fetchOrders, fetchTemplates } = get();
    await Promise.all([fetchParts(force), fetchRecipes(force), fetchOrders(force), fetchTemplates(force)]);
  },

  // ── 局部更新 ────
  setParts: (parts) => set({ parts, partsLoadedAt: Date.now() }),
  setRecipes: (recipes) => set({ recipes, recipesLoadedAt: Date.now() }),
  setOrders: (orders) => set({ orders, ordersLoadedAt: Date.now() }),
  setTemplates: (templates) => set({ templates, templatesLoadedAt: Date.now() }),

  // ── 失效标记（下次访问时会重新请求）────
  invalidateParts: () => set({ partsLoadedAt: 0 }),
  invalidateRecipes: () => set({ recipesLoadedAt: 0 }),
  invalidateOrders: () => set({ ordersLoadedAt: 0 }),
  invalidateTemplates: () => set({ templatesLoadedAt: 0 }),
}));
