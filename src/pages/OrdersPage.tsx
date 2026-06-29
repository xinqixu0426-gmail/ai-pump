import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Paper, Typography, Box, Button, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, IconButton, Tooltip,
  TextField, InputAdornment, Autocomplete, Dialog, DialogTitle,
  DialogContent, DialogContentText, DialogActions, Fade,
  Select, MenuItem, CircularProgress, Skeleton, useMediaQuery, useTheme,
  TablePagination, TableSortLabel
} from '@mui/material';
import {
  Plus as AddIcon, Info as InfoIcon, Trash2 as DeleteIcon,
  Search as SearchIcon, Edit3 as EditIcon, RefreshCw as RefreshIcon,
} from 'lucide-react';
import { Order, OrderStatus } from '../types';
import { deleteOrder, saveOrder } from '../utils/orderStore';
import {
  ORDER_STATUS_COLOR,
  buildOrderKpis,
  filterOrders,
  orderPurchaseProgress,
  sortOrders,
  updateOrderStatus,
} from '../utils/orderLifecycleRules';
import { useAppStore } from '../utils/store';
import OrderDetailModal from '../components/OrderDetailModal';
import PageHeader from '../components/PageHeader';
import { formatDate } from '../utils/format';
import { gradients } from '../utils/theme';

// ── KPI 统计卡片 ──
import StatCard from '../components/StatCard';

