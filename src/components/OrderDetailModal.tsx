import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Tabs,
  Tab,
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Checkbox,
  Alert,
  CircularProgress,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Close as CloseIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  ShoppingCart as CartIcon,
  Assignment as AssignmentIcon,
  Inventory as InventoryIcon,
} from '@mui/icons-material';
import { Order, OrderStatus } from '../types';
import { saveOrder, calcStockAdditions } from '../utils/orderStore';
import { batchAddStock } from '../utils/api';

interface Props {
  order: Order;
  onClose: () => void;
  onUpdated: () => void;
}

const STATUS_COLOR: Record<OrderStatus, 'warning' | 'info' | 'success'> = {
  待采购: 'warning',
  采购中: 'info',
  已完成: 'success',
};

export default function OrderDetailModal({ order, onClose, onUpdated }: Props) {
  const [tab, setTab] = useState(0);
  const [localOrder, setLocalOrder] = useState<Order>(order);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // 切换单条采购项的已采购状态
  const togglePurchased = async (model: string, supplier: string) => {
    const updated: Order = {
      ...localOrder,
      purchaseList: localOrder.purchaseList.map((p) =>
        p.model === model && p.supplier === supplier
          ? { ...p, purchased: !p.purchased }
          : p
      ),
      updatedAt: new Date().toISOString(),
    };
    setLocalOrder(updated);
    await saveOrder(updated);
  };

  // 切换 to-do 完成状态
  const toggleTodo = async (id: string) => {
    const updated: Order = {
      ...localOrder,
      todos: localOrder.todos.map((t) =>
        t.id === id ? { ...t, done: !t.done } : t
      ),
      updatedAt: new Date().toISOString(),
    };
    setLocalOrder(updated);
    await saveOrder(updated);
  };

  // 更新订单状态
  const setStatus = async (status: OrderStatus) => {
    const updated: Order = { ...localOrder, status, updatedAt: new Date().toISOString() };
    setLocalOrder(updated);
    await saveOrder(updated);
    onUpdated();
  };

  // 确认采购完成，入库
  const handleConfirmPurchase = async () => {
    if (!window.confirm('确认所有采购已完成？将把 needToBuy 数量加入库存。')) return;
    setConfirming(true);
    setError('');
    try {
      const additions = calcStockAdditions(localOrder.purchaseList);
      if (additions.length > 0) {
        await batchAddStock(additions);
      }
      const updated: Order = {
        ...localOrder,
        status: '已完成',
        // 标记全部已采购
        purchaseList: localOrder.purchaseList.map((p) => ({ ...p, purchased: true })),
        updatedAt: new Date().toISOString(),
      };
      setLocalOrder(updated);
      await saveOrder(updated);
      setSuccessMsg(`入库完成！共更新 ${additions.length} 种零件库存。`);
      onUpdated();
    } catch (e) {
      setError('入库失败，请检查 API 服务是否运行');
      console.error(e);
    } finally {
      setConfirming(false);
    }
  };

  const needToBuyCount = localOrder.purchaseList.filter((p) => p.needToBuy > 0).length;
  const purchasedCount = localOrder.purchaseList.filter((p) => p.purchased && p.needToBuy > 0).length;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>
        <Box display="flex" alignItems="center" gap={1}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            📦 {localOrder.customerName}
          </Typography>
          <Chip
            label={localOrder.status}
            color={STATUS_COLOR[localOrder.status]}
            size="small"
          />
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
        {localOrder.contractNo && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            合同号：{localOrder.contractNo}
          </Typography>
        )}
        {localOrder.remark && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            备注：{localOrder.remark}
          </Typography>
        )}
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab icon={<InventoryIcon fontSize="small" />} iconPosition="start" label={`型号列表 (${localOrder.items.length})`} />
          <Tab
            icon={<CartIcon fontSize="small" />}
            iconPosition="start"
            label={`采购清单 (${purchasedCount}/${needToBuyCount})`}
          />
          <Tab icon={<AssignmentIcon fontSize="small" />} iconPosition="start" label="采购 To-Do" />
        </Tabs>
      </Box>

      <DialogContent sx={{ minHeight: 360 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {successMsg && <Alert severity="success" sx={{ mb: 2 }}>{successMsg}</Alert>}

        {/* ── Tab 0: 型号列表 ── */}
        {tab === 0 && (
          <Box>
            {localOrder.items.map((item) => {
              let parts: { model: string; name: string; qty: number; supplier: string }[] = [];
              try { parts = JSON.parse(item.partsJson); } catch { /* noop */ }
              return (
                <Box key={item.id} sx={{ mb: 3 }}>
                  <Box display="flex" alignItems="center" gap={1} mb={1}>
                    <Typography fontWeight={700}>{item.recipeName}</Typography>
                    {item.spec && <Chip label={item.spec} size="small" variant="outlined" />}
                    <Chip label={`×${item.qty} 台`} color="primary" size="small" />
                  </Box>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ backgroundColor: 'grey.50' }}>
                          <TableCell>型号</TableCell>
                          <TableCell>名称</TableCell>
                          <TableCell>供应商</TableCell>
                          <TableCell align="right">单台数量</TableCell>
                          <TableCell align="right">合计数量</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {parts.map((p, i) => (
                          <TableRow key={i}>
                            <TableCell>{p.model}</TableCell>
                            <TableCell>{p.name}</TableCell>
                            <TableCell>{p.supplier}</TableCell>
                            <TableCell align="right">{p.qty}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 600 }}>
                              {p.qty * item.qty}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Divider sx={{ mt: 2 }} />
                </Box>
              );
            })}
          </Box>
        )}

        {/* ── Tab 1: 采购清单 ── */}
        {tab === 1 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: 'grey.50' }}>
                  <TableCell>型号</TableCell>
                  <TableCell>名称</TableCell>
                  <TableCell>供应商</TableCell>
                  <TableCell align="right">需要总量</TableCell>
                  <TableCell align="right">当前库存</TableCell>
                  <TableCell align="right">需采购</TableCell>
                  <TableCell align="center">已采购</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {localOrder.purchaseList.map((p) => (
                  <TableRow
                    key={`${p.model}|${p.supplier}`}
                    sx={{
                      backgroundColor: p.needToBuy > 0 && !p.purchased
                        ? 'rgba(239,68,68,0.04)'
                        : p.purchased ? 'rgba(34,197,94,0.05)' : 'inherit',
                    }}
                  >
                    <TableCell>{p.model}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.supplier}</TableCell>
                    <TableCell align="right">{p.totalQty}</TableCell>
                    <TableCell align="right">{p.currentStock}</TableCell>
                    <TableCell align="right">
                      {p.needToBuy > 0 ? (
                        <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5}>
                          <WarningIcon sx={{ fontSize: 14, color: p.purchased ? 'success.main' : 'error.main' }} />
                          <Typography
                            variant="body2"
                            fontWeight={700}
                            color={p.purchased ? 'success.main' : 'error.main'}
                          >
                            {p.needToBuy}
                          </Typography>
                        </Box>
                      ) : (
                        <Box display="flex" alignItems="center" justifyContent="flex-end" gap={0.5}>
                          <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />
                          <Typography variant="body2" color="success.main">库存充足</Typography>
                        </Box>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {p.needToBuy > 0 ? (
                        <Tooltip title={p.purchased ? '点击取消' : '标记为已采购'}>
                          <Checkbox
                            checked={p.purchased}
                            onChange={() => togglePurchased(p.model, p.supplier)}
                            color="success"
                            size="small"
                          />
                        </Tooltip>
                      ) : (
                        <CheckCircleIcon sx={{ fontSize: 18, color: 'success.light' }} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* ── Tab 2: To-Do ── */}
        {tab === 2 && (
          <Box>
            {localOrder.todos.length === 0 ? (
              <Box textAlign="center" py={4} color="text.secondary">
                <CheckCircleIcon sx={{ fontSize: 48, color: 'success.light', mb: 1, display: 'block', mx: 'auto' }} />
                库存全部充足，无需采购
              </Box>
            ) : (
              localOrder.todos.map((todo) => (
                <Box
                  key={todo.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    p: 1.5,
                    mb: 1,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: todo.done ? 'success.light' : 'warning.light',
                    backgroundColor: todo.done ? 'rgba(34,197,94,0.05)' : 'rgba(251,191,36,0.06)',
                    transition: 'all 0.2s',
                  }}
                >
                  <Checkbox
                    checked={todo.done}
                    onChange={() => toggleTodo(todo.id)}
                    color="success"
                    size="small"
                    sx={{ mt: -0.5, mr: 1 }}
                  />
                  <Box>
                    <Typography
                      variant="body2"
                      sx={{
                        textDecoration: todo.done ? 'line-through' : 'none',
                        color: todo.done ? 'text.secondary' : 'text.primary',
                        fontWeight: 500,
                      }}
                    >
                      {todo.description}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      供应商：{todo.supplier}
                    </Typography>
                  </Box>
                </Box>
              ))
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: 'wrap' }}>
        {/* 状态流转按钮 */}
        {localOrder.status === '待采购' && (
          <Button variant="outlined" color="info" onClick={() => setStatus('采购中')}>
            开始采购
          </Button>
        )}
        {localOrder.status === '采购中' && (
          <Button
            variant="contained"
            color="success"
            startIcon={confirming ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />}
            onClick={handleConfirmPurchase}
            disabled={confirming}
          >
            确认采购完成并入库
          </Button>
        )}
        {localOrder.status === '已完成' && (
          <Chip label="✅ 已入库完成" color="success" />
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose} variant="outlined">关闭</Button>
      </DialogActions>
    </Dialog>
  );
}
