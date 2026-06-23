import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Paper, Typography, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Chip, MenuItem, Select, FormControl, InputLabel, Checkbox, FormControlLabel, Tooltip, InputAdornment } from '@mui/material';
import { Plus, Edit, Trash2, ArrowRight, Search } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { useAppStore } from '../utils/store';
import { createQuotation, updateQuotation, deleteQuotation, dynamicCalculateCost } from '../utils/api';
import { gradients } from '../utils/theme';
import { PartSelection, Quotation, QuotationInput, QuotationItem, Recipe, RecipePart } from '../types';

const QUOTATION_STATUSES = ['报价中', '已接受', '已拒绝', '已转订单', '已过时'];
const STATUS_OPTIONS = ['全部', ...QUOTATION_STATUSES];
const STATUS_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  报价中: 'warning',
  已接受: 'success',
  已拒绝: 'error',
  已转订单: 'info',
  已过时: 'default',
};

type PackingSnapshot = PartSelection & { snapshotPrice?: number };
const DEFAULT_PACKAGING_MATERIAL = '牛皮纸箱';

function inferPackingMaterial(model: string, material?: string) {
  if (material) return material;
  if ((model || '').includes('木箱')) return '木箱';
  if ((model || '').includes('彩')) return '彩印纸箱';
  return DEFAULT_PACKAGING_MATERIAL;
}

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
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

