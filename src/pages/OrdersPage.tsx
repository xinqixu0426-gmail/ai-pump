import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Paper, Typography, Box, Button, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, IconButton, Tooltip,
  TextField, InputAdornment, Autocomplete, Dialog, DialogTitle,
  DialogContent, DialogContentText, DialogActions, Fade,
  Select, MenuItem, CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon, Info as InfoIcon, Delete as DeleteIcon,
  Search as SearchIcon, Edit as EditIcon, Refresh as RefreshIcon,
} from '@mui/icons-material';
import { Order, OrderStatus } from '../types';
import { deleteOrder, saveOrder } from '../utils/orderStore';
import { useAppStore } from '../utils/store';
import OrderDetailModal from '../components/OrderDetailModal';
import PageHeader from '../components/PageHeader';
import { formatDate } from '../utils/format';
import { gradients } from '../utils/theme';

const STATUS_COLOR: Record<OrderStatus, 'warning' | 'info' | 'success'> = {
  待采购: 'warning',
  采购中: 'info',
  已完成: 'success',
};

// ── KPI 统计卡片 ──
function StatCard({ label, value, sub, gradient, delay }: { label: string; value: string | number; sub?: string; gradient: string; delay: number }) {
  return (
    <Fade in timeout={400 + delay * 100}>
      <Paper elevation={0} sx={{
        p: 2, borderRadius: 3, flex: 1, position: 'relative', overflow: 'hidden',
        transition: 'all 0.25s',
        '&:hover': { transform: 'translateY(-3px)', boxShadow: '0 8px 24px rgba(0,0,0,0.07)' },
        '&::before': { content: '""', position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: gradient },
      }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700}
          sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.68rem' }}>
          {label}
        </Typography>
        <Typography variant="h5" fontWeight={800} sx={{ letterSpacing: -0.5, mt: 0.3 }}>{value}</Typography>
        {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      </Paper>
    </Fade>
  );
}

export default function OrdersPage() {
  const navigate = useNavigate();
  const { orders: rawOrders, fetchOrders } = useAppStore();
  const [selected, setSelected] = useState<Order | null>(null);
  const [filterCustomer, setFilterCustomer] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  const orders = useMemo(() =>
    [...rawOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [rawOrders]
  );

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleRefresh = async () => {
    setLoading(true);
    await fetchOrders(true);
    setLoading(false);
  };

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleDelete = (id: string) => setDeleteTarget(id);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    await deleteOrder(id);
    fetchOrders(true);
  };

  const handleDetail = (order: Order) => setSelected(order);

  // 行内状态切换
  const handleStatusChange = useCallback(async (order: Order, newStatus: OrderStatus) => {
    if (order.status === newStatus) return;
    setStatusUpdating(order.id);
    try {
      await saveOrder({ ...order, status: newStatus });
      await fetchOrders(true);
    } catch { /* ignore */ }
    finally { setStatusUpdating(null); }
  }, [fetchOrders]);

  // KPI 统计
  const kpis = useMemo(() => {
    const pending = orders.filter(o => o.status === '待采购' || o.status === '采购中').length;
    const completed = orders.filter(o => o.status === '已完成').length;
    const totalRevenue = orders.reduce((s, o) => s + (o.totalPrice || 0), 0);
    const totalProfit = orders.reduce((s, o) => s + (o.totalProfit || 0), 0);
    return { pending, completed, totalRevenue, totalProfit };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return orders.filter(o => {
      const matchCustomer = !filterCustomer || o.customerName === filterCustomer;
      const matchSearch = !q || 
        o.customerName.toLowerCase().includes(q) ||
        (o.contractNo || '').toLowerCase().includes(q) ||
        o.items.some(it => it.recipeName.toLowerCase().includes(q));
      return matchCustomer && matchSearch;
    });
  }, [orders, filterCustomer, searchQuery]);

  return (
    <Box>
      <PageHeader
        title="📋 订单管理"
        subtitle="管理所有客户订单的状态与进度"
        actions={
          <>
            <Tooltip title="刷新数据">
              <span>
                <IconButton onClick={handleRefresh} disabled={loading}>
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Button variant="contained" startIcon={<AddIcon />}
              onClick={() => navigate('/order-form')}
              sx={{ fontWeight: 700, boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)' }}>
              新建订单
            </Button>
          </>
        }
      />

      {/* KPI 统计 */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <StatCard label="订单总数" value={orders.length} sub={`进行中 ${kpis.pending} 单`} gradient={gradients.orders} delay={0} />
        <StatCard label="已完成" value={kpis.completed} sub="已交付订单" gradient={gradients.completed} delay={1} />
        <StatCard label="总营收" value={`¥${(kpis.totalRevenue / 10000).toFixed(1)}w`} sub="订单出厂价合计" gradient={gradients.revenue} delay={2} />
        <StatCard label="总利润" value={`¥${(kpis.totalProfit / 10000).toFixed(1)}w`}
          sub={kpis.totalRevenue > 0 ? `利润率 ${((kpis.totalProfit / kpis.totalRevenue) * 100).toFixed(1)}%` : '-'}
          gradient={gradients.profit} delay={3} />
      </Box>

      {/* 订单列表 */}
      <Paper elevation={0} sx={{ borderRadius: 3, overflow: 'hidden' }}>
        {/* 筛选栏 */}
        {orders.length > 0 && (
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              size="small" placeholder="搜索客户、合同号、配方..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} /></InputAdornment> }}
              sx={{ minWidth: 220, flex: 1 }}
            />
            <Autocomplete
              options={[...new Set(orders.map((o) => o.customerName))].sort()}
              value={filterCustomer}
              onChange={(_, v) => setFilterCustomer(v)}
              renderInput={(params) => (
                <TextField {...params} size="small" placeholder="客户筛选" />
              )}
              sx={{ minWidth: 180 }}
              clearText="清除"
              noOptionsText="无匹配客户"
            />
            <Chip label={`共 ${filteredOrders.length} 单`} size="small" variant="outlined" sx={{ fontWeight: 600 }} />
          </Box>
        )}

        {orders.length === 0 ? (
          <Box textAlign="center" py={8} color="text.secondary">
            <Typography variant="h4" sx={{ mb: 1 }}>📦</Typography>
            <Typography variant="body2">暂无订单，点击右上角新建</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
                  <TableCell>客户名称</TableCell>
                  <TableCell>合同号</TableCell>
                  <TableCell>型号数</TableCell>
                  <TableCell align="right">总成本</TableCell>
                  <TableCell align="right">总出厂价</TableCell>
                  <TableCell>需采购零件</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>创建时间</TableCell>
                  <TableCell align="center" sx={{ width: 130 }}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredOrders.map((order, idx) => {
                  const needCount = order.purchaseList.filter((p) => p.needToBuy > 0).length;
                  const purchasedCount = order.purchaseList.filter((p) => p.needToBuy > 0 && p.purchased).length;
                  return (
                    <Fade key={order.id} in timeout={200 + idx * 60}>
                      <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => handleDetail(order)}>
                        <TableCell sx={{ fontWeight: 600 }}>{order.customerName}</TableCell>
                        <TableCell sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>{order.contractNo || '-'}</TableCell>
                        <TableCell>{order.items.length} 个型号</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>¥{(order.totalCost || 0).toFixed(2)}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'primary.main', fontWeight: 600 }}>¥{(order.totalPrice || 0).toFixed(2)}</TableCell>
                        <TableCell>
                          {needCount > 0 ? (
                            <Chip label={`${purchasedCount}/${needCount} 已采购`} size="small"
                              color={purchasedCount === needCount ? 'success' : 'warning'} variant="outlined" />
                          ) : (
                            <Chip label="库存充足" size="small" color="success" variant="outlined" />
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {statusUpdating === order.id ? (
                            <CircularProgress size={20} />
                          ) : (
                            <Select
                              value={order.status}
                              onChange={(e) => handleStatusChange(order, e.target.value as OrderStatus)}
                              size="small"
                              variant="standard"
                              disableUnderline
                              sx={{
                                fontWeight: 600,
                                fontSize: '0.8rem',
                                color: `${STATUS_COLOR[order.status]}.main`,
                                '& .MuiSelect-select': { py: 0.5, px: 1, borderRadius: 1, bgcolor: `${STATUS_COLOR[order.status]}.50` || 'action.hover' },
                              }}
                            >
                              <MenuItem value="待采购">⏳ 待采购</MenuItem>
                              <MenuItem value="采购中">🔄 采购中</MenuItem>
                              <MenuItem value="已完成">✅ 已完成</MenuItem>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                          {formatDate(order.createdAt)}
                        </TableCell>
                        <TableCell align="center">
                          <Tooltip title="查看详情">
                            <IconButton size="small" color="info" onClick={() => handleDetail(order)}>
                              <InfoIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="编辑订单">
                            <IconButton size="small" color="primary" onClick={() => navigate(`/order-form/${order.id}`)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="删除订单">
                            <IconButton size="small" color="error" onClick={() => handleDelete(order.id)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    </Fade>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {selected && (
        <OrderDetailModal
          order={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => { fetchOrders(true); setSelected(null); }}
        />
      )}

      {/* 删除确认弹窗 */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>删除订单</DialogTitle>
        <DialogContent>
          <DialogContentText>确定要删除这个订单吗？此操作不可撤销。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button onClick={confirmDelete} color="error" variant="contained">删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
