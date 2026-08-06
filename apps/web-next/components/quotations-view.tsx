'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence } from 'motion/react';
import { ArrowRight, CircleAlert, Eye, FileText, Pencil, Plus, RefreshCw, Save, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { FadePanel } from '@/components/motion/fade-panel';
import { PresenceRow } from '@/components/motion/presence-row';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { BusinessAlertsBanner } from '@/components/business-alerts-banner';
import { FactoryFileAttachments } from '@/components/factory-file-attachments';
import { MetricCard, MetricGrid } from '@/components/ui/metric-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Checkbox } from '@/components/ui/field';
import { FormError } from '@/components/ui/form-error';
import { ListToolbar } from '@/components/ui/list-toolbar';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TableScrollArea } from '@/components/ui/table-scroll-area';
import { useConfirmDiscard } from '@/hooks/use-confirm-discard';
import { dateShort, money } from '@/lib/format';
import type { Customer, Quotation } from '@/lib/customers';
import type { Part } from '@/lib/parts';
import type { Recipe, SurfaceTreatmentMode } from '@/lib/recipes';
import {
  buildCustomerNameMap,
  buildQuotationOrderDraft,
  buildQuotationStats,
  calculateQuotationTotals,
  convertQuotationToOrder,
  createQuotation,
  createQuotationItemFromRecipe,
  deleteQuotation,
  getQuotationDataset,
  parseQuotationItems,
  previewQuotationItemCost,
  quotationItemSummary,
  quotationStatusChoices,
  quotationStatusOptions,
  updateQuotation,
  updateQuotationStatus,
  type QuotationFilter,
  type QuotationItem,
  type QuotationItemOverrides,
  type QuotationOrderDraft,
  type QuotationPackingPart,
  type QuotationPackingRole,
  type QuotationStatus,
} from '@/lib/quotations';

const filterOptions: Array<{ value: QuotationFilter; label: string }> = [
  { value: '全部', label: '全部' },
  ...quotationStatusOptions.map((value) => ({ value, label: value })),
];

