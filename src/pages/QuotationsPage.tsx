import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Paper, Typography, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Chip, MenuItem, Select, FormControl, InputLabel, Checkbox, FormControlLabel, Tooltip } from '@mui/material';
import { Plus, Edit, Trash2, ArrowRight } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAppStore } from '../utils/store';
import { createQuotation, updateQuotation, deleteQuotation, dynamicCalculateCost } from '../utils/api';

export default function QuotationsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationState = location.state as { openQuotationId?: number } | null;
  const consumedNavigationRef = useRef<string | null>(null);
  const { quotations, customers, recipes, parts, fetchQuotations, fetchCustomers, fetchRecipes, fetchParts, fetchOrders, showSnackbar } = useAppStore();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  
  // Form State
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [status, setStatus] = useState('报价中');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    fetchQuotations();
    fetchCustomers();
    fetchRecipes();
    fetchParts();
  }, [fetchQuotations, fetchCustomers, fetchRecipes, fetchParts]);

  const parseJsonArray = (value: any) => {
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const getRecipePartSnapshotPrice = (recipe: any, model: string, supplier = '') => {
    const recipeParts = parseJsonArray(recipe?.parts_json);
    const matched = recipeParts.find((p: any) => {
      const sameModel = p.model === model || p.name === model;
      const sameSupplier = !supplier || (p.supplier || '') === supplier;
      return sameModel && sameSupplier;
    });
    return matched?.snapshotPrice !== undefined ? Number(matched.snapshotPrice || 0) : undefined;
  };

  const normalizePackingPart = (recipe: any, part: any) => {
    const model = part?.model || part?.name || '';
    const supplier = part?.supplier || '';
    const snapshotPrice = part?.snapshotPrice !== undefined
      ? Number(part.snapshotPrice || 0)
      : getRecipePartSnapshotPrice(recipe, model, supplier);
    return {
      model,
      supplier,
      qty: Number(part?.qty || 1),
      ...(snapshotPrice !== undefined ? { snapshotPrice } : {})
    };
  };

  const getPackingParts = (recipe: any) => {
    try {
      const parsed = JSON.parse(recipe?.packing_parts_json || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p: any) => normalizePackingPart(recipe, p)).filter((p: any) => p.model);
      }
    } catch { /* ignore */ }
    return recipe?.box_type ? [normalizePackingPart(recipe, { model: recipe.box_type, supplier: '', qty: 1 })] : [];
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

    parts.forEach((p: any) => {
      const model = p.model || '';
      const category = p.category || '';
      const looksLikePacking = category === '包装' || model.includes('木箱') || model.includes('纸箱') || model.includes('包装');
      if (looksLikePacking) addOption(model, p.supplier || '', Number(p.price || 0));
    });

    recipes.forEach((recipe: any) => {
      getPackingParts(recipe).forEach((p: any) => {
        const price = p.snapshotPrice !== undefined ? Number(p.snapshotPrice || 0) : getPartPrice(p.model, p.supplier || '');
        addOption(p.model, p.supplier || '', price);
      });
    });

    return Array.from(options.values()).sort((a, b) => a.model.localeCompare(b.model));
  }, [parts, recipes]);

  const packingSummary = (item: any) => {
    let packingParts: Array<{ model: string; supplier?: string; qty?: number; snapshotPrice?: number }> = [];
    try { packingParts = JSON.parse(item.overrides?.packing_parts_json || '[]'); } catch { packingParts = []; }
    if (packingParts.length === 0 && item.overrides?.box_type) {
      packingParts = [{ model: item.overrides.box_type, supplier: '', qty: 1 }];
    }
    const total = packingParts.reduce((sum, p) => {
      const price = p.snapshotPrice !== undefined ? Number(p.snapshotPrice || 0) : getPartPrice(p.model, p.supplier || '');
      return sum + price * (p.qty || 1);
    }, 0);
    return {
      parts: packingParts,
      total,
      label: packingParts.length > 0
        ? packingParts.map(p => `${p.model}×${p.qty || 1}`).join('、')
        : '无包装配置'
    };
  };

  const handleCustomerChange = (val: number) => {
    setCustomerId(val);
    const c = customers.find(x => x.Id === val);
    if (c) {
      setItems(items.map(item => ({ ...item, margin: c.defaultMargin, unit_price: item.unit_cost * (1 + c.defaultMargin), total_price: item.unit_cost * (1 + c.defaultMargin) * item.qty })));
    }
  };

  const addItem = () => {
    const c = customers.find(x => x.Id === customerId);
    setItems([...items, { id: Date.now().toString(), base_recipe_id: '', base_recipe_name: '', qty: 1, overrides: {}, unit_cost: 0, margin: c ? c.defaultMargin : 0.15, unit_price: 0, total_price: 0 }]);
  };

  const updateItemOverride = async (index: number, field: string, val: any) => {
    await updateItemOverrides(index, { [field]: val });
  };

  const updateItemOverrides = async (index: number, patch: Record<string, any>) => {
    const newItems = [...items];
    newItems[index].overrides = { ...newItems[index].overrides, ...patch };
    
    // Recalculate cost
    if (newItems[index].base_recipe_id) {
      try {
        const res = await dynamicCalculateCost(newItems[index].base_recipe_id, newItems[index].overrides);
        newItems[index].unit_cost = res.unitCost;
        newItems[index].unit_price = res.unitCost * (1 + newItems[index].margin);
        newItems[index].total_price = newItems[index].unit_price * newItems[index].qty;
      } catch (err) {}
    }
    setItems(newItems);
  };

  const handleBaseRecipeChange = async (index: number, recipeId: number) => {
    const recipe = recipes.find(r => r.Id === recipeId);
    if (!recipe) return;
    const newItems = [...items];
    newItems[index].base_recipe_id = recipe.Id;
    newItems[index].base_recipe_name = recipe.name;
    
    // 初始化配置覆盖为配方的默认值
    newItems[index].overrides = {
      has_float: recipe.has_float === 1,
      float_wire: recipe.float_wire,
      has_cable: recipe.has_cable === 1,
      cable_length: recipe.cable_length,
      cable_wire: recipe.cable_wire,
      box_type: recipe.box_type || '',
      packing_parts_json: JSON.stringify(getPackingParts(recipe)),
      custom_barrel_length: recipe.custom_barrel_length || undefined
    };
    
    try {
      const res = await dynamicCalculateCost(recipe.Id, newItems[index].overrides);
      newItems[index].unit_cost = res.unitCost;
      newItems[index].unit_price = res.unitCost * (1 + newItems[index].margin);
      newItems[index].total_price = newItems[index].unit_price * newItems[index].qty;
    } catch (err) {}
    setItems(newItems);
  };

  const handleMarginChange = (index: number, margin: number) => {
    const newItems = [...items];
    newItems[index].margin = margin;
    newItems[index].unit_price = newItems[index].unit_cost * (1 + margin);
    newItems[index].total_price = newItems[index].unit_price * newItems[index].qty;
    setItems(newItems);
  };

  const handleUnitPriceChange = (index: number, unitPrice: number) => {
    const newItems = [...items];
    newItems[index].unit_price = unitPrice;
    if (newItems[index].unit_cost > 0) {
        newItems[index].margin = (unitPrice / newItems[index].unit_cost) - 1;
    }
    newItems[index].total_price = unitPrice * newItems[index].qty;
    setItems(newItems);
  };

  const handleSave = async () => {
    const totalCost = items.reduce((sum, item) => sum + (item.unit_cost * item.qty), 0);
    const totalPrice = items.reduce((sum, item) => sum + item.total_price, 0);
    const data = { customerId, status, itemsJson: JSON.stringify(items), totalCost, totalPrice, remark };
    try {
      if (editing) await updateQuotation(editing.Id, data);
      else await createQuotation(data);
      await fetchQuotations(true);
      setOpen(false);
      showSnackbar('保存成功', 'success');
    } catch (err: any) { showSnackbar(err.message || '保存失败', 'error'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该报价单?')) return;
    try {
      await deleteQuotation(id);
      await fetchQuotations(true);
      showSnackbar('删除成功', 'info');
    } catch (err: any) { showSnackbar(err.message || '删除失败', 'error'); }
  };

  const openQuotation = useCallback((quotation: any) => {
    setEditing(quotation);
    setCustomerId(quotation.customerId);
    setStatus(quotation.status);
    setRemark(quotation.remark || '');
    setItems(parseJsonArray(quotation.itemsJson));
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

  const convertToOrder = async (q: any) => {
    if (!confirm('确定转化为正式订单？')) return;
    const c = customers.find(x => x.Id === q.customerId);
    
    // Map QuotationItems to OrderItems (they are slightly different but orders.cjs handles generic itemsJson)
    const orderItems = JSON.parse(q.itemsJson || '[]').map((item: any) => ({
        id: item.id,
        recipeId: item.base_recipe_id || undefined,
        recipeName: item.base_recipe_name,
        qty: item.qty,
        partsJson: JSON.stringify(item.overrides), // Just store overrides as partsJson for now, or you can expand this to full parts
        unitCost: item.unit_cost,
        profitMargin: item.margin,
        unitPrice: item.unit_price
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
    } catch (err: any) { showSnackbar(err.message || '转换失败', 'error'); }
  };

  const hasStainlessBarrel = (recipeId: number | '') => {
    if (recipeId === '') return false;
    const recipe = recipes.find(r => r.Id === recipeId);
    if (!recipe) return false;
    try {
      const parts = JSON.parse(recipe.parts_json || '[]');
      return parts.some((p: any) => (p.name || '').includes('不锈钢机筒') || (p.model || '').includes('不锈钢机筒'));
    } catch (e) { return false; }
  };

  return (
    <Box>
      <PageHeader title="报价单" subtitle="管理销售报价并一键转为生产订单" actions={<Button variant="contained" startIcon={<Plus size={20} />} onClick={() => { setEditing(null); setCustomerId(''); setStatus('报价中'); setRemark(''); setItems([]); setOpen(true); }}>新建报价</Button>} />
      
      <Paper elevation={0} sx={{ mt: 3, borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
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
            {quotations.map(q => {
              const customer = customers.find(c => c.Id === q.customerId);
              return (
                <TableRow key={q.Id}>
                  <TableCell sx={{ fontWeight: 600 }}>{customer ? customer.name : `未知 ID:${q.customerId}`}</TableCell>
                  <TableCell><Chip size="small" label={q.status} color={q.status === '已接受' ? 'success' : q.status === '已转订单' ? 'info' : 'default'} /></TableCell>
                  <TableCell>¥{q.totalCost.toFixed(2)}</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'primary.main' }}>¥{q.totalPrice.toFixed(2)}</TableCell>
                  <TableCell>{new Date(q.CreatedAt).toLocaleDateString()}</TableCell>
                  <TableCell align="right">
                    {q.status === '已接受' && (
                        <Tooltip title="将此报价转化为正式订单">
                            <Button size="small" startIcon={<ArrowRight size={14}/>} onClick={() => convertToOrder(q)} sx={{ mr: 1 }}>转订单</Button>
                        </Tooltip>
                    )}
                    <IconButton size="small" onClick={() => openQuotation(q)}><Edit size={16} /></IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(q.Id)}><Trash2 size={16} /></IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
            {quotations.length === 0 && (
                <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>暂无报价单记录</TableCell>
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
                <MenuItem value="报价中">报价中</MenuItem>
                <MenuItem value="已接受">已接受</MenuItem>
                <MenuItem value="已拒绝">已拒绝</MenuItem>
                <MenuItem value="已转订单">已转订单</MenuItem>
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
                  <Select value={item.base_recipe_id} label="基础配方" onChange={e => handleBaseRecipeChange(idx, Number(e.target.value))}>
                    {recipes.map(r => <MenuItem key={r.Id} value={r.Id}>{r.name}</MenuItem>)}
                  </Select>
                </FormControl>
                
                <TextField label="数量" type="number" size="small" value={item.qty} onChange={e => { const newItems = [...items]; newItems[idx].qty = Number(e.target.value); newItems[idx].total_price = newItems[idx].unit_price * newItems[idx].qty; setItems(newItems); }} sx={{ minWidth: 80, width: 80 }} />
                
                <Box sx={{ minWidth: 140, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">核算成本: ¥{item.unit_cost.toFixed(2)}</Typography>
                  <Typography variant="caption" color="primary.main">最终单价: ¥{item.unit_price.toFixed(2)}</Typography>
                </Box>

                <TextField label="加价率" type="number" inputProps={{ step: 0.01 }} size="small" value={item.margin} onChange={e => handleMarginChange(idx, parseFloat(e.target.value))} sx={{ minWidth: 90, width: 100 }} />
                <TextField label="改单价" type="number" size="small" value={item.unit_price} onChange={e => handleUnitPriceChange(idx, parseFloat(e.target.value))} sx={{ minWidth: 100, width: 110 }} />

                <IconButton color="error" onClick={() => setItems(items.filter((_, i) => i !== idx))}><Trash2 size={16} /></IconButton>
              </Box>
              
              {item.base_recipe_id !== '' && (
                <Box display="flex" gap={2} flexWrap="wrap" bgcolor="rgba(0,0,0,0.02)" p={1} borderRadius={1} alignItems="center">
                  <FormControlLabel control={<Checkbox size="small" checked={!!item.overrides.has_float} onChange={e => updateItemOverride(idx, 'has_float', e.target.checked)} />} label="加浮球" />
                  <FormControlLabel control={<Checkbox size="small" checked={!!item.overrides.has_cable} onChange={e => updateItemOverride(idx, 'has_cable', e.target.checked)} />} label="加电缆" />
                  {item.overrides.has_cable && <TextField label="电缆长度(米)" size="small" type="number" value={item.overrides.cable_length || ''} onChange={e => updateItemOverride(idx, 'cable_length', Number(e.target.value))} sx={{ minWidth: 120, width: 120 }} />}
                  {hasStainlessBarrel(item.base_recipe_id) && (
                    <TextField label="定制机筒" size="small" type="number" value={item.overrides.custom_barrel_length || ''} onChange={e => updateItemOverride(idx, 'custom_barrel_length', Number(e.target.value))} sx={{ minWidth: 100, width: 100 }} />
                  )}
                  
                  {(() => {
                    const summary = packingSummary(item);
                    const selectedPacking = summary.parts[0] || { model: '', supplier: '', qty: 1 };
                    const selectedPackingKey = selectedPacking.model ? `${selectedPacking.model}||${selectedPacking.supplier || ''}` : '';
                    const setPackingPart = (packing: any) => {
                      updateItemOverrides(idx, {
                        box_type: packing?.model || '',
                        packing_parts_json: packing?.model ? JSON.stringify([{
                          model: packing.model,
                          supplier: packing.supplier || '',
                          qty: 1,
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
                          label={`包装: ${summary.label} / ¥${summary.total.toFixed(2)}`}
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
            <Typography variant="h6">总出厂价: ¥{items.reduce((sum, item) => sum + (item.unit_cost * item.qty), 0).toFixed(2)} | 总报价: ¥{items.reduce((sum, item) => sum + item.total_price, 0).toFixed(2)}</Typography>
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
