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
  X as CloseIcon,
  CheckCircle as CheckCircleIcon,
  AlertTriangle as WarningIcon,
  ShoppingCart as CartIcon,
  ClipboardList as AssignmentIcon,
  Package as InventoryIcon,
} from 'lucide-react';
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
  const [confirmOpen, setConfirmOpen] = useState(false);
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
    setConfirmOpen(false);
    setConfirming(true);
    setError('');
    try {
      // 使用最新的 localOrder 快照
      const currentOrder = localOrder;
      const additions = calcStockAdditions(currentOrder.purchaseList);
      if (additions.length > 0) {
        await batchAddStock(additions);
      }
      const updated: Order = {
        ...currentOrder,
        status: '已完成',
        purchaseList: currentOrder.purchaseList.map((p) => ({ ...p, purchased: true })),
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
            <CloseIcon size={20} />
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
          <Tab icon={<InventoryIcon size={18} />} iconPosition="start" label={`型号列表 (${localOrder.items.length})`} />
          <Tab
            icon={<CartIcon size={18} />}
            iconPosition="start"
            label={`采购清单 (${purchasedCount}/${needToBuyCount})`}
          />
          <Tab icon={<AssignmentIcon size={18} />} iconPosition="start" label="采购 To-Do" />
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
              const marginPct = Math.round(((item.profitMargin || 1) - 1) * 100);
              const itemSubtotal = (item.unitPrice || 0) * item.qty;
              const costSubtotal = (item.unitCost || 0) * item.qty;
              return (
                <Box key={item.id} sx={{ mb: 3 }}>
                  <Box display="flex" alignItems="center" gap={1} mb={0.5} flexWrap="wrap">
                    <Typography fontWeight={700}>{item.recipeName}</Typography>
                    {item.spec && <Chip label={item.spec} size="small" variant="outlined" />}
                    <Chip label={`×${item.qty} 台`} color="primary" size="small" />
                  </Box>
                  <Box display="flex" gap={2} mb={1} flexWrap="wrap">
                    <Typography variant="caption" color="text.secondary">
                      成本 ¥{(item.unitCost || 0).toFixed(2)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      利润率 {marginPct}%
                    </Typography>
                    <Typography variant="caption" color="primary.main" fontWeight={600}>
                      出厂价 ¥{(item.unitPrice || 0).toFixed(2)}
                    </Typography>
                    <Typography variant="caption" fontWeight={600}>
                      小计 ¥{costSubtotal.toFixed(2)} → ¥{itemSubtotal.toFixed(2)}
                    </Typography>
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

            {/* 订单汇总 */}
            <Box sx={{ mt: 1, p: 2, bgcolor: 'primary.50', borderRadius: 2, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <Typography variant="body2">
                总成本: <b>¥{(localOrder.totalCost || 0).toFixed(2)}</b>
              </Typography>
              <Typography variant="body2" color="primary.main">
                总出厂价: <b>¥{(localOrder.totalPrice || 0).toFixed(2)}</b>
              </Typography>
              <Typography variant="body2" color={(localOrder.totalProfit || 0) >= 0 ? 'success.main' : 'error.main'}>
                总利润: <b>¥{(localOrder.totalProfit || 0).toFixed(2)}</b>
                {(localOrder.totalCost || 0) > 0 && (
                  <span> ({Math.round((localOrder.totalProfit || 0) / localOrder.totalCost * 100)}%)</span>
                )}
              </Typography>
            </Box>
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
                          <WarningIcon size={14} color={p.purchased ? 'var(--success)' : 'var(--error)'} />
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
                          <CheckCircleIcon size={14} color="var(--success)" />
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
                        <CheckCircleIcon size={18} color="rgba(34,197,94,0.6)" />
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
                <CheckCircleIcon size={48} color="rgba(34,197,94,0.6)" style={{ marginBottom: 8, display: 'block', marginInline: 'auto' }} />
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
            startIcon={confirming ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon size={20} />}
            onClick={() => setConfirmOpen(true)}
            disabled={confirming}
          >
            确认采购完成并入库
          </Button>
        )}

        {/* 入库确认对话框 */}
        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs">
          <DialogTitle>确认入库</DialogTitle>
          <DialogContent>
            <Typography>确认所有采购已完成？将把需采购数量加入库存。</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmOpen(false)}>取消</Button>
            <Button variant="contained" color="success" onClick={handleConfirmPurchase}>确认入库</Button>
          </DialogActions>
        </Dialog>
        {localOrder.status === '已完成' && (
          <Chip label="✅ 已入库完成" color="success" />
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose} variant="outlined">关闭</Button>
      </DialogActions>
    </Dialog>
  );
}
