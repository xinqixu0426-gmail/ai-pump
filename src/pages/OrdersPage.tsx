import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Paper,
  Typography,
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  Add as AddIcon,
  Info as InfoIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { Order, OrderStatus } from '../types';
import { deleteOrder } from '../utils/orderStore';
import { useAppStore } from '../utils/store';
import OrderDetailModal from '../components/OrderDetailModal';
import { formatDate } from '../utils/format';

const STATUS_COLOR: Record<OrderStatus, 'warning' | 'info' | 'success'> = {
  待采购: 'warning',
  采购中: 'info',
  已完成: 'success',
};

export default function OrdersPage() {
  const navigate = useNavigate();
  const { orders: rawOrders, fetchOrders } = useAppStore();
  const [selected, setSelected] = useState<Order | null>(null);
  const [filterCustomer, setFilterCustomer] = useState<string | null>(null);

  const orders = useMemo(() =>
    [...rawOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [rawOrders]
  );

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteTarget(id);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    await deleteOrder(id);
    fetchOrders(true);
  };

  const handleDetail = (order: Order) => setSelected(order);



  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      <Box display="flex" alignItems="center" mb={2}>
        <Typography variant="h6" color="primary" sx={{ flexGrow: 1 }}>
          📋 订单管理
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/order-form')}
        >
          新建订单
        </Button>
      </Box>

      {/* 客户筛选 */}
      {orders.length > 0 && (
        <Box mb={2}>
          <Autocomplete
            options={[...new Set(orders.map((o) => o.customerName))].sort()}
            value={filterCustomer}
            onChange={(_, v) => setFilterCustomer(v)}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                placeholder="按客户名称筛选"
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
            sx={{ maxWidth: 300 }}
            clearText="清除"
            noOptionsText="无匹配客户"
          />
        </Box>
      )}

      {orders.length === 0 ? (
        <Box textAlign="center" py={6} color="text.secondary">
          <Typography variant="h4" sx={{ mb: 1 }}>📦</Typography>
          暂无订单，点击右上角新建
        </Box>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
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
              {orders
                .filter((o) => !filterCustomer || o.customerName === filterCustomer)
                .map((order) => {
                const needCount = order.purchaseList.filter((p) => p.needToBuy > 0).length;
                const purchasedCount = order.purchaseList.filter((p) => p.needToBuy > 0 && p.purchased).length;
                return (
                  <TableRow key={order.id} hover sx={{ cursor: 'pointer' }} onDoubleClick={() => handleDetail(order)}>
                    <TableCell sx={{ fontWeight: 600 }}>{order.customerName}</TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>{order.contractNo || '-'}</TableCell>
                    <TableCell>{order.items.length} 个型号</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>¥{(order.totalCost || 0).toFixed(2)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'primary.main', fontWeight: 600 }}>¥{(order.totalPrice || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      {needCount > 0 ? (
                        <Chip
                          label={`${purchasedCount}/${needCount} 已采购`}
                          size="small"
                          color={purchasedCount === needCount ? 'success' : 'warning'}
                          variant="outlined"
                        />
                      ) : (
                        <Chip label="库存充足" size="small" color="success" variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={order.status}
                        size="small"
                        color={STATUS_COLOR[order.status]}
                      />
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
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
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
    </Paper>
  );
}