export default function QuotationsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationState = location.state as { openQuotationId?: number } | null;
  const consumedNavigationRef = useRef<string | null>(null);
  const { quotations, customers, recipes, parts, fetchQuotations, fetchCustomers, fetchRecipes, fetchParts, fetchOrders, showSnackbar } = useAppStore();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('全部');
  const [filterCustomerId, setFilterCustomerId] = useState<number | '全部'>('全部');
  
  // Form State
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [status, setStatus] = useState('报价中');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<QuotationItem[]>([]);

  useEffect(() => {
    fetchQuotations();
    fetchCustomers();
    fetchRecipes();
    fetchParts();
  }, [fetchQuotations, fetchCustomers, fetchRecipes, fetchParts]);

  const getRecipePartSnapshotPrice = (recipe: Recipe | undefined, model: string, supplier = '') => {
    const recipeParts = parseJsonArray<RecipePart>(recipe?.partsJson);
    const matched = recipeParts.find((p) => {
      const sameModel = p.model === model || p.name === model;
      const sameSupplier = !supplier || (p.supplier || '') === supplier;
      return sameModel && sameSupplier;
    });
    return matched?.snapshotPrice !== undefined ? Number(matched.snapshotPrice || 0) : undefined;
  };

  const normalizePackingPart = (recipe: Recipe | undefined, part: Partial<PackingSnapshot>) => {
    const legacyName = (part as Partial<PackingSnapshot> & { name?: string })?.name;
    const model = part?.model || legacyName || '';
    const supplier = part?.supplier || '';
    const snapshotPrice = part?.snapshotPrice !== undefined
      ? Number(part.snapshotPrice || 0)
      : getRecipePartSnapshotPrice(recipe, model, supplier);
    return {
      model,
      supplier,
      qty: Number(part?.qty || 1),
      packagingMaterial: inferPackingMaterial(model, part?.packagingMaterial),
      ...(snapshotPrice !== undefined ? { snapshotPrice } : {})
    };
  };

  const getPackingParts = (recipe: Recipe | undefined) => {
    const parsed = parseJsonArray<PackingSnapshot>(recipe?.packingPartsJson);
    if (parsed.length > 0) {
      return parsed.map((p) => normalizePackingPart(recipe, p)).filter((p) => p.model);
    }
    return recipe?.boxType ? [normalizePackingPart(recipe, { model: recipe.boxType, supplier: '', qty: 1 })] : [];
  };

  const getCoilSnapshot = (recipe: Recipe | undefined) => {
    const recipeParts = parseJsonArray<RecipePart>(recipe?.partsJson);
    const coil = recipeParts.find((p) => p.name === '线圈转子');
    return {
      spec: recipe?.coilSpec || coil?.model?.split('-')?.[0] || '',
      sheets: recipe?.coilSheets || coil?.model?.split('-')?.[1] || '',
      material: recipe?.coilMaterial || coil?.material || '钢带',
      unitPrice: coil?.unitPrice,
      cost: coil?.snapshotPrice,
      source: coil?.source,
      formula: coil?.formula,
    };
  };

  const getPartPrice = (model: string, supplier = '') => {
    const exact = parts.find(p => p.model === model && (p.supplier || '') === (supplier || ''));
    if (exact) return exact.price || 0;
    const candidates = parts.filter(p => p.model === model);
    if (candidates.length === 0) return 0;
    return candidates.reduce((min, p) => (p.price || 0) < (min.price || 0) ? p : min, candidates[0]).price || 0;
  };

  const packagingOptions = useMemo(() => {
    const options = new Map<string, { model: string; supplier: string; price: number }>();
    const addOption = (model: string, supplier = '', price = 0) => {
      if (!model) return;
      const key = `${model}||${supplier}`;
      if (!options.has(key) || price > 0) options.set(key, { model, supplier, price });
    };

    parts.forEach((p) => {
      const model = p.model || '';
      const category = p.category || '';
      const looksLikePacking = category === '包装' || model.includes('木箱') || model.includes('纸箱') || model.includes('包装');
      if (looksLikePacking) addOption(model, p.supplier || '', Number(p.price || 0));
    });

    recipes.forEach((recipe) => {
      getPackingParts(recipe).forEach((p) => {
        const price = p.snapshotPrice !== undefined ? Number(p.snapshotPrice || 0) : getPartPrice(p.model, p.supplier || '');
        addOption(p.model, p.supplier || '', price);
      });
    });

    return Array.from(options.values()).sort((a, b) => a.model.localeCompare(b.model));
  }, [parts, recipes]);

  const packingSummary = (item: QuotationItem) => {
    let packingParts = parseJsonArray<PackingSnapshot>(item.overrides?.packingPartsJson);
    if (packingParts.length === 0 && item.overrides?.boxType) {
      packingParts = [{ model: item.overrides.boxType, supplier: '', qty: 1 }];
    }
    const total = packingParts.reduce((sum, p) => {
      const price = p.snapshotPrice !== undefined ? Number(p.snapshotPrice || 0) : getPartPrice(p.model, p.supplier || '');
      return sum + price * (p.qty || 1);
    }, 0);
    const source = packingParts.some(p => p.snapshotPrice !== undefined) ? '快照' : '零件库';
    return {
      parts: packingParts,
      total,
      source,
      label: packingParts.length > 0
        ? packingParts.map(p => `${p.model}/${inferPackingMaterial(p.model, p.packagingMaterial)}`).join('、')
        : '无包装配置'
    };
  };

  const handleCustomerChange = (val: number) => {
    setCustomerId(val);
    const c = customers.find(x => x.Id === val);
    if (c) {
      setItems(items.map(item => ({ ...item, margin: c.defaultMargin, unitPrice: item.unitCost * (1 + c.defaultMargin), totalPrice: item.unitCost * (1 + c.defaultMargin) * item.qty })));
    }
  };

  const addItem = () => {
    const c = customers.find(x => x.Id === customerId);
    setItems([...items, { id: Date.now().toString(), baseRecipeId: '', baseRecipeName: '', qty: 1, overrides: {}, unitCost: 0, margin: c ? c.defaultMargin : 0.15, unitPrice: 0, totalPrice: 0 }]);
  };

  const updateItemOverride = async (index: number, field: keyof QuotationItem['overrides'], val: string | number | boolean) => {
    await updateItemOverrides(index, { [field]: val });
  };

  const updateItemOverrides = async (index: number, patch: Partial<QuotationItem['overrides']>) => {
    const newItems = [...items];
    newItems[index].overrides = { ...newItems[index].overrides, ...patch };
    
    // Recalculate cost
    if (newItems[index].baseRecipeId) {
      try {
        const res = await dynamicCalculateCost(newItems[index].baseRecipeId as number, newItems[index].overrides);
        newItems[index].unitCost = res.unitCost;
        newItems[index].unitPrice = res.unitCost * (1 + newItems[index].margin);
        newItems[index].totalPrice = newItems[index].unitPrice * newItems[index].qty;
      } catch (err) {}
    }
    setItems(newItems);
  };

  const handleBaseRecipeChange = async (index: number, recipeId: number) => {
    const recipe = recipes.find(r => r.Id === recipeId);
    if (!recipe) return;
    const newItems = [...items];
    newItems[index].baseRecipeId = recipe.Id;
    newItems[index].baseRecipeName = recipe.name;
    
    // 初始化配置覆盖为配方的默认值
    newItems[index].overrides = {
      hasFloat: recipe.hasFloat === 1,
      floatWire: recipe.floatWire,
      hasCable: recipe.hasCable === 1,
      cableLength: recipe.cableLength,
      cableWire: recipe.cableWire,
      cableAccessoryType: recipe.cableAccessoryType || 'standard',
      coilSpec: recipe.coilSpec || '',
      coilSheets: recipe.coilSheets || 0,
      coilMaterial: recipe.coilMaterial || '钢带',
      boxType: recipe.boxType || '',
      packingPartsJson: JSON.stringify(getPackingParts(recipe)),
      customBarrelLength: recipe.customBarrelLength || undefined
    };
    
    try {
      const res = await dynamicCalculateCost(recipe.Id, newItems[index].overrides);
      newItems[index].unitCost = res.unitCost;
      newItems[index].unitPrice = res.unitCost * (1 + newItems[index].margin);
      newItems[index].totalPrice = newItems[index].unitPrice * newItems[index].qty;
    } catch (err) {}
    setItems(newItems);
  };

  const handleMarginChange = (index: number, margin: number) => {
    const newItems = [...items];
    newItems[index].margin = margin;
    newItems[index].unitPrice = newItems[index].unitCost * (1 + margin);
    newItems[index].totalPrice = newItems[index].unitPrice * newItems[index].qty;
    setItems(newItems);
  };

  const handleUnitPriceChange = (index: number, unitPrice: number) => {
    const newItems = [...items];
    newItems[index].unitPrice = unitPrice;
    if (newItems[index].unitCost > 0) {
        newItems[index].margin = (unitPrice / newItems[index].unitCost) - 1;
    }
    newItems[index].totalPrice = unitPrice * newItems[index].qty;
    setItems(newItems);
  };

  const handleSave = async () => {
    const totalCost = items.reduce((sum, item) => sum + (item.unitCost * item.qty), 0);
    const totalPrice = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const data: QuotationInput = { customerId, status, itemsJson: JSON.stringify(items), totalCost, totalPrice, remark };
    try {
      if (editing) await updateQuotation(editing.Id, data);
      else await createQuotation(data);
      await fetchQuotations(true);
      setOpen(false);
      showSnackbar('保存成功', 'success');
    } catch (err: unknown) { showSnackbar(getErrorMessage(err, '保存失败'), 'error'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该报价单?')) return;
    try {
      await deleteQuotation(id);
      await fetchQuotations(true);
      showSnackbar('删除成功', 'info');
    } catch (err: unknown) { showSnackbar(getErrorMessage(err, '删除失败'), 'error'); }
  };

  const handleStatusChange = async (quotation: Quotation, nextStatus: string) => {
    if (quotation.status === nextStatus) return;
    try {
      await updateQuotation(quotation.Id, { status: nextStatus });
      await fetchQuotations(true);
      showSnackbar('状态已更新', 'success');
    } catch (err: unknown) {
      await fetchQuotations(true);
      showSnackbar(getErrorMessage(err, '状态更新失败'), 'error');
    }
  };

  const openQuotation = useCallback((quotation: Quotation) => {
    setEditing(quotation);
    setCustomerId(quotation.customerId);
    setStatus(quotation.status);
    setRemark(quotation.remark || '');
    setItems(parseJsonArray<QuotationItem>(quotation.itemsJson));
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!navigationState?.openQuotationId || consumedNavigationRef.current === location.key) return;
    const target = quotations.find(q => q.Id === Number(navigationState.openQuotationId));
    if (!target) return;

    openQuotation(target);
    consumedNavigationRef.current = location.key;
    navigate(location.pathname, { replace: true, state: null });
  }, [navigationState?.openQuotationId, quotations, openQuotation, location.key, location.pathname, navigate]);

  const convertToOrder = async (q: Quotation) => {
    if (!confirm('确定转化为正式订单？')) return;
    const c = customers.find(x => x.Id === q.customerId);
    
    // Map QuotationItems to OrderItems (they are slightly different but orders.cjs handles generic itemsJson)
    const orderItems = parseJsonArray<QuotationItem>(q.itemsJson).map((item) => ({
        id: item.id,
        recipeId: item.baseRecipeId || undefined,
        recipeName: item.baseRecipeName,
        qty: item.qty,
        partsJson: JSON.stringify(item.overrides), // Just store overrides as partsJson for now, or you can expand this to full parts
        unitCost: item.unitCost,
        profitMargin: item.margin,
        unitPrice: item.unitPrice
    }));

    const orderData = { 
        customerName: c ? c.name : 'Unknown', 
        contractNo: '',
        remark: `由报价单转化: ${q.remark}`, 
        status: '待采购', 
        itemsJson: JSON.stringify(orderItems)
    };
    try {
        const { saveOrder, createEmptyOrder } = await import('../utils/orderStore');
        const empty = createEmptyOrder(orderData.customerName, orderData.remark, orderData.contractNo);
        const orderToSave = { ...empty, items: orderItems };
        await saveOrder(orderToSave);
        await updateQuotation(q.Id, { status: '已转订单' });
        await fetchQuotations(true);
        await fetchOrders(true);
        showSnackbar('转订单成功', 'success');
    } catch (err: unknown) { showSnackbar(getErrorMessage(err, '转换失败'), 'error'); }
  };

  const hasStainlessBarrel = (recipeId: number | '') => {
    if (recipeId === '') return false;
    const recipe = recipes.find(r => r.Id === recipeId);
    if (!recipe) return false;
    try {
      const recipeParts = parseJsonArray<RecipePart>(recipe.partsJson);
      return recipeParts.some((p) => (p.name || '').includes('不锈钢机筒') || (p.model || '').includes('不锈钢机筒'));
    } catch { return false; }
  };

  const customerNameMap = useMemo(() => new Map(customers.map(c => [c.Id, c.name])), [customers]);

  const quotationStats = useMemo(() => {
    const quoteCount = quotations.length;
    const quotingCount = quotations.filter(q => q.status === '报价中').length;
    const acceptedOrConverted = quotations.filter(q => q.status === '已接受' || q.status === '已转订单').length;
    const totalPrice = quotations.reduce((sum, q) => sum + Number(q.totalPrice || 0), 0);
    return { quoteCount, quotingCount, acceptedOrConverted, totalPrice };
  }, [quotations]);

  const filteredQuotations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return quotations.filter(quotation => {
      const customerName = customerNameMap.get(quotation.customerId) || '';
      const itemsText = parseJsonArray<QuotationItem>(quotation.itemsJson)
        .map((item) => `${item.baseRecipeName || ''}`)
        .join(' ');
      const matchSearch = !q || [customerName, quotation.status, quotation.remark, itemsText]
        .some(value => String(value || '').toLowerCase().includes(q));
      const matchStatus = filterStatus === '全部' || quotation.status === filterStatus;
      const matchCustomer = filterCustomerId === '全部' || quotation.customerId === filterCustomerId;
      return matchSearch && matchStatus && matchCustomer;
    });
  }, [quotations, customerNameMap, searchQuery, filterStatus, filterCustomerId]);

  return (
    <Box>
      <PageHeader title="报价单" subtitle="管理销售报价并一键转为生产订单" actions={<Button variant="contained" startIcon={<Plus size={20} />} onClick={() => { setEditing(null); setCustomerId(''); setStatus('报价中'); setRemark(''); setItems([]); setOpen(true); }}>新建报价</Button>} />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mt: 3 }}>
        <StatCard label="报价总数" value={quotationStats.quoteCount} subtitle="全部报价单" gradient={gradients.orders} delay={0} />
        <StatCard label="报价中" value={quotationStats.quotingCount} subtitle="仍在跟进" gradient={gradients.pending} delay={1} />
        <StatCard label="已接受/转单" value={quotationStats.acceptedOrConverted} subtitle="成交相关报价" gradient={gradients.completed} delay={2} />
        <StatCard label="总报价金额" value={`¥${(quotationStats.totalPrice / 10000).toFixed(1)}w`} subtitle="报价单合计" gradient={gradients.revenue} delay={3} />
      </Box>
      
      <Paper elevation={0} sx={{ mt: 3, borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="搜索客户、备注、配方..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={18} color="rgba(148,163,184,0.8)" /></InputAdornment> }}
            sx={{ minWidth: 240, flex: 1 }}
          />
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>状态</InputLabel>
            <Select value={filterStatus} label="状态" onChange={event => setFilterStatus(event.target.value)}>
              {STATUS_OPTIONS.map(option => <MenuItem key={option} value={option}>{option}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>客户</InputLabel>
            <Select value={filterCustomerId} label="客户" onChange={event => setFilterCustomerId(event.target.value as number | '全部')}>
              <MenuItem value="全部">全部客户</MenuItem>
              {customers.map(c => <MenuItem key={c.Id} value={c.Id}>{c.name}</MenuItem>)}
            </Select>
          </FormControl>
          <Chip label={`当前 ${filteredQuotations.length} 张`} size="small" variant="outlined" sx={{ fontWeight: 700 }} />
        </Box>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
              <TableCell>客户</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>总成本</TableCell>
              <TableCell>总报价</TableCell>
              <TableCell>创建时间</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredQuotations.map(q => {
              const customer = customers.find(c => c.Id === q.customerId);
              return (
                <TableRow key={q.Id}>
                  <TableCell sx={{ fontWeight: 600 }}>{customer ? customer.name : `未知 ID:${q.customerId}`}</TableCell>
                  <TableCell>
                    <FormControl size="small" sx={{ minWidth: 118 }}>
                      <Select
                        value={q.status}
                        onChange={(event) => handleStatusChange(q, event.target.value)}
                        renderValue={(selected) => (
                          <Chip size="small" label={selected} color={STATUS_COLORS[selected] || 'default'} sx={{ height: 22 }} />
                        )}
                        sx={{
                          '& .MuiSelect-select': {
                            display: 'flex',
                            alignItems: 'center',
                            py: 0.5,
                          },
                        }}
                      >
                        {QUOTATION_STATUSES.map(option => <MenuItem key={option} value={option}>{option}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell>¥{q.totalCost.toFixed(2)}</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'primary.main' }}>¥{q.totalPrice.toFixed(2)}</TableCell>
                  <TableCell>{q.CreatedAt ? new Date(q.CreatedAt).toLocaleDateString() : '-'}</TableCell>
                  <TableCell align="right">
                    {q.status === '已接受' && (
                        <Tooltip title="将此报价转化为正式订单">
                            <Button size="small" startIcon={<ArrowRight size={14}/>} onClick={() => convertToOrder(q)} sx={{ mr: 1 }}>转订单</Button>
                        </Tooltip>
                    )}
                    <Tooltip title="编辑报价">
                      <IconButton size="small" aria-label="编辑报价" onClick={() => openQuotation(q)}><Edit size={16} /></IconButton>
                    </Tooltip>
                    <Tooltip title="删除报价">
                      <IconButton size="small" color="error" aria-label="删除报价" onClick={() => handleDelete(q.Id)}><Trash2 size={16} /></IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
            {quotations.length === 0 && (
                <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                      <Typography variant="body2" sx={{ mb: 1.5 }}>暂无报价单记录</Typography>
                      <Button variant="outlined" startIcon={<Plus size={16} />} onClick={() => { setEditing(null); setCustomerId(''); setStatus('报价中'); setRemark(''); setItems([]); setOpen(true); }}>
                        新建第一张报价单
                      </Button>
                    </TableCell>
                </TableRow>
            )}
            {quotations.length > 0 && filteredQuotations.length === 0 && (
                <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>没有符合筛选条件的报价单</TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {/* Quotation Dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>{editing ? '编辑报价单' : '新建报价单'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Box display="flex" gap={2} mt={1}>
            <FormControl fullWidth>
              <InputLabel>客户</InputLabel>
              <Select value={customerId} label="客户" onChange={e => handleCustomerChange(Number(e.target.value))}>
                {customers.map(c => <MenuItem key={c.Id} value={c.Id}>{c.name} (默认加价 {(c.defaultMargin*100).toFixed(0)}%)</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>状态</InputLabel>
              <Select value={status} label="状态" onChange={e => setStatus(e.target.value as string)}>
                {QUOTATION_STATUSES.map(option => <MenuItem key={option} value={option}>{option}</MenuItem>)}
              </Select>
            </FormControl>
          </Box>
          <TextField label="备注" value={remark} onChange={e => setRemark(e.target.value)} fullWidth size="small" />
          
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1, borderBottom: '1px solid #eee', pb: 1 }}>报价明细</Typography>
          {items.map((item, idx) => (
            <Paper key={item.id} variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
                <FormControl sx={{ minWidth: 250, flex: 1 }} size="small">
                  <InputLabel>基础配方</InputLabel>
                  <Select value={item.baseRecipeId} label="基础配方" onChange={e => handleBaseRecipeChange(idx, Number(e.target.value))}>
                    {recipes.map(r => <MenuItem key={r.Id} value={r.Id}>{r.name}</MenuItem>)}
                  </Select>
                </FormControl>
                
                <TextField label="数量" type="number" size="small" value={item.qty} onChange={e => { const newItems = [...items]; newItems[idx].qty = Number(e.target.value); newItems[idx].totalPrice = newItems[idx].unitPrice * newItems[idx].qty; setItems(newItems); }} sx={{ minWidth: 80, width: 80 }} />
                
                <Box sx={{ minWidth: 140, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">核算成本: ¥{item.unitCost.toFixed(2)}</Typography>
                  <Typography variant="caption" color="primary.main">最终单价: ¥{item.unitPrice.toFixed(2)}</Typography>
                </Box>
 
                <TextField label="加价率" type="number" inputProps={{ step: 0.01 }} size="small" value={item.margin} onChange={e => handleMarginChange(idx, parseFloat(e.target.value))} sx={{ minWidth: 90, width: 100 }} />
                <TextField label="改单价" type="number" size="small" value={item.unitPrice} onChange={e => handleUnitPriceChange(idx, parseFloat(e.target.value))} sx={{ minWidth: 100, width: 110 }} />
 
                <IconButton color="error" aria-label="删除报价明细" onClick={() => setItems(items.filter((_, i) => i !== idx))}><Trash2 size={16} /></IconButton>
              </Box>
              
              {item.baseRecipeId !== '' && (
                <Box display="flex" gap={2} flexWrap="wrap" bgcolor="rgba(0,0,0,0.02)" p={1} borderRadius={1} alignItems="center">
                  {(() => {
                    const recipe = recipes.find(r => r.Id === item.baseRecipeId);
                    const coil = getCoilSnapshot(recipe);
                    return coil.spec ? (
                      <Chip
                        size="small"
                        color="primary"
                        variant="outlined"
                        label={`线圈: ${coil.spec}-${coil.sheets} / ${item.overrides.coilMaterial || coil.material} / 单价 ¥${Number(coil.unitPrice || 0).toFixed(2)} / ${coil.source || '快照'} / ¥${Number(coil.cost || 0).toFixed(2)}`}
                      />
                    ) : null;
                  })()}
                  <FormControlLabel control={<Checkbox size="small" checked={!!item.overrides.hasFloat} onChange={e => updateItemOverride(idx, 'hasFloat', e.target.checked)} />} label="加浮球" />
                  <FormControlLabel control={<Checkbox size="small" checked={!!item.overrides.hasCable} onChange={e => updateItemOverride(idx, 'hasCable', e.target.checked)} />} label="加电缆" />
                  {item.overrides.hasCable && <TextField label="电缆长度(米)" size="small" type="number" value={item.overrides.cableLength || ''} onChange={e => updateItemOverride(idx, 'cableLength', Number(e.target.value))} sx={{ minWidth: 120, width: 120 }} />}
                  {item.overrides.hasCable && (
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                      <InputLabel>铜套规格</InputLabel>
                      <Select
                        value={item.overrides.cableAccessoryType || 'standard'}
                        label="铜套规格"
                        onChange={e => updateItemOverride(idx, 'cableAccessoryType', e.target.value)}
                      >
                        <MenuItem value="standard">普通铜套</MenuItem>
                        <MenuItem value="xinjie">新界式</MenuItem>
                      </Select>
                    </FormControl>
                  )}
                  {hasStainlessBarrel(item.baseRecipeId) && (
                    <TextField label="定制机筒" size="small" type="number" value={item.overrides.customBarrelLength || ''} onChange={e => updateItemOverride(idx, 'customBarrelLength', Number(e.target.value))} sx={{ minWidth: 100, width: 100 }} />
                  )}
                  
                  {(() => {
                    const summary = packingSummary(item);
                    const selectedPacking = summary.parts[0] || { model: '', supplier: '', qty: 1 };
                    const selectedPackingKey = selectedPacking.model ? `${selectedPacking.model}||${selectedPacking.supplier || ''}` : '';
                    const setPackingPart = (packing: { model: string; supplier: string; price: number } | null) => {
                      updateItemOverrides(idx, {
                        boxType: packing?.model || '',
                        packingPartsJson: packing?.model ? JSON.stringify([{
                          model: packing.model,
                          supplier: packing.supplier || '',
                          qty: 1,
                          packagingMaterial: inferPackingMaterial(packing.model),
                          snapshotPrice: Number(packing.price || 0)
                        }]) : '[]',
                      });
                    };
                    return (
                      <>
                        <FormControl size="small" sx={{ minWidth: 220 }}>
                           <InputLabel>包装</InputLabel>
                           <Select value={selectedPackingKey} label="包装" onChange={e => {
                             const key = e.target.value as string;
                             const option = packagingOptions.find(p => `${p.model}||${p.supplier || ''}` === key);
                             setPackingPart(option || null);
                           }}>
                             <MenuItem value="">&nbsp;</MenuItem>
                             {selectedPacking.model && !packagingOptions.some(p => `${p.model}||${p.supplier || ''}` === selectedPackingKey) && (
                               <MenuItem value={selectedPackingKey}>
                                 {selectedPacking.model}{selectedPacking.supplier ? ` / ${selectedPacking.supplier}` : ''} - ¥{(summary.total / (selectedPacking.qty || 1)).toFixed(2)}
                               </MenuItem>
                             )}
                             {packagingOptions.map(p => {
                               const key = `${p.model}||${p.supplier || ''}`;
                               return (
                                 <MenuItem key={key} value={key}>
                                   {p.model}{p.supplier ? ` / ${p.supplier}` : ''} - ¥{Number(p.price || 0).toFixed(2)}
                                 </MenuItem>
                               );
                             })}
                           </Select>
                         </FormControl>
                         <Chip
                           size="small"
                           color={summary.parts.length > 0 ? 'secondary' : 'default'}
                           variant="outlined"
                           label={`包装: ${summary.label} / ${summary.source} / ¥${summary.total.toFixed(2)}`}
                         />
                       </>
                     );
                  })()}
                </Box>
              )}
            </Paper>
          ))}
          <Button variant="outlined" startIcon={<Plus size={16} />} onClick={addItem} disabled={!customerId}>添加明细</Button>
          
          <Box display="flex" justifyContent="flex-end" mt={2}>
            <Typography variant="h6">总出厂价: ¥{items.reduce((sum, item) => sum + (item.unitCost * item.qty), 0).toFixed(2)} | 总报价: ¥{items.reduce((sum, item) => sum + item.totalPrice, 0).toFixed(2)}</Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleSave} variant="contained" disabled={!customerId || items.length === 0}>保存报价</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
