import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Paper, Box, Button, Stepper, Step, StepLabel, Alert, CircularProgress,
} from '@mui/material';
import { ArrowLeft as BackIcon, ArrowRight as NextIcon } from 'lucide-react';
import { Recipe, RecipePart } from '../types';
import { useAppStore } from '../utils/store';
import { calculateCost } from '../utils/api';
import {
  createEmptyOrder, createOrderItem, buildPurchaseList, buildTodos,
  saveOrder, calcOrderTotals, findHistoryPrice, getOrder, HistoryPrice,
} from '../utils/orderStore';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import PageHeader from '../components/PageHeader';
import OrderBasicInfo from '../components/order/OrderBasicInfo';
import OrderItemsManager, { DraftItem } from '../components/order/OrderItemsManager';
import OrderReviewSubmit from '../components/order/OrderReviewSubmit';

const STEPS = ['基本信息', '添加型号 & 定价', '预览采购清单', '确认提交'];

export default function OrderFormPage() {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id?: string }>();
  const isEdit = !!editId;
  const [activeStep, setActiveStep] = useState(0);

  // ── 数据加载 ──────────────────────────
  const { recipes, parts: allParts, fetchRecipes, fetchParts, showSnackbar } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      await Promise.all([fetchRecipes(), fetchParts()]);
    } catch {
      setError('加载配方/零件数据失败');
    } finally {
      setLoading(false);
    }
  }, [fetchRecipes, fetchParts]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── 编辑模式：加载已有订单数据 ───────
  const [editOrderId, setEditOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!editId || loading) return;
    (async () => {
      try {
        const order = await getOrder(editId);
        if (!order) { setError('订单不存在'); return; }
        setEditOrderId(order.id);
        setCustomerName(order.customerName);
        setContractNo(order.contractNo || '');
        setRemark(order.remark || '');
        setDraftItems(order.items.map(it => ({ ...it, history: null })));
      } catch {
        setError('加载订单失败');
      }
    })();
  }, [editId, loading]);

  // ── Step 1 状态 ──────────────────────
  const [customerName, setCustomerName] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [remark, setRemark] = useState('');

  // ── Step 2 状态 ──────────────────────
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [addQty, setAddQty] = useState(1);
  const historyCache = useRef<Map<string, HistoryPrice | null>>(new Map());

  const addRecipeToOrder = async () => {
    if (!selectedRecipe) return;
    const partsJson = selectedRecipe.partsJson;
    let unitCost = selectedRecipe.savedTotalCost || 0;
    if (!unitCost) {
      try {
        const parts: RecipePart[] = JSON.parse(partsJson);
        const result = await calculateCost(parts);
        unitCost = parseFloat(result.totalCost) || 0;
      } catch { /* ignore */ }
    }
    const recipeName = selectedRecipe.name;
    const item = createOrderItem(recipeName, partsJson, addQty, unitCost, selectedRecipe.Id, selectedRecipe.spec);
    
    let history: HistoryPrice | null;
    if (historyCache.current.has(recipeName)) {
      history = historyCache.current.get(recipeName)!;
    } else {
      history = await findHistoryPrice(recipeName);
      historyCache.current.set(recipeName, history);
    }
    setDraftItems((prev) => [...prev, { ...item, history }]);
    setSelectedRecipe(null);
    setAddQty(1);
  };

  const removeItem = (id: string) => setDraftItems((prev) => prev.filter((i) => i.id !== id));

  const updateItemQty = (id: string, qty: number) =>
    setDraftItems((prev) => prev.map((i) => (i.id === id ? { ...i, qty: Math.max(1, qty) } : i)));

  const updateItemMargin = (id: string, margin: number) =>
    setDraftItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const profitMargin = Math.max(0.01, margin);
        const unitPrice = Math.round(i.unitCost * profitMargin * 100) / 100;
        return { ...i, profitMargin, unitPrice };
      })
    );

  const updateItemPrice = (id: string, price: number) =>
    setDraftItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const unitPrice = Math.max(0, price);
        const profitMargin = i.unitCost > 0 ? Math.round((unitPrice / i.unitCost) * 100) / 100 : 1;
        return { ...i, unitPrice, profitMargin };
      })
    );

  // ── Step 3: 采购清单预览 ────
  const purchaseList = useMemo(() => buildPurchaseList(draftItems, allParts), [draftItems, allParts]);
  const todos = useMemo(() => buildTodos(purchaseList), [purchaseList]);
  const needCount = useMemo(() => purchaseList.filter((p) => p.needToBuy > 0).length, [purchaseList]);

  // ── 汇总计算 ─────────────────────────
  const orderTotals = useMemo(() => calcOrderTotals(draftItems), [draftItems]);

  // ── Step 4: 提交 ─────────────────────
  const [submitting, setSubmitting] = useState(false);

  // 表单离开保护：有客户名称或已添加配方即为有未保存内容
  const isDirty = customerName.trim() !== '' || draftItems.length > 0;
  useUnsavedChanges(isDirty && !submitting);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      let order;
      if (isEdit && editOrderId) {
        order = createEmptyOrder(customerName, remark || undefined, contractNo || undefined);
        order.id = editOrderId;
      } else {
        order = createEmptyOrder(customerName, remark || undefined, contractNo || undefined);
      }
      order.items = draftItems as any;
      order.purchaseList = purchaseList;
      order.todos = todos;
      order.totalCost = orderTotals.totalCost;
      order.totalPrice = orderTotals.totalPrice;
      order.totalProfit = orderTotals.totalProfit;
      await saveOrder(order);
      showSnackbar(isEdit ? '订单已成功更新' : '新订单已创建', 'success');
      navigate('/orders');
    } catch {
      showSnackbar('保存订单失败', 'error');
      setSubmitting(false);
    }
  };

  // ── 步骤验证 ─────────────────────────
  const canNext = () => {
    if (activeStep === 0) return customerName.trim().length > 0;
    if (activeStep === 1) return draftItems.length > 0;
    return true;
  };

  const recipeOptions = recipes.map((r) => ({
    label: `${r.name} ${r.spec ? `[${r.spec}]` : ''}`,
    recipe: r,
  }));

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', pb: 8 }}>
      <PageHeader
        title={isEdit ? '编辑订单' : '新建订单'}
        subtitle={isEdit ? '修改和管理已有订单的信息及配方列表' : '跟随向导将需求型号快速录入生产系统'}
      />

      <Paper elevation={0} sx={{ p: { xs: 3, md: 5 }, borderRadius: 3 }}>
        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {loading && <Box textAlign="center" py={3}><CircularProgress /></Box>}

        {!loading && activeStep === 0 && (
          <OrderBasicInfo 
            customerName={customerName} setCustomerName={setCustomerName}
            contractNo={contractNo} setContractNo={setContractNo}
            remark={remark} setRemark={setRemark}
          />
        )}

        {!loading && activeStep === 1 && (
          <OrderItemsManager 
            draftItems={draftItems} recipeOptions={recipeOptions}
            selectedRecipe={selectedRecipe} setSelectedRecipe={setSelectedRecipe}
            addQty={addQty} setAddQty={setAddQty} addRecipeToOrder={addRecipeToOrder}
            removeItem={removeItem} updateItemQty={updateItemQty}
            updateItemMargin={updateItemMargin} updateItemPrice={updateItemPrice}
            orderTotals={orderTotals}
          />
        )}

        {!loading && (activeStep === 2 || activeStep === 3) && (
          <OrderReviewSubmit 
            activeStep={activeStep}
            purchaseList={purchaseList} todos={todos} needCount={needCount}
            orderTotals={orderTotals} customerName={customerName}
            contractNo={contractNo} remark={remark} draftItems={draftItems} isEdit={isEdit}
          />
        )}

        {!loading && (
          <Box display="flex" justifyContent="space-between" mt={4}>
            <Button
              variant="outlined"
              startIcon={<BackIcon size={20} />}
              onClick={() => (activeStep === 0 ? navigate('/orders') : setActiveStep((s) => s - 1))}
              disabled={submitting}
            >
              {activeStep === 0 ? '放弃并返回' : '上一步'}
            </Button>

            <Button
              variant="contained"
              endIcon={activeStep < STEPS.length - 1 ? <NextIcon size={20} /> : undefined}
              onClick={() => (activeStep < STEPS.length - 1 ? setActiveStep((s) => s + 1) : handleSubmit())}
              disabled={!canNext() || submitting}
            >
              {submitting ? <CircularProgress size={24} color="inherit" /> : activeStep === STEPS.length - 1 ? '确认并保存' : '下一步'}
            </Button>
          </Box>
        )}
      </Paper>

    </Box>
  );
}
