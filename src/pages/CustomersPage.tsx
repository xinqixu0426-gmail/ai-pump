import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  IconButton,
  Typography,
  Chip,
  Tooltip,
} from '@mui/material';
import { Plus, Edit, Trash2, FileText, ArrowRight } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAppStore } from '../utils/store';
import { createCustomer, updateCustomer, deleteCustomer, deleteQuotation } from '../utils/api';
import { entityCreatedAt, entityId } from '../utils/entityFields';
import { Customer, CustomerInput } from '../types';
import {
  calculateCustomerQuotationStats,
  customerInputFromCustomer,
  defaultCustomerInput,
  quotationCountByCustomer,
  quotationStatusColor,
  quotationsForCustomer,
  updateCustomerDefaultMargin,
} from '../utils/customerRules';

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export default function CustomersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationState = location.state as { customerId?: number } | null;
  const consumedNavigationRef = useRef<string | null>(null);
  const { customers, quotations, fetchCustomers, fetchQuotations, showSnackbar } = useAppStore();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [form, setForm] = useState<CustomerInput>(defaultCustomerInput());

  useEffect(() => {
    fetchCustomers();
    fetchQuotations();
  }, [fetchCustomers, fetchQuotations]);

  useEffect(() => {
    if (!navigationState?.customerId || consumedNavigationRef.current === location.key) return;
    const target = customers.find(c => entityId(c) === Number(navigationState.customerId));
    if (!target) return;

    setSelectedCustomerId(entityId(target));
    consumedNavigationRef.current = location.key;
    navigate(location.pathname, { replace: true, state: null });
  }, [navigationState?.customerId, customers, location.key, location.pathname, navigate]);

  useEffect(() => {
    if (selectedCustomerId || customers.length === 0) return;
    setSelectedCustomerId(entityId(customers[0]));
  }, [customers, selectedCustomerId]);

  const selectedCustomer = customers.find(c => entityId(c) === selectedCustomerId) || null;
  const customerQuotations = useMemo(
    () => quotationsForCustomer(quotations, selectedCustomerId),
    [quotations, selectedCustomerId]
  );
  const quotationCounts = useMemo(() => quotationCountByCustomer(quotations), [quotations]);

  const quotationStats = useMemo(() => calculateCustomerQuotationStats(customerQuotations), [customerQuotations]);

  const handleSave = async () => {
    try {
      if (editing) {
        await updateCustomer(entityId(editing), form);
        await fetchCustomers(true);
      } else {
        await createCustomer(form);
        const refreshed = await fetchCustomers(true);
        const created = refreshed.find(c => c.name === form.name);
        if (created) setSelectedCustomerId(entityId(created));
      }
      setOpen(false);
      showSnackbar('客户保存成功', 'success');
    } catch (err: unknown) {
      showSnackbar(getErrorMessage(err, '保存失败'), 'error');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该客户?')) return;
    try {
      await deleteCustomer(id);
      await fetchCustomers(true);
      if (selectedCustomerId === id) setSelectedCustomerId(null);
      showSnackbar('删除成功', 'info');
    } catch (err: unknown) {
      showSnackbar(getErrorMessage(err, '删除失败'), 'error');
    }
  };

  const handleDeleteQuotation = async (id: number) => {
    if (!confirm('确定删除该报价单?')) return;
    try {
      await deleteQuotation(id);
      await fetchQuotations(true);
      showSnackbar('报价单已删除', 'info');
    } catch (err: unknown) {
      showSnackbar(getErrorMessage(err, '删除失败'), 'error');
    }
  };

  const openForm = (c?: Customer) => {
    if (c) {
      setEditing(c);
      setForm(customerInputFromCustomer(c));
    } else {
      setEditing(null);
      setForm(defaultCustomerInput());
    }
    setOpen(true);
  };

  return (
    <Box>
      <PageHeader
        title="客户管理"
        subtitle="管理客户档案、默认加价与关联报价"
        actions={<Button variant="contained" startIcon={<Plus size={20} />} onClick={() => openForm()}>新增客户</Button>}
      />

      <Box sx={{ mt: 3, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '420px 1fr' }, gap: 2, alignItems: 'start' }}>
        <Paper elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="subtitle1" fontWeight={700}>客户列表</Typography>
            <Chip size="small" label={`${customers.length} 个客户`} variant="outlined" />
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
                <TableCell>客户</TableCell>
                <TableCell align="right">默认加价</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {customers.map(c => {
                const id = entityId(c);
                const selected = id === selectedCustomerId;
                const quoteCount = quotationCounts.get(id) || 0;
                return (
                  <TableRow
                    key={id}
                    hover
                    selected={selected}
                    onClick={() => setSelectedCustomerId(id)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>{c.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{c.contactInfo || c.remark || '-'}</Typography>
                      <Box sx={{ mt: 0.5 }}>
                        <Chip size="small" label={`${quoteCount} 张报价`} variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                      </Box>
                    </TableCell>
                    <TableCell align="right">{(c.defaultMargin * 100).toFixed(0)}%</TableCell>
                    <TableCell align="right" onClick={e => e.stopPropagation()}>
                      <IconButton size="small" aria-label="编辑客户" onClick={() => openForm(c)}><Edit size={16} /></IconButton>
                      <IconButton size="small" color="error" aria-label="删除客户" onClick={() => handleDelete(id)}><Trash2 size={16} /></IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
              {customers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 4, color: 'text.secondary' }}>暂无客户记录</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>

        <Paper elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                {selectedCustomer ? selectedCustomer.name : '选择客户'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {selectedCustomer
                  ? `${selectedCustomer.contactInfo || '无联系方式'} · 默认加价 ${(selectedCustomer.defaultMargin * 100).toFixed(0)}%`
                  : '点击左侧客户查看报价历史'}
              </Typography>
            </Box>
            <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
              <Chip size="small" icon={<FileText size={14} />} label={`${quotationStats.count} 张报价`} />
              <Chip size="small" label={`总报价 ¥${quotationStats.totalPrice.toFixed(2)}`} color="primary" variant="outlined" />
              {quotationStats.latest && <Chip size="small" label={`最近 ${quotationStats.latest.toLocaleDateString()}`} variant="outlined" />}
              <Button
                size="small"
                variant="contained"
                startIcon={<Plus size={16} />}
                disabled={!selectedCustomer}
                onClick={() => navigate('/quotations')}
              >
                新建报价
              </Button>
            </Box>
          </Box>

          <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
                <TableCell>状态</TableCell>
                <TableCell>总成本</TableCell>
                <TableCell>总报价</TableCell>
                <TableCell>备注</TableCell>
                <TableCell>创建时间</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {customerQuotations.map(q => (
                <TableRow key={entityId(q)}>
                  <TableCell><Chip size="small" label={q.status} color={quotationStatusColor(q.status)} /></TableCell>
                  <TableCell>¥{Number(q.totalCost || 0).toFixed(2)}</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: 'primary.main' }}>¥{Number(q.totalPrice || 0).toFixed(2)}</TableCell>
                  <TableCell>{q.remark || '-'}</TableCell>
                  <TableCell>{entityCreatedAt(q) ? new Date(entityCreatedAt(q) as string).toLocaleDateString() : '-'}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="在报价单页编辑">
                      <IconButton size="small" aria-label="在报价单页编辑" onClick={() => navigate('/quotations')}><ArrowRight size={16} /></IconButton>
                    </Tooltip>
                    <IconButton size="small" color="error" aria-label="删除报价单" onClick={() => handleDeleteQuotation(entityId(q))}><Trash2 size={16} /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {selectedCustomer && customerQuotations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    该客户还没有报价单
                  </TableCell>
                </TableRow>
              )}
              {!selectedCustomer && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    请先选择一个客户
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? '编辑客户' : '新增客户'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField label="客户名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} fullWidth />
          <TextField label="联系方式" value={form.contactInfo} onChange={e => setForm({ ...form, contactInfo: e.target.value })} fullWidth />
          <TextField label="默认加价率(小数，例如 .15 代表 15%)" type="number" inputProps={{ step: 0.01 }} value={form.defaultMargin} onChange={e => setForm(updateCustomerDefaultMargin(form, e.target.value))} fullWidth />
          <TextField label="备注" value={form.remark} onChange={e => setForm({ ...form, remark: e.target.value })} fullWidth multiline rows={3} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleSave} variant="contained" disabled={!form.name}>保存</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
