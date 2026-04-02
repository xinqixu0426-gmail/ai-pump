import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Paper,
  Typography,
  Box,
  Button,
  TextField,
  Stepper,
  Step,
  StepLabel,
  Autocomplete,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Alert,
  CircularProgress,
  Divider,
  InputAdornment,
  Tooltip,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  ArrowForward as NextIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Search as SearchIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import { Recipe, RecipePart } from '../types';
import { useAppStore } from '../utils/store';
import { buildPartsIndex, calculateRecipeCost } from '../utils/costCalculator';
import {
  createEmptyOrder,
  createOrderItem,
  buildPurchaseList,
  buildTodos,
  saveOrder,
  calcOrderTotals,
  findHistoryPrice,
  getOrder,
  HistoryPrice,
} from '../utils/orderStore';
import { formatMoney as fmt } from '../utils/format';

const STEPS = ['基本信息', '添加型号 & 定价', '预览采购清单', '确认提交'];

interface DraftItem {
  id: string;
  recipeId?: number;
  recipeName: string;
  spec?: string;
  qty: number;
  partsJson: string;
  unitCost: number;
  profitMargin: number;
  unitPrice: number;
  history?: HistoryPrice | null;
}

export default function OrderFormPage() {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id?: string }>();
  const isEdit = !!editId;
  const [activeStep, setActiveStep] = useState(0);

  // ── 数据加载 ──────────────────────────
  const { recipes, parts: allParts, fetchRecipes, fetchParts } = useAppStore();
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
    const partsJson = selectedRecipe.parts_json;
    // 尝试从配方快照读取成本，如果为0则实时计算
    let unitCost = selectedRecipe.saved_total_cost || 0;
    if (!unitCost) {
      try {
        const parts: RecipePart[] = JSON.parse(partsJson);
        const { partsCache, partsByModel } = buildPartsIndex(allParts);
        const result = calculateRecipeCost(parts, partsCache, partsByModel);
        unitCost = parseFloat(result.totalCost) || 0;
      } catch { /* ignore */ }
    }
    const recipeName = selectedRecipe.name;
    const item = createOrderItem(
      recipeName,
      partsJson,
      addQty,
      unitCost,
      selectedRecipe.Id,
      selectedRecipe.spec
    );
    // 查历史价格（缓存）
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
        const profitMargin = Math.max(0.01, margin); // 允许低于成本卖
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

  // ── Step 3: 采购清单预览（仅在 step 2+ 时计算）────
  const purchaseList = useMemo(() => buildPurchaseList(draftItems, allParts), [draftItems, allParts]);
  const todos = useMemo(() => buildTodos(purchaseList), [purchaseList]);
  const needCount = useMemo(() => purchaseList.filter((p) => p.needToBuy > 0).length, [purchaseList]);

  // ── 汇总计算 ─────────────────────────
  const orderTotals = useMemo(() => calcOrderTotals(draftItems), [draftItems]);

  // ── Step 4: 提交 ─────────────────────
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      let order;
      if (isEdit && editOrderId) {
        // 编辑模式：复用原 order id 触发 PATCH
        order = createEmptyOrder(customerName, remark || undefined, contractNo || undefined);
        order.id = editOrderId;
      } else {
        order = createEmptyOrder(customerName, remark || undefined, contractNo || undefined);
      }
      order.items = draftItems;
      order.purchaseList = purchaseList;
      order.todos = todos;
      order.totalCost = orderTotals.totalCost;
      order.totalPrice = orderTotals.totalPrice;
      order.totalProfit = orderTotals.totalProfit;
      await saveOrder(order);
      navigate('/orders');
    } catch {
      setError('保存订单失败');
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
    <Paper elevation={2} sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
      {/* 标题 */}
      <Box display="flex" alignItems="center" mb={3} gap={1}>
        <IconButton onClick={() => navigate('/orders')} size="small">
          <BackIcon />
        </IconButton>
        <Typography variant="h6">{isEdit ? '编辑订单' : '新建订单'}</Typography>
      </Box>

      {/* 步骤条 */}
      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {loading && <Box textAlign="center" py={3}><CircularProgress /></Box>}

      {/* ── Step 0: 基本信息 ── */}
      {!loading && activeStep === 0 && (
        <Box sx={{ maxWidth: 480 }}>
          <TextField
            label="客户名称"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            fullWidth
            required
            sx={{ mb: 2 }}
            placeholder="如：张工、华东水务公司"
          />
          <TextField
            label="合同号"
            value={contractNo}
            onChange={(e) => setContractNo(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
            placeholder="如：HT-2026-001"
          />
          <TextField
            label="备注（可选）"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            fullWidth
            multiline
            rows={2}
            placeholder="交货日期、特殊要求等"
          />
        </Box>
      )}

      {/* ── Step 1: 添加型号 & 定价 ── */}
      {!loading && activeStep === 1 && (
        <Box>
          {/* 添加配方区 */}
          <Box
            sx={{
              p: 2,
              mb: 3,
              border: '1px dashed',
              borderColor: 'primary.light',
              borderRadius: 2,
              backgroundColor: 'primary.50',
            }}
          >
            <Typography variant="subtitle2" mb={1.5} color="primary">
              从已有配方中选择
            </Typography>
            <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
              <Autocomplete
                options={recipeOptions}
                value={recipeOptions.find((o) => o.recipe.Id === selectedRecipe?.Id) ?? null}
                onChange={(_, v) => setSelectedRecipe(v?.recipe ?? null)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="搜索配方"
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: (
                        <>
                          <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                          {params.InputProps.startAdornment}
                        </>
                      ),
                    }}
                  />
                )}
                sx={{ width: 320 }}
                noOptionsText="无匹配配方"
              />
              <TextField
                size="small"
                label="生产数量"
                type="number"
                value={addQty}
                onChange={(e) => setAddQty(Math.max(1, Number(e.target.value)))}
                inputProps={{ min: 1 }}
                sx={{ width: 120 }}
                InputProps={{ endAdornment: <InputAdornment position="end">台</InputAdornment> }}
              />
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={addRecipeToOrder}
                disabled={!selectedRecipe}
              >
                加入订单
              </Button>
            </Box>
          </Box>

          {/* 型号列表 */}
          {draftItems.length === 0 ? (
            <Box textAlign="center" py={3} color="text.secondary">
              请先添加型号
            </Box>
          ) : (
            <>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ backgroundColor: 'grey.100' }}>
                      <TableCell>型号/配方</TableCell>
                      <TableCell>规格</TableCell>
                      <TableCell align="center">数量</TableCell>
                      <TableCell align="right">单台成本</TableCell>
                      <TableCell align="center">利润率 %</TableCell>
                      <TableCell align="right">出厂价</TableCell>
                      <TableCell align="right">小计</TableCell>
                      <TableCell align="center" sx={{ width: 80 }}>历史</TableCell>
                      <TableCell align="center" sx={{ width: 50 }}>操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {draftItems.map((item) => {
                      const subtotal = item.unitPrice * item.qty;
                      const marginPct = Math.round((item.profitMargin - 1) * 100);
                      return (
                        <TableRow key={item.id} hover>
                          <TableCell sx={{ fontWeight: 600, maxWidth: 160 }}>
                            {item.recipeName}
                          </TableCell>
                          <TableCell>{item.spec || '-'}</TableCell>
                          <TableCell align="center">
                            <TextField
                              size="small"
                              type="number"
                              value={item.qty}
                              onChange={(e) => updateItemQty(item.id, Number(e.target.value))}
                              inputProps={{ min: 1, style: { textAlign: 'center', width: 50 } }}
                              InputProps={{ endAdornment: <InputAdornment position="end">台</InputAdornment> }}
                            />
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                            ¥{fmt(item.unitCost)}
                          </TableCell>
                          <TableCell align="center">
                            <TextField
                              size="small"
                              type="number"
                              value={marginPct}
                              onChange={(e) => updateItemMargin(item.id, 1 + Number(e.target.value) / 100)}
                              inputProps={{ min: 0, step: 1, style: { textAlign: 'center', width: 50 } }}
                              InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <TextField
                              size="small"
                              type="number"
                              value={item.unitPrice}
                              onChange={(e) => updateItemPrice(item.id, Number(e.target.value))}
                              inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right', width: 80 } }}
                              InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
                            />
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                            ¥{fmt(subtotal)}
                          </TableCell>
                          <TableCell align="center">
                            {item.history ? (
                              <Tooltip
                                title={
                                  `上次出厂价 ¥${fmt(item.history.unitPrice)}（${item.history.customerName}，${new Date(item.history.date).toLocaleDateString('zh-CN')}）`
                                }
                              >
                                <Chip
                                  icon={<HistoryIcon />}
                                  label={`¥${fmt(item.history.unitPrice)}`}
                                  size="small"
                                  color={item.unitPrice > item.history.unitPrice ? 'error' : item.unitPrice < item.history.unitPrice ? 'success' : 'default'}
                                  variant="outlined"
                                  sx={{ fontSize: '0.75rem' }}
                                />
                              </Tooltip>
                            ) : (
                              <Typography variant="caption" color="text.disabled">无</Typography>
                            )}
                          </TableCell>
                          <TableCell align="center">
                            <Tooltip title="移除">
                              <IconButton size="small" color="error" onClick={() => removeItem(item.id)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* 汇总栏 */}
              <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 2, display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Typography variant="body2">
                  总成本: <b>¥{fmt(orderTotals.totalCost)}</b>
                </Typography>
                <Typography variant="body2">
                  总出厂价: <b style={{ color: '#1976d2' }}>¥{fmt(orderTotals.totalPrice)}</b>
                </Typography>
                <Typography variant="body2">
                  总利润: <b style={{ color: orderTotals.totalProfit >= 0 ? '#2e7d32' : '#d32f2f' }}>
                    ¥{fmt(orderTotals.totalProfit)}
                  </b>
                  {orderTotals.totalCost > 0 && (
                    <span style={{ marginLeft: 4, color: '#888' }}>
                      ({Math.round(orderTotals.totalProfit / orderTotals.totalCost * 100)}%)
                    </span>
                  )}
                </Typography>
              </Box>
            </>
          )}
        </Box>
      )}

      {/* ── Step 2: 预览采购清单 ── */}
      {!loading && activeStep === 2 && (
        <Box>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <Typography variant="subtitle1" fontWeight={700}>采购汇总清单</Typography>
            {needCount > 0 ? (
              <Chip
                icon={<WarningIcon />}
                label={`${needCount} 种零件需采购`}
                color="warning"
                size="small"
              />
            ) : (
              <Chip icon={<CheckIcon />} label="库存全部充足" color="success" size="small" />
            )}
          </Box>

          <TableContainer sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: 'grey.100' }}>
                  <TableCell>型号</TableCell>
                  <TableCell>名称</TableCell>
                  <TableCell>供应商</TableCell>
                  <TableCell align="right">需要总量</TableCell>
                  <TableCell align="right">当前库存</TableCell>
                  <TableCell align="right">需采购</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {purchaseList.map((p) => (
                  <TableRow
                    key={`${p.model}|${p.supplier}`}
                    sx={{
                      backgroundColor: p.needToBuy > 0
                        ? 'rgba(239,68,68,0.05)'
                        : 'rgba(34,197,94,0.03)',
                    }}
                  >
                    <TableCell>{p.model}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.supplier}</TableCell>
                    <TableCell align="right">{p.totalQty}</TableCell>
                    <TableCell align="right">{p.currentStock}</TableCell>
                    <TableCell align="right">
                      {p.needToBuy > 0 ? (
                        <Typography variant="body2" color="error.main" fontWeight={700}>
                          {p.needToBuy}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="success.main">✓</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {todos.length > 0 && (
            <>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle2" mb={1.5} color="warning.dark">
                📋 采购 To-Do（保存后可逐条打勾）
              </Typography>
              {todos.map((todo) => (
                <Box
                  key={todo.id}
                  sx={{
                    p: 1.5,
                    mb: 1,
                    borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: 'warning.light',
                    backgroundColor: 'rgba(251,191,36,0.06)',
                  }}
                >
                  <Typography variant="body2" fontWeight={500}>
                    ☐ {todo.description}
                  </Typography>
                </Box>
              ))}
            </>
          )}
        </Box>
      )}

      {/* ── Step 3: 确认提交 ── */}
      {!loading && activeStep === 3 && (
        <Box sx={{ maxWidth: 560 }}>
          <Alert severity="info" sx={{ mb: 2 }}>
            {isEdit ? '请确认修改后的订单信息。' : '请确认订单信息，提交后保存到数据库。'}
          </Alert>
          <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Typography variant="body2" mb={1}><b>客户：</b>{customerName}</Typography>
            {contractNo && <Typography variant="body2" mb={1}><b>合同号：</b>{contractNo}</Typography>}
            {remark && <Typography variant="body2" mb={1}><b>备注：</b>{remark}</Typography>}
            <Typography variant="body2" mb={1}><b>型号数：</b>{draftItems.length} 个</Typography>
            <Typography variant="body2" component="div" mb={1} display="flex" alignItems="center">
              <b>需采购零件：</b>
              {needCount > 0 ? (
                <Chip label={`${needCount} 种`} size="small" color="warning" sx={{ ml: 0.5 }} />
              ) : (
                <Chip label="库存充足" size="small" color="success" sx={{ ml: 0.5 }} />
              )}
            </Typography>
            <Divider sx={{ my: 1.5 }} />
            <Box display="flex" gap={3} flexWrap="wrap">
              <Typography variant="body2">
                <b>总成本：</b>¥{fmt(orderTotals.totalCost)}
              </Typography>
              <Typography variant="body2" color="primary.main">
                <b>总出厂价：</b>¥{fmt(orderTotals.totalPrice)}
              </Typography>
              <Typography variant="body2" color={orderTotals.totalProfit >= 0 ? 'success.main' : 'error.main'}>
                <b>总利润：</b>¥{fmt(orderTotals.totalProfit)}
                {orderTotals.totalCost > 0 && ` (${Math.round(orderTotals.totalProfit / orderTotals.totalCost * 100)}%)`}
              </Typography>
            </Box>
          </Box>
        </Box>
      )}

      {/* ── 导航按钮 ── */}
      {!loading && (
        <Box display="flex" justifyContent="space-between" mt={4}>
          <Button
            variant="outlined"
            startIcon={<BackIcon />}
            onClick={() => setActiveStep((s) => s - 1)}
            disabled={activeStep === 0}
          >
            上一步
          </Button>
          {activeStep < STEPS.length - 1 ? (
            <Button
              variant="contained"
              endIcon={<NextIcon />}
              onClick={() => setActiveStep((s) => s + 1)}
              disabled={!canNext()}
            >
              下一步
            </Button>
          ) : (
            <Button
              variant="contained"
              color="success"
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <CheckIcon />}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {isEdit ? '保存修改' : '提交订单'}
            </Button>
          )}
        </Box>
      )}
    </Paper>
  );
}