function quotationStatusSelectClassName(status: string): string {
  if (status === '草稿') return '!border-slate-200 !bg-white !text-slate-700';
  if (status === '已接受') return '!border-emerald-200 !bg-emerald-50 !text-emerald-700';
  if (status === '已转订单') return '!border-violet-200 !bg-violet-50 !text-violet-700';
  if (status === '已拒绝') return '!border-rose-200 !bg-rose-50 !text-rose-700';
  if (status === '已过时') return '!border-slate-200 !bg-slate-50 !text-slate-600';
  return '!border-sky-200 !bg-sky-50 !text-sky-700';
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function inferPackingMaterial(model: string): string {
  if (model.includes('木箱')) return '木箱';
  if (model.includes('彩印') || model.includes('彩箱')) return '彩印箱';
  if (model.includes('牛皮') || model.includes('纸箱')) return '牛皮纸箱';
  if (model.includes('泡沫')) return '泡沫';
  if (model.includes('商标') || model.includes('贴纸')) return '商标';
  if (model.includes('说明书')) return '说明书';
  if (model.includes('珍珠棉')) return '珍珠棉';
  if (model.includes('包装')) return '纸箱';
  return '其他包材';
}

function packingMaterialForPart(part: QuotationPackingPart): string {
  const model = `${part.model || ''} ${part.supplier || ''}`;
  if (
    model.includes('木箱')
    || model.includes('纸箱')
    || model.includes('泡沫')
    || model.includes('商标')
    || model.includes('贴纸')
    || model.includes('说明书')
    || model.includes('珍珠棉')
  ) {
    return inferPackingMaterial(model);
  }
  return part.packagingMaterial || inferPackingMaterial(model);
}

function inferPackingRole(part: QuotationPackingPart): QuotationPackingRole {
  if (part.packingRole) return part.packingRole;
  const model = part.model || '';
  if (model.includes('珍珠棉')) return 'pearlCotton';
  if (model.includes('泡沫')) return 'foam';
  if (model.includes('说明书') || model.includes('贴纸') || model.includes('商标')) return 'fixed';
  if (model.includes('木箱') || model.includes('纸箱') || model.includes('外包装')) return 'container';
  const material = part.packagingMaterial || '';
  if (material.includes('珍珠棉')) return 'pearlCotton';
  if (material.includes('泡沫')) return 'foam';
  if (material.includes('木箱') || material.includes('纸箱')) return 'container';
  return 'fixed';
}

type PackingOption = Required<Pick<QuotationPackingPart, 'model' | 'supplier' | 'packagingMaterial' | 'packingRole'>> & {
  price: number;
};

function packingOptionKey(option: Pick<PackingOption, 'model' | 'supplier' | 'packagingMaterial' | 'price'>): string {
  return `${option.model}||${option.supplier}||${option.packagingMaterial}||${option.price}`;
}

function normalizePackingParts(value: unknown): QuotationPackingPart[] {
  return parseJsonArray<QuotationPackingPart>(value)
    .filter((part) => part?.model)
    .map((part) => ({
      ...part,
      supplier: part.supplier || '',
      qty: Number(part.qty || 1),
      packagingMaterial: packingMaterialForPart(part),
      packingRole: inferPackingRole({ ...part, packagingMaterial: packingMaterialForPart(part) }),
    }));
}

function packingPartFromOption(option: PackingOption): QuotationPackingPart {
  return {
    model: option.model,
    supplier: option.supplier,
    qty: 1,
    packagingMaterial: option.packagingMaterial,
    packingRole: option.packingRole,
    snapshotPrice: option.price,
  };
}

const surfaceTreatmentLabels: Record<SurfaceTreatmentMode, string> = {
  none: '无',
  painting: '喷漆',
  electrophoresis: '电泳',
  electrophoresis_powder_coating: '电泳+喷塑',
  powder_coating: '整体喷塑',
  custom: '自定义',
};

function surfaceTreatmentLabel(mode: SurfaceTreatmentMode | undefined): string {
  return surfaceTreatmentLabels[mode || 'none'] || '无';
}

function quotationTaxIncludedFactoryPrice(quotation: Quotation): number {
  return Math.round((Number(quotation.totalPrice || 0) / 0.9) * 100) / 100;
}

function marginMultiplierToPercent(value: unknown): number {
  return Math.round((Math.max(0.01, Number(value) || 1.1) - 1) * 10000) / 100;
}

function marginPercentToMultiplier(value: unknown): number {
  return 1 + Math.max(0, Number(value) || 0) / 100;
}

function customerMarginPercent(customer?: Customer): string {
  return customer ? String(Math.round(Number(customer.defaultMargin || 0) * 10000) / 100) : '10';
}

function yesNo(value: unknown): string {
  return value ? '是' : '否';
}

function wireText(value: unknown): string {
  const text = String(value ?? '').trim();
  return text || '-';
}

function packingSummary(value: unknown): string {
  const rows = normalizePackingParts(value);
  if (rows.length === 0) return '-';
  return rows
    .map((item) => {
      const material = item.packagingMaterial ? `${item.packagingMaterial} · ` : '';
      const supplier = item.supplier ? ` / ${item.supplier}` : '';
      const qty = Number(item.qty || 0) > 0 ? ` x${item.qty}` : '';
      return `${material}${item.model || '未命名包材'}${supplier}${qty}`;
    })
    .join('；');
}

export function QuotationsView() {
  const searchParams = useSearchParams();
  const consumedPrefillRef = useRef('');
  const consumedViewQuotationRef = useRef('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<QuotationFilter>('全部');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<Quotation | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [formStatus, setFormStatus] = useState<QuotationStatus>('报价中');
  const [remark, setRemark] = useState('');
  const [recipeId, setRecipeId] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [itemMargin, setItemMargin] = useState('10');
  const [draftItems, setDraftItems] = useState<QuotationItem[]>([]);
  const [calculatingItemId, setCalculatingItemId] = useState<string | null>(null);
  const [convertTarget, setConvertTarget] = useState<Quotation | null>(null);
  const [convertDraft, setConvertDraft] = useState<QuotationOrderDraft | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [viewQuotation, setViewQuotation] = useState<Quotation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Quotation | null>(null);
  const overridePreviewSeqRef = useRef(new Map<string, number>());
  const {
    dirty: formDirty,
    discardPromptOpen,
    discardMessage,
    markDirty: markFormDirty,
    resetDirty: resetFormDirty,
    requestClose: requestDrawerClose,
    confirmDiscard,
    cancelDiscard,
  } = useConfirmDiscard({
    open: drawerOpen,
    busy: Boolean(savingId),
    onDiscard: () => setDrawerOpen(false),
  });

  async function load(force = false) {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await getQuotationDataset();
      setCustomers(data.customers);
      setQuotations(data.quotations);
      setRecipes(data.recipes);
      setParts(data.parts);
      setCustomerId((current) => current || (data.customers[0] ? String(data.customers[0].id) : ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : '报价加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const customerNameMap = useMemo(() => buildCustomerNameMap(customers), [customers]);
  const stats = useMemo(() => buildQuotationStats(quotations), [quotations]);
  const selectedRecipe = recipes.find((recipe) => String(recipe.id) === recipeId);
  const draftTotals = useMemo(() => calculateQuotationTotals(draftItems), [draftItems]);
  const prefillCustomerId = searchParams.get('customerId') || '';
  const shouldCreateFromQuery = searchParams.get('create') === '1';
  const prefillKey = `${shouldCreateFromQuery}:${prefillCustomerId}`;
  const viewQuotationId = searchParams.get('quotationId') || '';
  const packagingOptions = useMemo(() => {
    const options = new Map<string, PackingOption>();
    const packingUsageCounts = new Map<string, Map<string, { count: number; part: QuotationPackingPart }>>();
    recipes.forEach((recipe) => {
      normalizePackingParts(recipe.packingPartsJson).forEach((packing) => {
        const usageKey = `${packing.model || ''}||${packing.supplier || ''}`;
        const usageSignature = `${inferPackingRole(packing)}||${packing.packagingMaterial || ''}`;
        const counts = packingUsageCounts.get(usageKey) || new Map();
        const existing = counts.get(usageSignature);
        counts.set(usageSignature, { count: (existing?.count || 0) + 1, part: packing });
        packingUsageCounts.set(usageKey, counts);
      });
    });
    const packingUsage = new Map<string, QuotationPackingPart>();
    packingUsageCounts.forEach((counts, key) => {
      const ranked = Array.from(counts.values()).sort((a, b) => b.count - a.count);
      if (ranked[0]) packingUsage.set(key, ranked[0].part);
    });
    const addOption = (packing: QuotationPackingPart, price = 0) => {
      const model = packing.model || '';
      const supplier = packing.supplier || '';
      if (!model) return;
      const packagingMaterial = packingMaterialForPart(packing);
      const packingRole = inferPackingRole({ ...packing, packagingMaterial });
      const option = { model, supplier, price, packagingMaterial, packingRole };
      options.set(packingOptionKey(option), option);
    };

    parts.forEach((part) => {
      const model = part.model || '';
      const category = part.category || '';
      const looksLikePacking = category === '包装' || model.includes('木箱') || model.includes('纸箱') || model.includes('包装');
      if (!looksLikePacking) return;
      const usage = packingUsage.get(`${model}||${part.supplier || ''}`);
      const partIdentity = `${model} ${part.notes || ''}`;
      const classifiedRole = part.subcategory === '外包装'
        ? 'container'
        : part.subcategory === '固定包材'
          ? 'fixed'
          : undefined;
      addOption({
        model,
        supplier: part.supplier || '',
        packagingMaterial: usage?.packagingMaterial || inferPackingMaterial(partIdentity),
        packingRole: usage ? inferPackingRole(usage) : classifiedRole,
      }, Number(part.price || 0));
    });

    recipes.forEach((recipe) => {
      normalizePackingParts(recipe.packingPartsJson).forEach((packing) => {
        const model = packing.model || '';
        const supplier = packing.supplier || '';
        const partPrice = parts.find((part) => part.model === model && (!supplier || part.supplier === supplier))?.price || 0;
        addOption(packing, Number(packing.snapshotPrice ?? partPrice ?? 0));
      });
      if (recipe.boxType) addOption({
        model: recipe.boxType,
        supplier: '',
        packagingMaterial: inferPackingMaterial(recipe.boxType),
        packingRole: 'container',
      }, 0);
    });

    return Array.from(options.values()).sort((a, b) => (
      a.packingRole.localeCompare(b.packingRole)
      || a.packagingMaterial.localeCompare(b.packagingMaterial, 'zh-Hans-CN')
      || a.model.localeCompare(b.model, 'zh-Hans-CN')
    ));
  }, [parts, recipes]);
  const containerOptions = useMemo(() => packagingOptions.filter((option) => option.packingRole === 'container'), [packagingOptions]);
  const foamOptions = useMemo(() => packagingOptions.filter((option) => option.packingRole === 'foam'), [packagingOptions]);
  const pearlCottonOptions = useMemo(() => packagingOptions.filter((option) => option.packingRole === 'pearlCotton'), [packagingOptions]);

  const filteredQuotations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return quotations.filter((quotation) => {
      const customerName = customerNameMap.get(quotation.customerId) || '';
      const text = `${customerName} ${quotation.status} ${quotation.remark || ''} ${quotationItemSummary(quotation)}`.toLowerCase();
      return (status === '全部' || quotation.status === status) && (!normalizedQuery || text.includes(normalizedQuery));
    });
  }, [customerNameMap, query, quotations, status]);

  useEffect(() => {
    if (loading || !shouldCreateFromQuery || !prefillCustomerId || consumedPrefillRef.current === prefillKey) return;
    const customer = customers.find((item) => String(item.id) === prefillCustomerId);
    if (!customer) return;

    consumedPrefillRef.current = prefillKey;
    resetFormDirty();
    setEditingQuotation(null);
    setCustomerId(String(customer.id));
    setFormStatus('报价中');
    setRemark('');
    setRecipeId('');
    setItemQty('1');
    setItemMargin(customerMarginPercent(customer));
    setDraftItems([]);
    setFormError(null);
    setDrawerOpen(true);
  }, [customers, loading, prefillCustomerId, prefillKey, resetFormDirty, shouldCreateFromQuery]);

  useEffect(() => {
    if (loading || !viewQuotationId || consumedViewQuotationRef.current === viewQuotationId) return;
    const numericId = Number(viewQuotationId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      consumedViewQuotationRef.current = viewQuotationId;
      return;
    }
    const target = quotations.find((quotation) => quotation.id === numericId);
    if (!target) {
      consumedViewQuotationRef.current = viewQuotationId;
      setError(`报价 #${numericId} 不存在或已删除`);
      return;
    }

    consumedViewQuotationRef.current = viewQuotationId;
    setDrawerOpen(false);
    setEditingQuotation(null);
    setConvertTarget(null);
    setConvertDraft(null);
    setViewQuotation(target);
  }, [loading, quotations, viewQuotationId]);

  async function saveStatus(quotation: Quotation, nextStatus: QuotationStatus) {
    if (quotation.status === nextStatus) return;
    setSavingId(String(quotation.id));
    setError(null);

    try {
      const updated = await updateQuotationStatus(quotation, nextStatus);
      setQuotations((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '报价状态保存失败');
      await load(true);
    } finally {
      setSavingId(null);
    }
  }

  function resetForm() {
    const firstCustomer = customers[0];
    setEditingQuotation(null);
    setCustomerId(firstCustomer ? String(firstCustomer.id) : '');
    setFormStatus('报价中');
    setRemark('');
    setRecipeId('');
    setItemQty('1');
    setItemMargin(customerMarginPercent(firstCustomer));
    setDraftItems([]);
    setFormError(null);
  }

  function openCreateDrawer() {
    resetFormDirty();
    resetForm();
    setDrawerOpen(true);
  }

  function openEditDrawer(quotation: Quotation) {
    resetFormDirty();
    const customer = customers.find((item) => item.id === quotation.customerId);
    setEditingQuotation(quotation);
    setCustomerId(String(quotation.customerId));
    setFormStatus(quotation.status as QuotationStatus);
    setRemark(quotation.remark || '');
    setRecipeId('');
    setItemQty('1');
    setItemMargin(customerMarginPercent(customer));
    setDraftItems(hydrateQuotationItemsForEdit(parseQuotationItems(quotation.itemsJson)));
    setFormError(null);
    setDrawerOpen(true);
  }

  function hydrateQuotationItemsForEdit(items: QuotationItem[]): QuotationItem[] {
    return items.map((item) => {
      const hasSavedOverrides = item.overrides && Object.keys(item.overrides).length > 0;
      if (hasSavedOverrides) return item;
      const recipe = recipes.find((next) => next.id === Number(item.baseRecipeId || 0));
      return recipe ? { ...item, overrides: createQuotationItemFromRecipe(recipe, Number(item.qty || 1), Number(item.margin || 1.1)).overrides } : item;
    });
  }

  function onCustomerChange(nextId: string) {
    setCustomerId(nextId);
    const customer = customers.find((item) => String(item.id) === nextId);
    setItemMargin(customerMarginPercent(customer));
  }

  function recostQuotationItem(item: QuotationItem, unitCost: number): QuotationItem {
    const qty = Math.max(1, Number(item.qty) || 1);
    const margin = Math.max(0.01, Number(item.margin) || 1.1);
    const unitPrice = Math.round(unitCost * margin * 100) / 100;
    return {
      ...item,
      qty,
      unitCost,
      margin,
      unitPrice,
      totalPrice: Math.round(unitPrice * qty * 100) / 100,
    };
  }

  async function addDraftItem() {
    if (!selectedRecipe) {
      setFormError('请先选择配方');
      return;
    }
    const item = createQuotationItemFromRecipe(selectedRecipe, Number(itemQty), marginPercentToMultiplier(itemMargin));
    setCalculatingItemId(item.id || null);
    setFormError(null);
    try {
      const unitCost = await previewQuotationItemCost(selectedRecipe.id, item.overrides || {});
      setDraftItems((current) => [...current, recostQuotationItem(item, unitCost)]);
      markFormDirty();
      setItemQty('1');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '报价成本重算失败');
    } finally {
      setCalculatingItemId(null);
    }
  }

  function updateDraftItem(id: string | undefined, patch: Partial<QuotationItem>) {
    if (!id) return;
    setDraftItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const qty = patch.qty == null ? Number(item.qty || 1) : Math.max(1, Number(patch.qty) || 1);
      const unitCost = Number(item.unitCost) || 0;
      const margin = patch.margin == null ? Number(item.margin || 1.1) : Math.max(0.01, Number(patch.margin) || 1.1);
      const unitPrice = patch.unitPrice == null ? unitCost * margin : Math.max(0, Number(patch.unitPrice) || 0);
      return {
        ...item,
        qty,
        margin: patch.unitPrice == null ? margin : (unitCost > 0 ? unitPrice / unitCost : margin),
        unitPrice: Math.round(unitPrice * 100) / 100,
        totalPrice: Math.round(unitPrice * qty * 100) / 100,
      };
    }));
  }

  async function updateDraftItemOverrides(id: string | undefined, patch: QuotationItemOverrides) {
    if (!id) return;
    const currentItem = draftItems.find((item) => item.id === id);
    const recipeIdForPreview = Number(currentItem?.baseRecipeId || 0);
    if (!currentItem || !recipeIdForPreview) return;

    const overrides = { ...(currentItem.overrides || {}), ...patch };
    const requestSeq = (overridePreviewSeqRef.current.get(id) || 0) + 1;
    overridePreviewSeqRef.current.set(id, requestSeq);
    setDraftItems((current) => current.map((item) => (
      item.id === id ? { ...item, overrides } : item
    )));
    setCalculatingItemId(id);
    setFormError(null);
    try {
      const unitCost = await previewQuotationItemCost(recipeIdForPreview, overrides);
      if (overridePreviewSeqRef.current.get(id) !== requestSeq) return;
      setDraftItems((current) => current.map((item) => (
        item.id === id ? recostQuotationItem(item, unitCost) : item
      )));
    } catch (err) {
      if (overridePreviewSeqRef.current.get(id) !== requestSeq) return;
      setDraftItems((current) => current.map((item) => (
        item.id === id ? { ...item, overrides: currentItem.overrides } : item
      )));
      setFormError(err instanceof Error ? err.message : '报价覆盖成本重算失败');
    } finally {
      if (overridePreviewSeqRef.current.get(id) === requestSeq) setCalculatingItemId(null);
    }
  }

  function defaultPackingOption(item: QuotationItem, role: QuotationPackingRole): PackingOption | undefined {
    const recipe = recipes.find((next) => next.id === Number(item.baseRecipeId || 0));
    const basePart = normalizePackingParts(recipe?.packingPartsJson).find((part) => inferPackingRole(part) === role);
    if (basePart?.model) {
      const catalogPrice = parts.find((part) => (
        part.model === basePart.model
        && (!basePart.supplier || part.supplier === basePart.supplier)
      ))?.price;
      return {
        model: basePart.model,
        supplier: basePart.supplier || '',
        packagingMaterial: basePart.packagingMaterial || inferPackingMaterial(basePart.model),
        packingRole: role,
        price: Number(basePart.snapshotPrice ?? catalogPrice ?? 0),
      };
    }
    const roleOptions = role === 'container'
      ? containerOptions
      : role === 'foam'
        ? foamOptions
        : pearlCottonOptions;
    return roleOptions[0];
  }

  function updatePackingConfiguration(item: QuotationItem, role: QuotationPackingRole, option?: PackingOption) {
    const currentParts = normalizePackingParts(item.overrides?.packingPartsJson);
    const nextParts = currentParts.filter((part) => inferPackingRole(part) !== role);
    if (option) nextParts.push(packingPartFromOption(option));
    const container = nextParts.find((part) => inferPackingRole(part) === 'container');
    void updateDraftItemOverrides(item.id, {
      boxType: container?.model || '',
      packingPartsJson: JSON.stringify(nextParts),
    });
  }

  function togglePackingConfiguration(item: QuotationItem, role: 'foam' | 'pearlCotton', enabled: boolean) {
    if (!enabled) {
      updatePackingConfiguration(item, role);
      return;
    }
    const option = defaultPackingOption(item, role);
    if (!option) {
      setFormError(role === 'foam' ? '零件库和配方中没有可用泡沫包材' : '零件库和配方中没有可用珍珠棉包材');
      return;
    }
    updatePackingConfiguration(item, role, option);
  }

  async function submitQuotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericCustomerId = Number(customerId);
    if (!numericCustomerId) {
      setFormError('请选择客户');
      return;
    }
    if (draftItems.length === 0) {
      setFormError('至少添加一个报价明细');
      return;
    }

    setSavingId('form');
    setFormError(null);
    setError(null);

    try {
      if (editingQuotation) {
        await updateQuotation({
          id: editingQuotation.id,
          customerId: numericCustomerId,
          status: formStatus,
          items: draftItems,
          remark,
          expectedUpdatedAt: editingQuotation.updatedAt,
        });
      } else {
        await createQuotation({ customerId: numericCustomerId, status: formStatus, items: draftItems, remark });
      }
      await load(true);
      resetFormDirty();
      setDrawerOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '报价保存失败');
    } finally {
      setSavingId(null);
    }
  }

  async function removeQuotation(quotation: Quotation) {
    setSavingId(`delete-${quotation.id}`);
    setError(null);
    try {
      await deleteQuotation(quotation);
      await load(true);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '报价删除失败');
    } finally {
      setSavingId(null);
    }
  }

  async function openConvertPreview(quotation: Quotation) {
    const customer = customers.find((item) => item.id === quotation.customerId);
    if (!customer) {
      setError('报价客户不存在，无法转订单');
      return;
    }
    setSavingId(`convert-${quotation.id}`);
    setConvertError(null);
    setError(null);
    try {
      const draft = await buildQuotationOrderDraft(quotation.id);
      setConvertTarget(quotation);
      setConvertDraft(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成转单预览失败');
    } finally {
      setSavingId(null);
    }
  }

  function closeConvertPreview() {
    if (savingId) return;
    setConvertTarget(null);
    setConvertDraft(null);
    setConvertError(null);
  }

  async function confirmConvertToOrder() {
    if (!convertTarget || !convertDraft) return;
    const customer = customers.find((item) => item.id === convertTarget.customerId);
    if (!customer) {
      setConvertError('报价客户不存在，无法转订单');
      return;
    }
    setSavingId(`convert-${convertTarget.id}`);
    setConvertError(null);
    try {
      await convertQuotationToOrder({ quotation: convertTarget, customer, recipes, draft: convertDraft });
      setConvertTarget(null);
      setConvertDraft(null);
      await load(true);
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : '转订单失败');
    } finally {
      setSavingId(null);
    }
  }

  const convertPurchaseRows = convertDraft?.purchaseList.filter((item) => Number(item.needToBuy || 0) > 0) || [];
  const viewQuotationItems = useMemo(() => parseQuotationItems(viewQuotation?.itemsJson), [viewQuotation]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="报价单"
        description="基于配方成本生成报价并跟踪转单状态。"
        actions={(
          <>
          <Button
            onClick={() => void load(true)}
            disabled={refreshing || Boolean(savingId)}
            icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}
          >
            刷新
          </Button>
          <Button variant="primary" onClick={openCreateDrawer} disabled={Boolean(savingId)} icon={<Plus size={15} />}>
            新建报价
          </Button>
          </>
        )}
      />

      <BusinessAlertsBanner scope="quotation" />

      <MetricGrid>
        <MetricCard value={String(stats.quoteCount)} label="报价总数" delay={0.02} />
        <MetricCard
          value={String(stats.quotingCount)}
          label="报价中"
          tone={stats.quotingCount > 0 ? 'attention' : 'default'}
          delay={0.04}
        />
        <MetricCard value={String(stats.acceptedOrConverted)} label="已接受/转单" delay={0.06} />
        <MetricCard value={money(stats.totalPrice)} label="总报价金额" delay={0.08} />
      </MetricGrid>

      <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          searchLabel="搜索报价单"
          placeholder="搜索客户、备注、配方或状态"
          resultText={`显示 ${filteredQuotations.length} / ${quotations.length} 张报价`}
          hasActiveFilters={Boolean(query.trim()) || status !== '全部'}
          onReset={() => {
            setQuery('');
            setStatus('全部');
          }}
          filters={(
            <>
              <SlidersHorizontal size={16} className="shrink-0 text-muted" />
              <SegmentedControl value={status} options={filterOptions} onChange={setStatus} ariaLabel="报价状态筛选" />
            </>
          )}
        />

        {error ? (
          <div className="flex items-center gap-2 border-b border-line p-4 text-sm text-rose-700">
            <CircleAlert size={16} />
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
            ))}
          </div>
        ) : filteredQuotations.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={quotations.length === 0 ? '还没有报价单' : '没有匹配的报价单'}
            description={quotations.length === 0 ? '新建第一张报价后，可以在这里跟进接受和转单状态。' : '调整搜索词或报价状态后再看。'}
            action={quotations.length === 0 ? (
              <Button size="sm" variant="primary" onClick={openCreateDrawer} icon={<Plus size={14} />}>新建报价</Button>
            ) : null}
          />
        ) : (
          <>
            <div className="divide-y divide-line min-[1280px]:hidden">
              {filteredQuotations.map((quotation) => {
                const customerName = customerNameMap.get(quotation.customerId) || `未知客户 #${quotation.customerId}`;
                const saving = savingId === String(quotation.id);
                return (
                  <article key={quotation.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-ink">{customerName}</div>
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{quotationItemSummary(quotation)}</div>
                      </div>
                      <select
                        value={quotation.status}
                        disabled={saving || Boolean(savingId && savingId !== String(quotation.id))}
                        onChange={(event) => void saveStatus(quotation, event.target.value as QuotationStatus)}
                        className={`h-8 min-w-[5.25rem] shrink-0 whitespace-nowrap rounded-full border px-3 text-center text-xs font-medium outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${quotationStatusSelectClassName(quotation.status)}`}
                        aria-label={`${customerName}报价状态`}
                      >
                        {quotationStatusChoices(quotation.status as QuotationStatus).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-xs">
                      <div>
                        <div className="text-muted">总报价</div>
                        <div className="mt-1 text-base font-semibold text-ink">{money(quotation.totalPrice)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-muted">含税出厂价</div>
                        <div className="mt-1 text-base font-semibold text-ink">{money(quotationTaxIncludedFactoryPrice(quotation))}</div>
                      </div>
                      <div className="text-muted">成本 {money(quotation.totalCost)}</div>
                      <div className="text-right text-muted">{dateShort(quotation.createdAt)}</div>
                    </div>
                    {quotation.remark ? <div className="line-clamp-2 text-xs text-muted">备注：{quotation.remark}</div> : null}
                    <div className="flex flex-wrap justify-end gap-2">
                      {quotation.status === '已接受' ? (
                        <Button size="sm" variant="primary" disabled={Boolean(savingId)} onClick={() => void openConvertPreview(quotation)} icon={<ArrowRight size={14} />}>
                          转订单
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" disabled={Boolean(savingId)} onClick={() => setViewQuotation(quotation)} icon={<Eye size={14} />}>
                        查看
                      </Button>
                      {(quotation.status === '草稿' || quotation.status === '报价中') ? (
                        <Button size="sm" variant="ghost" disabled={Boolean(savingId)} onClick={() => openEditDrawer(quotation)} icon={<Pencil size={14} />}>
                          编辑
                        </Button>
                      ) : null}
                      {(['草稿', '已拒绝', '已过时'] as QuotationStatus[]).includes(quotation.status as QuotationStatus) ? (
                        <Button size="sm" variant="danger" disabled={Boolean(savingId)} onClick={() => setDeleteTarget(quotation)} icon={<Trash2 size={14} />}>
                          删除
                        </Button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="hidden min-[1280px]:block">
          <TableScrollArea label="报价列表">
            <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                <tr>
                  <th className="border-b border-line px-4 py-3">客户</th>
                  <th className="border-b border-line px-4 py-3">明细</th>
                  <th className="border-b border-line px-4 py-3">状态</th>
                  <th className="hidden border-b border-line px-4 py-3 text-right min-[1440px]:table-cell">总成本</th>
                  <th className="border-b border-line px-4 py-3 text-right">总报价</th>
                  <th className="hidden border-b border-line px-4 py-3 text-right min-[1440px]:table-cell">含税出厂价</th>
                  <th className="border-b border-line px-4 py-3">创建</th>
                  <th className="border-b border-line px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {filteredQuotations.map((quotation) => {
                    const customerName = customerNameMap.get(quotation.customerId) || `未知客户 #${quotation.customerId}`;
                    const saving = savingId === String(quotation.id);

                    return (
                      <PresenceRow key={quotation.id} className="transition-colors hover:bg-slate-50">
                        <td className="border-b border-line px-4 py-3">
                          <div className="font-medium text-ink">{customerName}</div>
                          <div className="mt-0.5 max-w-[260px] truncate text-xs text-muted">{quotation.remark || '无备注'}</div>
                        </td>
                        <td className="border-b border-line px-4 py-3">
                          <div className="max-w-[360px] truncate text-muted">{quotationItemSummary(quotation)}</div>
                        </td>
                        <td className="border-b border-line px-4 py-3">
                          <select
                            value={quotation.status}
                            disabled={saving || Boolean(savingId && savingId !== String(quotation.id))}
                            onChange={(event) => void saveStatus(quotation, event.target.value as QuotationStatus)}
                            className={`h-8 min-w-[5.25rem] whitespace-nowrap rounded-full border px-3 text-center text-xs font-medium outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${quotationStatusSelectClassName(quotation.status)}`}
                          >
                            {quotationStatusChoices(quotation.status as QuotationStatus).map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </td>
                        <td className="hidden border-b border-line px-4 py-3 text-right text-muted min-[1440px]:table-cell">{money(quotation.totalCost)}</td>
                        <td className="border-b border-line px-4 py-3 text-right font-medium text-ink">{money(quotation.totalPrice)}</td>
                        <td className="hidden border-b border-line px-4 py-3 text-right font-medium text-ink min-[1440px]:table-cell">{money(quotationTaxIncludedFactoryPrice(quotation))}</td>
                        <td className="border-b border-line px-4 py-3 text-muted">{dateShort(quotation.createdAt)}</td>
                        <td className="border-b border-line px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {quotation.status === '已接受' ? (
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={Boolean(savingId)}
                                onClick={() => void openConvertPreview(quotation)}
                                icon={<ArrowRight size={14} />}
                              >
                                转订单
                              </Button>
                            ) : null}
                            <Button size="sm" variant="ghost" disabled={Boolean(savingId)} onClick={() => setViewQuotation(quotation)} icon={<Eye size={14} />}>
                              查看
                            </Button>
                            {(quotation.status === '草稿' || quotation.status === '报价中') ? (
                              <Button size="sm" variant="ghost" disabled={Boolean(savingId)} onClick={() => openEditDrawer(quotation)} icon={<Pencil size={14} />}>
                                编辑
                              </Button>
                            ) : null}
                            {(['草稿', '已拒绝', '已过时'] as QuotationStatus[]).includes(quotation.status as QuotationStatus) ? (
                              <Button size="sm" variant="danger" disabled={Boolean(savingId)} onClick={() => setDeleteTarget(quotation)} icon={<Trash2 size={14} />}>
                                删除
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </PresenceRow>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </TableScrollArea>
            </div>
          </>
        )}
      </FadePanel>

      <SlideOver open={Boolean(viewQuotation)} onClose={() => setViewQuotation(null)} size="workspace">
        {viewQuotation ? (
          <div className="flex min-h-full flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-line p-5">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Quotation Config</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">报价配置 #{viewQuotation.id}</h2>
                <div className="mt-1 text-sm text-muted">
                  {customerNameMap.get(viewQuotation.customerId) || `未知客户 #${viewQuotation.customerId}`} · {dateShort(viewQuotation.createdAt)}
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setViewQuotation(null)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-5 p-5">
              <section className="grid gap-3 md:grid-cols-3">
                <div className="rounded-panel border border-line p-4">
                  <div className="text-xs text-muted">出厂价</div>
                  <div className="mt-1 text-lg font-semibold text-ink">{money(viewQuotation.totalPrice)}</div>
                </div>
                <div className="rounded-panel border border-line p-4">
                  <div className="text-xs text-muted">含税出厂价</div>
                  <div className="mt-1 text-lg font-semibold text-ink">{money(quotationTaxIncludedFactoryPrice(viewQuotation))}</div>
                </div>
                <div className="rounded-panel border border-line p-4">
                  <div className="text-xs text-muted">状态</div>
                  <div className="mt-1 text-lg font-semibold text-ink">{viewQuotation.status}</div>
                </div>
              </section>

              <section className="rounded-panel border border-line">
                <div className="border-b border-line p-4">
                  <div className="text-sm font-semibold text-ink">产品配置</div>
                  <div className="mt-1 text-xs text-muted">只展示报价时的关键配置，不展开详细 BOM。</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[980px] border-separate border-spacing-0 text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                      <tr>
                        <th className="border-b border-line px-4 py-3">产品</th>
                        <th className="border-b border-line px-4 py-3">线圈</th>
                        <th className="border-b border-line px-4 py-3">浮球</th>
                        <th className="border-b border-line px-4 py-3">电缆</th>
                        <th className="border-b border-line px-4 py-3">包材</th>
                        <th className="border-b border-line px-4 py-3">表面处理</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewQuotationItems.map((item, index) => {
                        const overrides = item.overrides || {};
                        const cable = overrides.hasCable
                          ? `${wireText(overrides.cableWire)} · ${overrides.cableLength || 0} 米`
                          : '不带';
                        const float = overrides.hasFloat
                          ? `${wireText(overrides.floatWire)} · ${overrides.floatAccessoryType === 'xinjie' ? '新界式' : '普通铜套'}`
                          : '不带';
                        return (
                          <tr key={item.id || `${item.baseRecipeName}-${index}`}>
                            <td className="border-b border-line px-4 py-3 align-top">
                              <div className="font-medium text-ink">{item.baseRecipeName || '未命名产品'}</div>
                              <div className="mt-0.5 text-xs text-muted">{item.spec || '-'} · 数量 {item.qty || 0}</div>
                            </td>
                            <td className="border-b border-line px-4 py-3 align-top text-muted">
                              <div>{wireText(overrides.coilSpec)}</div>
                              <div className="mt-0.5 text-xs">{overrides.coilSheets || '-'} 片 · {overrides.coilMaterial || '钢带'} · {overrides.coilSlotType || '小眼'}</div>
                            </td>
                            <td className="border-b border-line px-4 py-3 align-top text-muted">{float}</td>
                            <td className="border-b border-line px-4 py-3 align-top text-muted">{cable}</td>
                            <td className="border-b border-line px-4 py-3 align-top text-muted">{packingSummary(overrides.packingPartsJson)}</td>
                            <td className="border-b border-line px-4 py-3 align-top text-muted">
                              {surfaceTreatmentLabel(overrides.surfaceTreatmentMode)}
                              {overrides.surfaceTreatmentMode && overrides.surfaceTreatmentMode !== 'none' ? ` · ${money(Number(overrides.surfaceTreatmentCost || 0))}` : ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {viewQuotationItems.length === 0 ? (
                  <div className="p-4 text-sm text-muted">这张报价没有可查看的产品配置。</div>
                ) : null}
              </section>

              <div className="rounded-panel border border-line bg-slate-50 p-4 text-sm text-muted">
                浮球：{yesNo(viewQuotationItems.some((item) => item.overrides?.hasFloat))}；电缆：{yesNo(viewQuotationItems.some((item) => item.overrides?.hasCable))}；备注：{viewQuotation.remark || '-'}
              </div>

              <FactoryFileAttachments
                targetType="quotation"
                targetId={viewQuotation.id}
                title="报价附件"
                description="保存客户原始报价文件、价格表、图片和补充说明；不会自动修改正式报价。"
              />
            </div>
          </div>
        ) : null}
      </SlideOver>

      <SlideOver open={Boolean(convertTarget)} onClose={closeConvertPreview}>
        {convertTarget && convertDraft ? (
          <div className="flex min-h-full flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-line p-5">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Convert</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">报价转订单预览</h2>
                <div className="mt-1 text-sm text-muted">确认后会创建订单，并把报价状态改为已转订单。</div>
              </div>
              <button
                type="button"
                aria-label="关闭"
                disabled={Boolean(savingId)}
                onClick={closeConvertPreview}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-5 p-5">
              {convertError ? (
                <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <CircleAlert size={16} />
                  {convertError}
                </div>
              ) : null}

              <section className="grid gap-3 md:grid-cols-3">
                <div className="rounded-panel border border-line p-4">
                  <div className="text-xs text-muted">客户</div>
                  <div className="mt-1 truncate text-lg font-semibold text-ink">{convertDraft.customerName || '-'}</div>
                </div>
                <div className="rounded-panel border border-line p-4">
                  <div className="text-xs text-muted">订单产品</div>
                  <div className="mt-1 text-lg font-semibold text-ink">{convertDraft.items.length}</div>
                </div>
                <div className="rounded-panel border border-line p-4">
                  <div className="text-xs text-muted">采购待办</div>
                  <div className="mt-1 text-lg font-semibold text-ink">{convertDraft.todos.length}</div>
                </div>
              </section>

              <section className="rounded-panel border border-line">
                <div className="border-b border-line p-4">
                  <div className="text-sm font-semibold text-ink">订单产品</div>
                  <div className="mt-1 text-xs text-muted">{convertDraft.remark || '无备注'}</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                      <tr>
                        <th className="border-b border-line px-4 py-3">产品</th>
                        <th className="border-b border-line px-4 py-3 text-right">数量</th>
                        <th className="border-b border-line px-4 py-3 text-right">成本</th>
                        <th className="border-b border-line px-4 py-3 text-right">单价</th>
                      </tr>
                    </thead>
                    <tbody>
                      {convertDraft.items.map((item) => (
                        <tr key={item.id}>
                          <td className="border-b border-line px-4 py-3">
                            <div className="font-medium text-ink">{item.recipeName || '-'}</div>
                            <div className="mt-0.5 text-xs text-muted">{item.spec || '-'}</div>
                          </td>
                          <td className="border-b border-line px-4 py-3 text-right text-muted">{item.qty}</td>
                          <td className="border-b border-line px-4 py-3 text-right text-muted">{money(item.unitCost)}</td>
                          <td className="border-b border-line px-4 py-3 text-right font-medium text-ink">{money(item.unitPrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-panel border border-line">
                <div className="flex items-center justify-between gap-3 border-b border-line p-4">
                  <div className="text-sm font-semibold text-ink">采购计划预览</div>
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{convertPurchaseRows.length} 项</span>
                </div>
                {convertPurchaseRows.length === 0 ? (
                  <div className="p-4 text-sm text-muted">库存充足，暂无需要采购的物料。</div>
                ) : (
                  <div className="max-h-64 overflow-auto">
                    <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                        <tr>
                          <th className="border-b border-line px-4 py-3">型号</th>
                          <th className="border-b border-line px-4 py-3">供应商</th>
                          <th className="border-b border-line px-4 py-3 text-right">需采购</th>
                        </tr>
                      </thead>
                      <tbody>
                        {convertPurchaseRows.map((item) => (
                          <tr key={`${item.model}-${item.supplier}`}>
                            <td className="border-b border-line px-4 py-3 font-medium text-ink">{item.model}</td>
                            <td className="border-b border-line px-4 py-3 text-muted">{item.supplier || '-'}</td>
                            <td className="border-b border-line px-4 py-3 text-right text-rose-700">{item.needToBuy}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <div className="flex justify-end gap-2 border-t border-line p-5">
              <Button type="button" variant="ghost" onClick={closeConvertPreview} disabled={Boolean(savingId)}>
                取消
              </Button>
              <Button type="button" variant="primary" onClick={() => void confirmConvertToOrder()} disabled={Boolean(savingId)} icon={<ArrowRight size={15} />}>
                {savingId ? '转单中' : '确认转订单'}
              </Button>
            </div>
          </div>
        ) : null}
      </SlideOver>

      <SlideOver open={drawerOpen} onClose={requestDrawerClose} size="workspace" ariaLabelledBy="quotation-form-title">
        <form onSubmit={submitQuotation} onChange={markFormDirty} className="flex min-h-full flex-col">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-white p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Quotation</div>
              <h2 id="quotation-form-title" className="mt-2 text-xl font-semibold tracking-tight text-ink">
                {editingQuotation ? '编辑报价' : '新建报价'}
              </h2>
            </div>
            <button
              type="button"
              aria-label="关闭"
              disabled={Boolean(savingId)}
              onClick={requestDrawerClose}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-5 p-5">
            <FormError message={formError} />

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">客户</span>
                <select
                  value={customerId}
                  onChange={(event) => onCustomerChange(event.target.value)}
                  className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                >
                  <option value="">选择客户</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={String(customer.id)}>{customer.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-ink">状态</span>
                <select
                  value={formStatus}
                  onChange={(event) => setFormStatus(event.target.value as QuotationStatus)}
                  className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                >
                  {(['草稿', '报价中'] as QuotationStatus[]).map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-ink">备注</span>
              <textarea
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
                rows={3}
                className="mt-2 w-full resize-none rounded-md border border-line px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                placeholder="报价说明、客户特殊要求等"
              />
            </label>

            <div className="rounded-panel border border-line">
              <div className="border-b border-line p-4">
                <div className="text-sm font-semibold text-ink">添加明细</div>
                <div className="mt-1 text-xs text-muted">线圈、线径、铜套类型和表面处理沿用配方；客户只调整浮球、电缆米数和组合包材。</div>
              </div>
              <div className="grid gap-3 p-4 lg:grid-cols-[1fr_96px_120px_auto] lg:items-end">
                <label className="block">
                  <span className="text-sm font-medium text-ink">配方</span>
                  <select
                    value={recipeId}
                    onChange={(event) => setRecipeId(event.target.value)}
                    className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  >
                    <option value="">选择配方</option>
                    {recipes.map((recipe) => (
                      <option key={recipe.id} value={String(recipe.id)}>
                        {recipe.name} {recipe.spec ? ` / ${recipe.spec}` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-ink">数量</span>
                  <input
                    value={itemQty}
                    onChange={(event) => setItemQty(event.target.value)}
                    type="number"
                    min="1"
                    step="1"
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-ink">利润率</span>
                  <div className="relative mt-2">
                    <input
                      value={itemMargin}
                      onChange={(event) => setItemMargin(event.target.value)}
                      type="number"
                      min="0"
                      step="1"
                      className="h-10 w-full rounded-md border border-line px-3 pr-8 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">%</span>
                  </div>
                </label>

                <Button type="button" onClick={() => void addDraftItem()} disabled={Boolean(savingId) || Boolean(calculatingItemId)} icon={<Plus size={15} />}>
                  {calculatingItemId ? '试算中' : '添加'}
                </Button>
              </div>
            </div>

            {draftItems.length > 0 ? (
              <div className="space-y-3">
                {draftItems.map((item) => (
                  <section key={item.id} className="overflow-hidden rounded-panel border border-line bg-white">
                    <div className="flex items-start justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-ink">{item.baseRecipeName || '未命名产品'}</div>
                        <div className="mt-0.5 text-xs text-muted">{item.spec || '-'}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="danger"
                        type="button"
                        onClick={() => {
                          markFormDirty();
                          setDraftItems((current) => current.filter((next) => next.id !== item.id));
                        }}
                        icon={<Trash2 size={14} />}
                      >
                        删除
                      </Button>
                    </div>

                    <div className="grid gap-x-4 gap-y-3 border-t border-line px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="block text-xs text-muted">
                        数量
                        <input
                          value={Number(item.qty || 1)}
                          onChange={(event) => updateDraftItem(item.id, { qty: Number(event.target.value) })}
                          type="number"
                          min="1"
                          className="mt-1 h-9 w-full rounded-md border border-line px-2 text-right text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                        />
                      </label>
                      <div className="text-xs text-muted">
                        单位成本
                        <div className="mt-1 flex h-9 items-center justify-end font-semibold tabular-nums text-ink">
                          {money(Number(item.unitCost) || 0)}
                        </div>
                      </div>
                      <label className="block text-xs text-muted">
                        利润率
                        <div className="relative mt-1">
                          <input
                            value={marginMultiplierToPercent(item.margin)}
                            onChange={(event) => updateDraftItem(item.id, { margin: marginPercentToMultiplier(event.target.value) })}
                            type="number"
                            min="0"
                            step="1"
                            className="h-9 w-full rounded-md border border-line px-2 pr-7 text-right text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted">%</span>
                        </div>
                      </label>
                      <label className="block text-xs text-muted">
                        出厂单价
                        <input
                          value={Number(item.unitPrice || 0)}
                          onChange={(event) => updateDraftItem(item.id, { unitPrice: Number(event.target.value) })}
                          type="number"
                          min="0"
                          step="0.01"
                          className="mt-1 h-9 w-full rounded-md border border-line px-2 text-right text-sm font-medium text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                        />
                      </label>
                    </div>

                    <div className="border-t border-line bg-slate-50 px-4 py-3">
                      <div className="text-xs font-medium text-ink">配方规格</div>
                      <div className="mt-2 grid gap-x-5 gap-y-2 text-xs text-muted sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <span className="block text-[11px] text-slate-400">线圈</span>
                          <span className="mt-0.5 block text-slate-700">{wireText(item.overrides?.coilSpec)} · {item.overrides?.coilSheets || '-'}片 · {item.overrides?.coilMaterial || '钢带'} · {item.overrides?.coilSlotType || '小眼'}</span>
                        </div>
                        <div>
                          <span className="block text-[11px] text-slate-400">浮球规格</span>
                          <span className="mt-0.5 block text-slate-700">{wireText(item.overrides?.floatWire)} · {item.overrides?.floatAccessoryType === 'xinjie' ? '新界式' : '普通铜套'}</span>
                        </div>
                        <div>
                          <span className="block text-[11px] text-slate-400">电缆规格</span>
                          <span className="mt-0.5 block text-slate-700">{wireText(item.overrides?.cableWire)} · {item.overrides?.cableAccessoryType === 'xinjie' ? '新界式' : '普通铜套'}</span>
                        </div>
                        <div>
                          <span className="block text-[11px] text-slate-400">表面处理</span>
                          <span className="mt-0.5 block text-slate-700">{surfaceTreatmentLabel(item.overrides?.surfaceTreatmentMode)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-line px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-medium text-ink">客户配置</div>
                        {calculatingItemId === item.id ? <div className="text-xs text-muted">成本重算中...</div> : null}
                      </div>
                      <div className="mt-3 grid items-end gap-x-4 gap-y-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                        <label className="block text-xs text-muted">
                          电缆长度（米）
                          <input
                            value={item.overrides?.cableLength ?? ''}
                            onChange={(event) => {
                              const nextLength = event.target.value.replace(/\D/g, '').slice(0, 2);
                              void updateDraftItemOverrides(item.id, {
                                cableLength: nextLength,
                                hasCable: Number(nextLength) > 0,
                              });
                            }}
                            type="text"
                            inputMode="numeric"
                            maxLength={2}
                            pattern="[0-9]{0,2}"
                            title="输入 0 表示不带电缆"
                            className="mt-1 h-9 w-24 rounded-md border border-line bg-white px-2 text-left text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                          />
                        </label>
                        <label className="block text-xs text-muted">
                          外包装
                          <select
                            value={(() => {
                              const packing = normalizePackingParts(item.overrides?.packingPartsJson)
                                .find((part) => inferPackingRole(part) === 'container');
                              if (!packing?.model) return '';
                              const option = containerOptions.find((candidate) => (
                                candidate.model === packing.model
                                && candidate.supplier === (packing.supplier || '')
                                && candidate.packagingMaterial === (packing.packagingMaterial || inferPackingMaterial(packing.model))
                              ));
                              return option ? packingOptionKey(option) : '';
                            })()}
                            onChange={(event) => {
                              const option = containerOptions.find((packing) => packingOptionKey(packing) === event.target.value);
                              updatePackingConfiguration(item, 'container', option);
                            }}
                            className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                          >
                            <option value="">未配置外包装</option>
                            {containerOptions.map((option) => {
                              const key = packingOptionKey(option);
                              return (
                                <option key={key} value={key}>
                                  {option.packagingMaterial} · {option.model}{option.supplier ? ` / ${option.supplier}` : ''} · {money(option.price)}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                        <div className="flex min-h-9 flex-wrap items-center gap-x-6 gap-y-2 sm:col-span-2">
                          <label className="flex items-center gap-2 text-sm text-ink">
                            <Checkbox
                              checked={Boolean(item.overrides?.hasFloat)}
                              onChange={(event) => void updateDraftItemOverrides(item.id, { hasFloat: event.target.checked })}
                            />
                            带浮球
                          </label>
                          <label className="flex items-center gap-2 text-sm text-ink">
                            <Checkbox
                              checked={normalizePackingParts(item.overrides?.packingPartsJson).some((part) => inferPackingRole(part) === 'foam')}
                              onChange={(event) => togglePackingConfiguration(item, 'foam', event.target.checked)}
                            />
                            带泡沫
                          </label>
                          <label className="flex items-center gap-2 text-sm text-ink">
                            <Checkbox
                              checked={normalizePackingParts(item.overrides?.packingPartsJson).some((part) => inferPackingRole(part) === 'pearlCotton')}
                              onChange={(event) => togglePackingConfiguration(item, 'pearlCotton', event.target.checked)}
                            />
                            带珍珠棉
                          </label>
                        </div>
                      </div>
                      <div className="mt-3 border-t border-line pt-2 text-xs leading-5 text-muted">
                        固定包材：{packingSummary(JSON.stringify(
                          normalizePackingParts(item.overrides?.packingPartsJson)
                            .filter((part) => inferPackingRole(part) === 'fixed'),
                        ))}
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            ) : null}

            <div className="grid gap-3 rounded-panel border border-line bg-slate-50 p-4 text-sm md:grid-cols-2">
              <div>
                <div className="text-xs text-muted">总成本</div>
                <div className="mt-1 font-semibold text-ink">{money(draftTotals.totalCost)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">总报价</div>
                <div className="mt-1 font-semibold text-ink">{money(draftTotals.totalPrice)}</div>
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-line bg-white p-4 sm:p-5">
            <div className="text-xs text-muted" aria-live="polite">{formDirty ? '有未保存修改' : '尚未修改'}</div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={requestDrawerClose} disabled={Boolean(savingId)}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={Boolean(savingId)} icon={<Save size={15} />}>
                {savingId === 'form' ? '保存中' : '保存'}
              </Button>
            </div>
          </div>
        </form>
      </SlideOver>

      <ConfirmDialog
        open={discardPromptOpen}
        title="放弃未保存修改？"
        description={discardMessage}
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        confirmVariant="danger"
        busy={Boolean(savingId)}
        onConfirm={confirmDiscard}
        onClose={cancelDiscard}
        layer="top"
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除报价？"
        description={deleteTarget
          ? `报价 #${deleteTarget.id} 将被永久删除。客户档案不会被删除，但该报价的明细和历史状态无法恢复。`
          : ''}
        confirmLabel="删除报价"
        confirmVariant="danger"
        busy={Boolean(savingId)}
        onConfirm={() => deleteTarget && void removeQuotation(deleteTarget)}
        onClose={() => {
          if (!savingId) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
