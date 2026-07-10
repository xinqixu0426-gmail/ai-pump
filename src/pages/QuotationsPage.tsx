import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Paper, Typography, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Chip, MenuItem, Select, FormControl, InputLabel, Checkbox, FormControlLabel, Tooltip, InputAdornment } from '@mui/material';
import { Plus, Edit, Trash2, ArrowRight, Search } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { useAppStore } from '../utils/store';
import { createQuotation, updateQuotation, deleteQuotation, dynamicCalculateCost, buildOrderDraftFromQuotation } from '../utils/api';
import { gradients } from '../utils/theme';
import { Quotation, QuotationInput, QuotationItem, RecipePart } from '../types';
import { createEmptyOrder, saveOrder } from '../utils/orderStore';
import {
  inferPackingMaterial,
  partPriceByModelAndSupplier,
} from '../utils/businessRules';
import {
  applyCustomerMargin,
  applyQuotationItemCost,
  applyQuotationItemMargin,
  applyQuotationItemUnitPrice,
  buildRecipeDefaultOverrides,
  createQuotationItem,
  getCoilSnapshot,
  getPackingParts,
  packingSummary,
  parseJsonArray,
} from '../utils/quotationRules';
import { entityCreatedAt, entityId } from '../utils/entityFields';

const QUOTATION_STATUSES = ['报价中', '已接受', '已拒绝', '已转订单', '已过时'];
const STATUS_OPTIONS = ['全部', ...QUOTATION_STATUSES];
const STATUS_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  报价中: 'warning',
  已接受: 'success',
  已拒绝: 'error',
  已转订单: 'info',
  已过时: 'default',
};

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
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

  const getPartPrice = (model: string, supplier = '') => {
    return partPriceByModelAndSupplier(parts, model, supplier);
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

  const handleCustomerChange = (val: number) => {
    setCustomerId(val);
    const c = customers.find(x => entityId(x) === val);
    if (c) {
      setItems(applyCustomerMargin(items, c));
    }
  };

  const addItem = () => {
    const c = customers.find(x => entityId(x) === customerId);
    setItems([...items, createQuotationItem(c)]);
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
        newItems[index] = applyQuotationItemCost(newItems[index], res.unitCost);
      } catch (err) {}
    }
    setItems(newItems);
  };

  const handleBaseRecipeChange = async (index: number, recipeId: number) => {
    const recipe = recipes.find(r => entityId(r) === recipeId);
    if (!recipe) return;
    const newItems = [...items];
    newItems[index].baseRecipeId = entityId(recipe);
    newItems[index].baseRecipeName = recipe.name;
    
    // 初始化配置覆盖为配方的默认值
    newItems[index].overrides = buildRecipeDefaultOverrides(recipe);
    
    try {
      const res = await dynamicCalculateCost(entityId(recipe), newItems[index].overrides);
      newItems[index] = applyQuotationItemCost(newItems[index], res.unitCost);
    } catch (err) {}
    setItems(newItems);
  };

  const handleMarginChange = (index: number, margin: number) => {
    const newItems = [...items];
    newItems[index] = applyQuotationItemMargin(newItems[index], margin);
    setItems(newItems);
  };

  const handleUnitPriceChange = (index: number, unitPrice: number) => {
    const newItems = [...items];
    newItems[index] = applyQuotationItemUnitPrice(newItems[index], unitPrice);
    setItems(newItems);
  };

  const handleSave = async () => {
    const data: QuotationInput = { customerId, status, items, remark };
    try {
      if (editing) await updateQuotation(entityId(editing), data);
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
      await updateQuotation(entityId(quotation), { status: nextStatus });
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
    const target = quotations.find(q => entityId(q) === Number(navigationState.openQuotationId));
    if (!target) return;

    openQuotation(target);
    consumedNavigationRef.current = location.key;
    navigate(location.pathname, { replace: true, state: null });
  }, [navigationState?.openQuotationId, quotations, openQuotation, location.key, location.pathname, navigate]);

  const convertToOrder = async (q: Quotation) => {
    if (!confirm('确定转化为正式订单？')) return;
    try {
        const draft = await buildOrderDraftFromQuotation(entityId(q));
        const orderToSave = {
          ...createEmptyOrder(draft.customerName, draft.remark, draft.contractNo),
          items: draft.items,
          purchaseList: draft.purchaseList,
          todos: draft.todos,
        };
        await saveOrder(orderToSave);
        await updateQuotation(entityId(q), { status: '已转订单' });
        await fetchQuotations(true);
        await fetchOrders(true);
        showSnackbar('转订单成功', 'success');
    } catch (err: unknown) { showSnackbar(getErrorMessage(err, '转换失败'), 'error'); }
  };

  const hasStainlessBarrel = (recipeId: number | '') => {
    if (recipeId === '') return false;
    const recipe = recipes.find(r => entityId(r) === recipeId);
    if (!recipe) return false;
    try {
      const recipeParts = parseJsonArray<RecipePart>(recipe.partsJson);
      return recipeParts.some((p) => (p.name || '').includes('不锈钢机筒') || (p.model || '').includes('不锈钢机筒'));
    } catch { return false; }
  };

  const customerNameMap = useMemo(() => new Map(customers.map(c => [entityId(c), c.name])), [customers]);

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
              {customers.map(c => <MenuItem key={entityId(c)} value={entityId(c)}>{c.name}</MenuItem>)}
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
              const customer = customers.find(c => entityId(c) === q.customerId);
              return (
                <TableRow key={entityId(q)}>
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
                  <TableCell>{entityCreatedAt(q) ? new Date(entityCreatedAt(q) as string).toLocaleDateString() : '-'}</TableCell>
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
                      <IconButton size="small" color="error" aria-label="删除报价" onClick={() => handleDelete(entityId(q))}><Trash2 size={16} /></IconButton>
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
                {customers.map(c => <MenuItem key={entityId(c)} value={entityId(c)}>{c.name} (默认加价 {(c.defaultMargin*100).toFixed(0)}%)</MenuItem>)}
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
                    {recipes.map(r => <MenuItem key={entityId(r)} value={entityId(r)}>{r.name}</MenuItem>)}
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
                    const recipe = recipes.find(r => entityId(r) === item.baseRecipeId);
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
                    const summary = packingSummary(item, parts);
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
