import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  ClipboardList as ClipboardListIcon,
  PackageCheck as PackageCheckIcon,
  RefreshCw as RefreshIcon,
  Search as SearchIcon,
  ShoppingCart as ShoppingCartIcon,
  Store as StoreIcon,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import OrderDetailModal from '../components/OrderDetailModal';
import { Order } from '../types';
import { applyPurchaseTaskByModel } from '../utils/orderStore';
import {
  AffectedPurchase,
  GroupPurchaseConfirm,
  PurchaseFilter,
  PurchaseTask,
  buildPurchaseStats,
  buildPurchaseTasks,
  statusColor,
  statusText,
  taskStatus,
} from '../utils/purchaseCenterRules';
import { useAppStore } from '../utils/store';
import { gradients } from '../utils/theme';

export default function PurchaseCenterPage() {
  const { orders, fetchOrders, ordersLoading, showSnackbar } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<PurchaseFilter>('pending');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [groupConfirm, setGroupConfirm] = useState<GroupPurchaseConfirm | null>(null);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const tasks = useMemo(() => buildPurchaseTasks(orders), [orders]);
  const suppliers = useMemo(() => [...new Set(tasks.map(task => task.supplierLabel))].sort((a, b) => a.localeCompare(b, 'zh')), [tasks]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter(task => {
      const status = taskStatus(task);
      const matchStatus = statusFilter === 'all' || status === statusFilter;
      const matchSupplier = !supplierFilter || task.supplierLabel === supplierFilter;
      const matchSearch = !q || [
        task.model,
        task.name,
        task.supplierLabel,
        ...task.affected.map(a => a.order.customerName),
        ...task.affected.map(a => a.order.contractNo || ''),
      ].join(' ').toLowerCase().includes(q);
      return matchStatus && matchSupplier && matchSearch;
    });
  }, [tasks, searchQuery, supplierFilter, statusFilter]);

  const groupedTasks = useMemo(() => {
    const grouped = new Map<string, PurchaseTask[]>();
    for (const task of filteredTasks) {
      const list = grouped.get(task.supplierLabel) || [];
      list.push(task);
      grouped.set(task.supplierLabel, list);
    }
    return [...grouped.entries()];
  }, [filteredTasks]);

  const stats = useMemo(() => {
    return buildPurchaseStats(orders, tasks, suppliers.length);
  }, [orders, tasks, suppliers.length]);

  const refresh = async () => {
    await fetchOrders(true);
    showSnackbar('采购数据已刷新', 'success');
  };

  const applyPurchased = useCallback(async (affected: AffectedPurchase[], purchased: boolean, savingId: string) => {
    setSavingKey(savingId);
    try {
      const tasks = new Map<string, { model: string; supplier: string }>();
      affected.forEach(({ item }) => {
        tasks.set(`${item.supplier || ''}||${item.model}`, { model: item.model, supplier: item.supplier || '' });
      });
      await Promise.all([...tasks.values()].map(task => applyPurchaseTaskByModel({ ...task, purchased })));
      await fetchOrders(true);
      showSnackbar(purchased ? '已标记为已采购' : '已取消已采购标记', purchased ? 'success' : 'info');
    } catch (error) {
      console.error(error);
      showSnackbar('采购状态保存失败', 'error');
    } finally {
      setSavingKey(null);
    }
  }, [fetchOrders, showSnackbar]);

  const confirmGroupPurchased = async () => {
    if (!groupConfirm) return;
    const target = groupConfirm;
    setGroupConfirm(null);
    await applyPurchased(target.affected, target.purchased, target.savingKey);
  };

  return (
    <Box>
      <PageHeader
        title="采购中心"
        subtitle="按供应商汇总所有未完成订单的采购需求"
        actions={
          <Tooltip title="刷新采购数据">
            <span>
              <IconButton aria-label="刷新采购数据" onClick={refresh} disabled={ordersLoading}>
                {ordersLoading ? <CircularProgress size={18} /> : <RefreshIcon size={18} />}
              </IconButton>
            </span>
          </Tooltip>
        }
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3 }}>
        <StatCard label="待采购订单" value={stats.activeOrderCount} subtitle="未完成且含采购需求" icon={<ShoppingCartIcon size={22} />} gradient={gradients.orders} delay={0} />
        <StatCard label="供应商" value={stats.supplierCount} subtitle="涉及采购供应商" icon={<StoreIcon size={22} />} gradient={gradients.parts} delay={1} />
        <StatCard label="待采型号" value={stats.pendingTaskCount} subtitle={`共 ${stats.taskCount} 个采购项`} icon={<ClipboardListIcon size={22} />} gradient={gradients.recipes} delay={2} />
        <StatCard label="采购进度" value={`${stats.purchasedNeed}/${stats.totalNeed || 0}`} subtitle={`剩余 ${stats.pendingNeed}`} icon={<PackageCheckIcon size={22} />} gradient={gradients.completed} delay={3} />
      </Box>

      <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
        这里负责把采购项标记为“已采购”。库存入库仍在订单详情中确认，避免误把未到货零件加入库存。
      </Alert>

      <Paper elevation={0} sx={{ borderRadius: 3, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ p: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
          <TextField
            size="small"
            placeholder="搜索型号、供应商、客户、合同号..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon size={18} /></InputAdornment> }}
            sx={{ minWidth: 240, flex: 1 }}
          />
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>供应商</InputLabel>
            <Select value={supplierFilter} label="供应商" onChange={(event) => setSupplierFilter(event.target.value)}>
              <MenuItem value="">全部供应商</MenuItem>
              {suppliers.map(supplier => <MenuItem key={supplier} value={supplier}>{supplier}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>状态</InputLabel>
            <Select value={statusFilter} label="状态" onChange={(event) => setStatusFilter(event.target.value as PurchaseFilter)}>
              <MenuItem value="pending">待采购</MenuItem>
              <MenuItem value="partial">部分已采</MenuItem>
              <MenuItem value="purchased">已采购</MenuItem>
              <MenuItem value="all">全部</MenuItem>
            </Select>
          </FormControl>
          <Chip label={`当前 ${filteredTasks.length} 项`} size="small" variant="outlined" sx={{ fontWeight: 600 }} />
        </Box>

        {ordersLoading && <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>}

        {!ordersLoading && groupedTasks.length === 0 && (
          <Box sx={{ py: 8, textAlign: 'center', color: 'text.secondary' }}>
            <CheckCircleIcon size={44} style={{ opacity: 0.35, marginBottom: 8 }} />
            <Typography variant="body2">暂无匹配的采购项</Typography>
          </Box>
        )}

        {!ordersLoading && groupedTasks.map(([supplier, supplierTasks]) => {
          const supplierPending = supplierTasks.reduce((sum, task) => sum + task.pendingNeed, 0);
          const supplierTotal = supplierTasks.reduce((sum, task) => sum + task.totalNeed, 0);
          const supplierAffected = supplierTasks.flatMap(task => task.affected);
          const allPurchased = supplierPending <= 0;
          const groupSavingKey = `supplier:${supplier}`;
          return (
            <Box key={supplier}>
              <Box sx={{
                px: 2,
                py: 1.4,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                bgcolor: 'rgba(15,23,42,0.03)',
                borderTop: '1px solid',
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}>
                <StoreIcon size={18} />
                <Typography fontWeight={700}>{supplier}</Typography>
                <Chip size="small" label={`${supplierTasks.length} 个型号`} variant="outlined" />
                <Chip size="small" label={`剩余 ${supplierPending}/${supplierTotal}`} color={supplierPending > 0 ? 'warning' : 'success'} variant="outlined" />
                <Box flex={1} />
                <Button
                  size="small"
                  variant={allPurchased ? 'outlined' : 'contained'}
                  color={allPurchased ? 'inherit' : 'success'}
                  startIcon={savingKey === groupSavingKey ? <CircularProgress size={14} /> : <CheckCircleIcon size={16} />}
                  disabled={savingKey !== null}
                  onClick={() => setGroupConfirm({
                    supplier,
                    taskCount: supplierTasks.length,
                    totalNeed: supplierTotal,
                    pendingNeed: supplierPending,
                    orderCount: new Set(supplierAffected.map(entry => entry.order.id)).size,
                    purchased: !allPurchased,
                    savingKey: groupSavingKey,
                    affected: supplierAffected,
                  })}
                >
                  {allPurchased ? '取消整组已采' : '整组标记已采'}
                </Button>
              </Box>

              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 54 }} />
                      <TableCell>型号</TableCell>
                      <TableCell>名称</TableCell>
                      <TableCell align="right">需求</TableCell>
                      <TableCell align="right">已采</TableCell>
                      <TableCell>关联订单</TableCell>
                      <TableCell align="center">状态</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {supplierTasks.map(task => {
                      const status = taskStatus(task);
                      const checked = status === 'purchased';
                      const indeterminate = status === 'partial';
                      const taskSaving = savingKey === task.key;
                      const uniqueOrders = [...new Map(task.affected.map(entry => [entry.order.id, entry.order])).values()];
                      return (
                        <TableRow key={task.key} hover sx={{ bgcolor: task.pendingNeed > 0 ? 'rgba(251,191,36,0.04)' : 'rgba(34,197,94,0.04)' }}>
                          <TableCell>
                            {taskSaving ? (
                              <CircularProgress size={20} />
                            ) : (
                              <Checkbox
                                checked={checked}
                                indeterminate={indeterminate}
                                onChange={() => applyPurchased(task.affected, !checked, task.key)}
                                disabled={savingKey !== null}
                                color="success"
                                size="small"
                              />
                            )}
                          </TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>{task.model}</TableCell>
                          <TableCell>{task.name || '-'}</TableCell>
                          <TableCell align="right">{task.totalNeed}</TableCell>
                          <TableCell align="right">{task.purchasedNeed}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                              {uniqueOrders.slice(0, 4).map(order => (
                                <Chip
                                  key={order.id}
                                  label={`${order.customerName}${order.contractNo ? ` / ${order.contractNo}` : ''}`}
                                  size="small"
                                  onClick={() => setSelectedOrder(order)}
                                  variant="outlined"
                                />
                              ))}
                              {uniqueOrders.length > 4 && <Chip label={`+${uniqueOrders.length - 4}`} size="small" />}
                            </Box>
                          </TableCell>
                          <TableCell align="center">
                            <Chip size="small" label={statusText(status)} color={statusColor(status)} variant="outlined" />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          );
        })}
      </Paper>

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdated={() => { fetchOrders(true); setSelectedOrder(null); }}
        />
      )}

      <Dialog open={groupConfirm !== null} onClose={() => setGroupConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{groupConfirm?.purchased ? '整组标记已采' : '取消整组已采'}</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              这只会修改采购状态，不会增加库存；库存入库仍需在订单详情中确认。
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              <Chip label={`供应商：${groupConfirm?.supplier || '-'}`} variant="outlined" />
              <Chip label={`${groupConfirm?.taskCount || 0} 个型号`} variant="outlined" />
              <Chip label={`${groupConfirm?.orderCount || 0} 个订单`} variant="outlined" />
              <Chip
                label={groupConfirm?.purchased
                  ? `待标记 ${groupConfirm?.pendingNeed || 0}`
                  : `总需求 ${groupConfirm?.totalNeed || 0}`}
                color={groupConfirm?.purchased ? 'warning' : 'default'}
                variant="outlined"
              />
            </Box>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupConfirm(null)}>取消</Button>
          <Button
            variant="contained"
            color={groupConfirm?.purchased ? 'success' : 'inherit'}
            onClick={confirmGroupPurchased}
          >
            确认
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
