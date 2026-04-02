import { create } from 'zustand';
import { Part, Recipe } from '../types';
import { Order } from '../types';
import { getAllParts, getAllRecipes } from './api';
import { getAllOrders } from './orderStore';

// ─── Store 状态定义 ──────────────────────────

interface AppState {
  // 数据
  parts: Part[];
  recipes: Recipe[];
  orders: Order[];

  // 加载状态
  partsLoading: boolean;
  recipesLoading: boolean;
  ordersLoading: boolean;

  // 错误
  partsError: string | null;
  recipesError: string | null;
  ordersError: string | null;

  // 上次加载时间（用于 stale-while-revalidate）
  partsLoadedAt: number;
  recipesLoadedAt: number;
  ordersLoadedAt: number;

  // Actions
  fetchParts: (force?: boolean) => Promise<Part[]>;
  fetchRecipes: (force?: boolean) => Promise<Recipe[]>;
  fetchOrders: (force?: boolean) => Promise<Order[]>;
  fetchAll: (force?: boolean) => Promise<void>;

  // 局部更新（避免全量 refetch）
  setParts: (parts: Part[]) => void;
  setRecipes: (recipes: Recipe[]) => void;
  setOrders: (orders: Order[]) => void;
  invalidateParts: () => void;
  invalidateRecipes: () => void;
  invalidateOrders: () => void;
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
  partsLoading: false,
  recipesLoading: false,
  ordersLoading: false,
  partsError: null,
  recipesError: null,
  ordersError: null,
  partsLoadedAt: 0,
  recipesLoadedAt: 0,
  ordersLoadedAt: 0,

  // ── 零件 ────────
  fetchParts: async (force = false) => {
    const state = get();
    // 如果数据新鲜且不强制，直接返回缓存
    if (!force && !isStale(state.partsLoadedAt) && state.parts.length > 0) {
      return state.parts;
    }
    // 避免并发重复请求
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

  // ── 批量加载 ────
  fetchAll: async (force = false) => {
    const { fetchParts, fetchRecipes, fetchOrders } = get();
    await Promise.all([fetchParts(force), fetchRecipes(force), fetchOrders(force)]);
  },

  // ── 局部更新 ────
  setParts: (parts) => set({ parts, partsLoadedAt: Date.now() }),
  setRecipes: (recipes) => set({ recipes, recipesLoadedAt: Date.now() }),
  setOrders: (orders) => set({ orders, ordersLoadedAt: Date.now() }),

  // ── 失效标记（下次访问时会重新请求）────
  invalidateParts: () => set({ partsLoadedAt: 0 }),
  invalidateRecipes: () => set({ recipesLoadedAt: 0 }),
  invalidateOrders: () => set({ ordersLoadedAt: 0 }),
}));
