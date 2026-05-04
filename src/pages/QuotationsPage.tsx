import { useState, useEffect } from 'react';
import { Box, Paper, Typography, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Chip, MenuItem, Select, FormControl, InputLabel, Checkbox, FormControlLabel, Tooltip } from '@mui/material';
import { Plus, Edit, Trash2, ArrowRight } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAppStore } from '../utils/store';
import { createQuotation, updateQuotation, deleteQuotation, dynamicCalculateCost } from '../utils/api';

export default function QuotationsPage() {
  const { quotations, customers, recipes, fetchQuotations, fetchCustomers, fetchRecipes, fetchOrders, showSnackbar } = useAppStore();
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
  }, [fetchQuotations, fetchCustomers, fetchRecipes]);

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
    const newItems = [...items];
    newItems[index].overrides = { ...newItems[index].overrides, [field]: val };
    
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
                    <IconButton size="small" onClick={() => { setEditing(q); setCustomerId(q.customerId); setStatus(q.status); setRemark(q.remark); setItems(JSON.parse(q.itemsJson || '[]')); setOpen(true); }}><Edit size={16} /></IconButton>
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
                  
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel>包装</InputLabel>
                    <Select value={item.overrides.box_type || ''} label="包装" onChange={e => updateItemOverride(idx, 'box_type', e.target.value)}>
                      <MenuItem value="">默认</MenuItem>
                      <MenuItem value="纸箱">纸箱</MenuItem>
                      <MenuItem value="木箱">木箱</MenuItem>
                    </Select>
                  </FormControl>
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