export default function OrdersPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const location = useLocation();
  const navigationState = location.state as { openOrderId?: string; searchQuery?: string } | null;
  const consumedNavigationRef = useRef<string | null>(null);
  const { orders: rawOrders, fetchOrders, showSnackbar } = useAppStore();
  const [selected, setSelected] = useState<Order | null>(null);
  const [filterCustomer, setFilterCustomer] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<OrderStatus | '全部'>('全部');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(15);
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [orderBy, setOrderBy] = useState<string>('createdAt');

  const orders = useMemo(() =>
    [...rawOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [rawOrders]
  );

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    if (!navigationState || consumedNavigationRef.current === location.key) return;

    let consumed = false;
    if (navigationState.searchQuery) {
      setSearchQuery(navigationState.searchQuery);
      setPage(0);
      consumed = true;
    }

    if (navigationState.openOrderId) {
      const target = orders.find(o => o.id === navigationState.openOrderId);
      if (!target) return;
      setSelected(target);
      consumed = true;
    }

    if (consumed) {
      consumedNavigationRef.current = location.key;
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [navigationState, location.key, location.pathname, orders, navigate]);

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
    await fetchOrders(true);
    showSnackbar('订单已删除', 'info');
  };

  const handleDetail = (order: Order) => setSelected(order);

  // 行内状态切换
  const handleStatusChange = useCallback(async (order: Order, newStatus: OrderStatus) => {
    if (order.status === newStatus) return;
    setStatusUpdating(order.id);
    try {
      await saveOrder(updateOrderStatus(order, newStatus));
      await fetchOrders(true);
      showSnackbar(`订单状态已更新为「${newStatus}」`, 'success');
    } catch { /* ignore */ }
    finally { setStatusUpdating(null); }
  }, [fetchOrders]);

  // KPI 统计
  const kpis = useMemo(() => buildOrderKpis(orders), [orders]);

  const filteredOrders = useMemo(() => {
    return filterOrders({ orders, customer: filterCustomer, status: filterStatus, searchQuery });
  }, [orders, filterCustomer, filterStatus, searchQuery]);

  // 排序
  const sortedOrders = useMemo(() => {
    return sortOrders(filteredOrders, orderBy, order);
  }, [filteredOrders, order, orderBy]);

  // 分页
  const paginatedOrders = useMemo(() => {
    return sortedOrders.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  }, [sortedOrders, page, rowsPerPage]);

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  return (
    <Box>
      <PageHeader
        title="订单管理"
        subtitle="管理所有客户订单的状态与进度"
        actions={
          <>
            <Tooltip title="刷新数据">
              <span>
                <IconButton aria-label="刷新订单数据" onClick={handleRefresh} disabled={loading}>
                  <RefreshIcon size={18} />
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
      {loading ? (
        <Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3 }}>
            {[...Array(4)].map((_, i) => <Skeleton key={i} variant="rounded" height={100} sx={{ borderRadius: 3 }} />)}
          </Box>
          <Skeleton variant="rounded" height={400} sx={{ borderRadius: 3, width: '100%' }} />
        </Box>
      ) : (
        <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3 }}>
        <StatCard label="订单总数" value={orders.length} subtitle={`进行中 ${kpis.pending} 单`} gradient={gradients.orders} delay={0} />
        <StatCard label="已完成" value={kpis.completed} subtitle="已交付订单" gradient={gradients.completed} delay={1} />
        <StatCard label="总营收" value={`¥${(kpis.totalRevenue / 10000).toFixed(1)}w`} subtitle="订单出厂价合计" gradient={gradients.revenue} delay={2} />
        <StatCard label="总利润" value={`¥${(kpis.totalProfit / 10000).toFixed(1)}w`}
          subtitle={kpis.totalRevenue > 0 ? `利润率 ${((kpis.totalProfit / kpis.totalRevenue) * 100).toFixed(1)}%` : '-'}
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
              onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon size={18} color="rgba(148,163,184,0.6)" /></InputAdornment> }}
              sx={{ minWidth: 220, flex: 1 }}
            />
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {(['全部', '待采购', '采购中', '已完成'] as Array<OrderStatus | '全部'>).map(status => (
                <Chip
                  key={status}
                  label={status}
                  clickable
                  color={filterStatus === status ? (status === '已完成' ? 'success' : status === '采购中' ? 'info' : status === '待采购' ? 'warning' : 'primary') : 'default'}
                  variant={filterStatus === status ? 'filled' : 'outlined'}
                  onClick={() => { setFilterStatus(status); setPage(0); }}
                  sx={{ fontWeight: 700 }}
                />
              ))}
            </Box>
            <Autocomplete
              options={[...new Set(orders.map((o) => o.customerName))].sort()}
              value={filterCustomer}
              onChange={(_, v) => { setFilterCustomer(v); setPage(0); }}
              renderInput={(params) => (
                <TextField {...params} size="small" placeholder="客户筛选" />
              )}
              sx={{ minWidth: 180, flex: { xs: '1 1 100%', sm: 'none' } }}
              clearText="清除"
              noOptionsText="无匹配客户"
            />
            <Chip label={`共 ${filteredOrders.length} 单`} size="small" variant="outlined" sx={{ fontWeight: 600 }} />
          </Box>
        )}

        {orders.length === 0 ? (
          <Box textAlign="center" py={8} color="text.secondary">
            <Typography variant="body2" sx={{ mb: 1.5 }}>暂无订单，点击右上角新建</Typography>
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => navigate('/order-form')}>
              新建第一个订单
            </Button>
          </Box>
        ) : isMobile ? (
          <Box p={2}>
            {paginatedOrders.map((order, idx) => {
              const { needCount, purchasedCount } = orderPurchaseProgress(order);
              return (
                <Fade key={order.id} in timeout={200 + idx * 60}>
                  <Paper
                    elevation={0}
                    onClick={() => handleDetail(order)}
                    sx={{ p: 2, mb: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', cursor: 'pointer' }}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <Typography fontWeight={700}>{order.customerName}</Typography>
                      {statusUpdating === order.id ? (
                        <CircularProgress size={16} />
                      ) : (
                        <Select
                          value={order.status}
                          onChange={(e) => { e.stopPropagation(); handleStatusChange(order, e.target.value as OrderStatus); }}
                          size="small"
                          variant="standard"
                          disableUnderline
                          sx={{
                            fontWeight: 600, fontSize: '0.8rem', color: `${ORDER_STATUS_COLOR[order.status]}.main`,
                            '& .MuiSelect-select': { py: 0.5, px: 1, borderRadius: 1, bgcolor: `${ORDER_STATUS_COLOR[order.status]}.50` },
                            '& .MuiSelect-icon': { display: 'none' },
                            pr: 0,
                          }}
                        >
                          <MenuItem value="待采购">待采购</MenuItem>
                          <MenuItem value="采购中">采购中</MenuItem>
                          <MenuItem value="已完成">已完成</MenuItem>
                        </Select>
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary" display="block" mb={2}>
                      {order.contractNo || '无合同号'} · {order.items.length} 个型号
                    </Typography>
                    
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5}>
                      <Box>
                        <Typography variant="caption" color="text.secondary" display="block">总结</Typography>
                        <Box display="flex" gap={1.5}>
                          <Typography variant="body2">¥{(order.totalCost || 0).toFixed(0)}</Typography>
                          <Typography variant="body2" color="primary.main" fontWeight={600}>¥{(order.totalPrice || 0).toFixed(0)}</Typography>
                        </Box>
                      </Box>
                      <Box textAlign="right">
                        <Typography variant="caption" color="text.secondary" display="block">进度</Typography>
                        {needCount > 0 ? (
                          <Typography variant="body2" fontWeight={600} color={purchasedCount === needCount ? 'success.main' : 'warning.main'}>
                            {purchasedCount}/{needCount}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="success.main">库存足</Typography>
                        )}
                      </Box>
                    </Box>
                  </Paper>
                </Fade>
              );
            })}
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
                  <TableCell>
                    <TableSortLabel active={orderBy === 'customerName'} direction={orderBy === 'customerName' ? order : 'asc'} onClick={() => handleRequestSort('customerName')}>客户名称</TableSortLabel>
                  </TableCell>
                  <TableCell>合同号</TableCell>
                  <TableCell>型号数</TableCell>
                  <TableCell align="right">
                    <TableSortLabel active={orderBy === 'totalCost'} direction={orderBy === 'totalCost' ? order : 'asc'} onClick={() => handleRequestSort('totalCost')}>总成本</TableSortLabel>
                  </TableCell>
                  <TableCell align="right">
                    <TableSortLabel active={orderBy === 'totalPrice'} direction={orderBy === 'totalPrice' ? order : 'asc'} onClick={() => handleRequestSort('totalPrice')}>总出厂价</TableSortLabel>
                  </TableCell>
                  <TableCell>需采购零件</TableCell>
                  <TableCell>
                    <TableSortLabel active={orderBy === 'status'} direction={orderBy === 'status' ? order : 'asc'} onClick={() => handleRequestSort('status')}>状态</TableSortLabel>
                  </TableCell>
                  <TableCell>
                    <TableSortLabel active={orderBy === 'createdAt'} direction={orderBy === 'createdAt' ? order : 'asc'} onClick={() => handleRequestSort('createdAt')}>创建时间</TableSortLabel>
                  </TableCell>
                  <TableCell align="center" sx={{ width: 130 }}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedOrders.map((order, idx) => {
                  const { needCount, purchasedCount } = orderPurchaseProgress(order);
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
                            <Chip label={`已采 ${purchasedCount}/${needCount}`} size="small"
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
                                color: `${ORDER_STATUS_COLOR[order.status]}.main`,
                                '& .MuiSelect-select': { py: 0.5, px: 1, borderRadius: 1, bgcolor: `${ORDER_STATUS_COLOR[order.status]}.50` || 'action.hover' },
                              }}
                            >
                              <MenuItem value="待采购">待采购</MenuItem>
                              <MenuItem value="采购中">采购中</MenuItem>
                              <MenuItem value="已完成">已完成</MenuItem>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                          {formatDate(order.createdAt)}
                        </TableCell>
                        <TableCell align="center">
                          <Tooltip title="查看详情">
                            <IconButton size="small" color="info" aria-label="查看详情" onClick={(event) => { event.stopPropagation(); handleDetail(order); }}>
                              <InfoIcon size={18} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="编辑订单">
                            <IconButton size="small" color="primary" aria-label="编辑订单" onClick={(event) => { event.stopPropagation(); navigate(`/order-form/${order.id}`); }}>
                              <EditIcon size={18} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="删除订单">
                            <IconButton size="small" color="error" aria-label="删除订单" onClick={(event) => { event.stopPropagation(); handleDelete(order.id); }}>
                              <DeleteIcon size={18} />
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

        {/* Pagination */}
        {orders.length > 0 && (
          <TablePagination
            component="div"
            count={filteredOrders.length}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[15, 30, 50, 100]}
            labelRowsPerPage="每页行数:"
            sx={{ borderTop: '1px solid', borderColor: 'divider' }}
          />
        )}
      </Paper>
      </>
      )}

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
