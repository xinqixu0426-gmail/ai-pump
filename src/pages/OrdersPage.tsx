import { useState, useEffect, useCallback } from 'react';
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
} from '@mui/material';
import {
  Add as AddIcon,
  Info as InfoIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { Order, OrderStatus } from '../types';
import { getAllOrders, deleteOrder } from '../utils/orderStore';
import OrderDetailModal from '../components/OrderDetailModal';

const STATUS_COLOR: Record<OrderStatus, 'warning' | 'info' | 'success'> = {
  待采购: 'warning',
  采购中: 'info',
  已完成: 'success',
};

export default function OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);

  const load = useCallback(() => {
    setOrders(getAllOrders().sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (id: string) => {
    if (!window.confirm('确定删除这个订单？')) return;
    deleteOrder(id);
    load();
  };

  const handleDetail = (order: Order) => setSelected(order);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

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
                <TableCell>需采购零件</TableCell>
                <TableCell>状态</TableCell>
                <TableCell>创建时间</TableCell>
                <TableCell align="center" sx={{ width: 100 }}>操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orders.map((order) => {
                const needCount = order.purchaseList.filter((p) => p.needToBuy > 0).length;
                const purchasedCount = order.purchaseList.filter((p) => p.needToBuy > 0 && p.purchased).length;
                return (
                  <TableRow key={order.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{order.customerName}</TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>{order.contractNo || '-'}</TableCell>
                    <TableCell>{order.items.length} 个型号</TableCell>
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
          onUpdated={() => { load(); setSelected(null); }}
        />
      )}
    </Paper>
  );
}
