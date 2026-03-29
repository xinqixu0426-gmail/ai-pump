import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Avatar,
  LinearProgress,
  Fade,
  Divider,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  ShoppingCart as OrderIcon,
  Receipt as RecipeIcon,
  Build as PartIcon,
  AttachMoney as MoneyIcon,
  Refresh as RefreshIcon,
  Add as AddIcon,
  ArrowForward as ArrowForwardIcon,
  CheckCircleOutline as CheckIcon,
  HourglassEmpty as PendingIcon,
  LocalShipping as ShippingIcon,
  Inventory as InventoryIcon,
} from '@mui/icons-material';
import { Order, OrderStatus, Recipe, Part } from '../types';
import { getAllOrders } from '../utils/orderStore';
import { getAllRecipes, getAllParts } from '../utils/api';
import OrderDetailModal from '../components/OrderDetailModal';

// ─── 状态配置 ─────────────────────────────────────────
const STATUS_CONFIG: Record<OrderStatus, { color: string; bg: string; icon: React.ReactNode; gradient: string }> = {
  待采购: {
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.08)',
    icon: <PendingIcon />,
    gradient: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
  },
  采购中: {
    color: '#3b82f6',
    bg: 'rgba(59, 130, 246, 0.08)',
    icon: <ShippingIcon />,
    gradient: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
  },
  已完成: {
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.08)',
    icon: <CheckIcon />,
    gradient: 'linear-gradient(135deg, #34d399 0%, #10b981 100%)',
  },
};

const STATUSES: OrderStatus[] = ['待采购', '采购中', '已完成'];

// ─── KPI 卡片组件 ──────────────────────────────────────
interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  gradient: string;
  delay: number;
}

function KpiCard({ title, value, subtitle, icon, gradient, delay }: KpiCardProps) {
  return (
    <Fade in timeout={400 + delay * 150}>
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          borderRadius: 3,
          position: 'relative',
          overflow: 'hidden',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
          },
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: gradient,
          },
        }}
      >
        <Box display="flex" alignItems="flex-start" justifyContent="space-between">
          <Box>
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', fontSize: '0.7rem' }}
            >
              {title}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, mt: 0.5, letterSpacing: -0.5 }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          <Avatar
            sx={{
              background: gradient,
              width: 44,
              height: 44,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
          >
            {icon}
          </Avatar>
        </Box>
      </Paper>
    </Fade>
  );
}

// ─── 订单卡片组件 ──────────────────────────────────────
interface OrderCardProps {
  order: Order;
  onDetail: (order: Order) => void;
  index: number;
}

function OrderCard({ order, onDetail, index }: OrderCardProps) {
  const needCount = order.purchaseList.filter((p) => p.needToBuy > 0).length;
  const purchasedCount = order.purchaseList.filter((p) => p.needToBuy > 0 && p.purchased).length;
  const progress = needCount > 0 ? (purchasedCount / needCount) * 100 : 100;
  const config = STATUS_CONFIG[order.status];

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <Fade in timeout={300 + index * 80}>
      <Paper
        elevation={0}
        onClick={() => onDetail(order)}
        sx={{
          p: 2,
          mb: 1.5,
          borderRadius: 2.5,
          cursor: 'pointer',
          border: '1px solid',
          borderColor: 'divider',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            borderColor: config.color,
            transform: 'translateY(-2px)',
            boxShadow: `0 8px 24px ${config.bg}`,
          },
        }}
      >
        {/* 标题行 */}
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {order.customerName}
          </Typography>
          <Chip
            label={`${order.items.length}型号`}
            size="small"
            sx={{
              height: 22,
              fontSize: '0.7rem',
              fontWeight: 600,
              bgcolor: config.bg,
              color: config.color,
              border: 'none',
            }}
          />
        </Box>

        {/* 合同号 */}
        {order.contractNo && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
            合同号: {order.contractNo}
          </Typography>
        )}

        {/* 金额行 */}
        <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={1}>
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
              成本
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
              ¥{(order.totalCost || 0).toFixed(0)}
            </Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
              出厂价
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.main', fontSize: '0.8rem' }}>
              ¥{(order.totalPrice || 0).toFixed(0)}
            </Typography>
          </Box>
          <Box textAlign="right">
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
              利润
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                fontSize: '0.8rem',
                color: (order.totalProfit || 0) >= 0 ? 'success.main' : 'error.main',
              }}
            >
              ¥{(order.totalProfit || 0).toFixed(0)}
            </Typography>
          </Box>
        </Box>

        {/* 采购进度 */}
        {needCount > 0 && (
          <Box mb={0.5}>
            <Box display="flex" justifyContent="space-between" mb={0.3}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                采购进度
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', color: config.color }}>
                {purchasedCount}/{needCount}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={progress}
              sx={{
                height: 4,
                borderRadius: 2,
                bgcolor: 'rgba(0,0,0,0.04)',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 2,
                  background: config.gradient,
                },
              }}
            />
          </Box>
        )}

        {/* 底部时间 */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mt={1}>
          <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem' }}>
            {formatDate(order.createdAt)}
          </Typography>
          <ArrowForwardIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
        </Box>
      </Paper>
    </Fade>
  );
}

// ─── 看板列组件 ────────────────────────────────────────
interface KanbanColumnProps {
  status: OrderStatus;
  orders: Order[];
  onDetail: (order: Order) => void;
}

function KanbanColumn({ status, orders, onDetail }: KanbanColumnProps) {
  const config = STATUS_CONFIG[status];

  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 280,
        maxWidth: 420,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 列头 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          mb: 2,
          gap: 1,
        }}
      >
        <Avatar
          sx={{
            width: 32,
            height: 32,
            background: config.gradient,
            '& .MuiSvgIcon-root': { fontSize: 16 },
          }}
        >
          {config.icon}
        </Avatar>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {status}
        </Typography>
        <Chip
          label={orders.length}
          size="small"
          sx={{
            height: 22,
            minWidth: 28,
            fontWeight: 700,
            fontSize: '0.75rem',
            bgcolor: config.bg,
            color: config.color,
          }}
        />
      </Box>

      {/* 卡片容器 */}
      <Box
        sx={{
          flex: 1,
          bgcolor: 'rgba(0,0,0,0.015)',
          borderRadius: 3,
          p: 1.5,
          minHeight: 200,
          maxHeight: 'calc(100vh - 420px)',
          overflowY: 'auto',
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': {
            borderRadius: 4,
            bgcolor: 'rgba(0,0,0,0.1)',
          },
        }}
      >
        {orders.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 6,
              color: 'text.disabled',
            }}
          >
            <InventoryIcon sx={{ fontSize: 36, mb: 1, opacity: 0.3 }} />
            <Typography variant="caption">暂无订单</Typography>
          </Box>
        ) : (
          orders.map((order, idx) => (
            <OrderCard key={order.id} order={order} onDetail={onDetail} index={idx} />
          ))
        )}
      </Box>
    </Box>
  );
}

// ─── 主页面 ───────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [ordersData, recipesData, partsData] = await Promise.all([
        getAllOrders(),
        getAllRecipes(),
        getAllParts(),
      ]);
      setOrders(ordersData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setRecipes(recipesData);
      setParts(partsData);
    } catch (err) {
      console.error('看板加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 按状态分组
  const ordersByStatus = useMemo(() => {
    const map: Record<OrderStatus, Order[]> = { 待采购: [], 采购中: [], 已完成: [] };
    for (const o of orders) {
      if (map[o.status]) map[o.status].push(o);
      else map['待采购'].push(o);
    }
    return map;
  }, [orders]);

  // KPI 统计
  const kpis = useMemo(() => {
    const totalRevenue = orders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
    const totalProfit = orders.reduce((sum, o) => sum + (o.totalProfit || 0), 0);
    const pendingCount = ordersByStatus['待采购'].length + ordersByStatus['采购中'].length;
    const lowStockParts = parts.filter((p) => {
      const stock = Number(p.库存 ?? p.stock ?? 0);
      return stock <= 5 && stock >= 0;
    }).length;
    return { totalRevenue, totalProfit, pendingCount, lowStockParts };
  }, [orders, ordersByStatus, parts]);

  const handleDetail = (order: Order) => setSelectedOrder(order);

  return (
    <Box>
      {/* 页面标题 */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: -0.5 }}>
            📊 运营看板
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            实时掌握订单与库存动态
          </Typography>
        </Box>
        <Box display="flex" gap={1}>
          <Tooltip title="新建订单">
            <IconButton
              onClick={() => navigate('/order-form')}
              sx={{
                bgcolor: 'primary.main',
                color: 'white',
                '&:hover': { bgcolor: 'primary.dark' },
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
              }}
            >
              <AddIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="刷新数据">
            <IconButton onClick={load} disabled={loading}>
              {loading ? <CircularProgress size={20} /> : <RefreshIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* KPI 统计面板 */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, 1fr)' },
          gap: 2,
          mb: 4,
        }}
      >
        <KpiCard
          title="订单总数"
          value={orders.length}
          subtitle={`进行中 ${kpis.pendingCount} 单`}
          icon={<OrderIcon sx={{ fontSize: 22 }} />}
          gradient="linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
          delay={0}
        />
        <KpiCard
          title="配方数量"
          value={recipes.length}
          subtitle="已录入配方"
          icon={<RecipeIcon sx={{ fontSize: 22 }} />}
          gradient="linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)"
          delay={1}
        />
        <KpiCard
          title="零件种类"
          value={parts.length}
          subtitle={`低库存 ${kpis.lowStockParts} 项`}
          icon={<PartIcon sx={{ fontSize: 22 }} />}
          gradient="linear-gradient(135deg, #10b981 0%, #059669 100%)"
          delay={2}
        />
        <KpiCard
          title="总营收"
          value={`¥${(kpis.totalRevenue / 10000).toFixed(1)}w`}
          subtitle="订单出厂价合计"
          icon={<MoneyIcon sx={{ fontSize: 22 }} />}
          gradient="linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
          delay={3}
        />
        <KpiCard
          title="总利润"
          value={`¥${(kpis.totalProfit / 10000).toFixed(1)}w`}
          subtitle={kpis.totalRevenue > 0 ? `利润率 ${((kpis.totalProfit / kpis.totalRevenue) * 100).toFixed(1)}%` : '-'}
          icon={<TrendingUpIcon sx={{ fontSize: 22 }} />}
          gradient="linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)"
          delay={4}
        />
      </Box>

      {/* 看板主体 */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          borderRadius: 3,
          mb: 3,
        }}
      >
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            🗂️ 订单看板
          </Typography>
          <Chip
            label={`共 ${orders.length} 单`}
            size="small"
            variant="outlined"
            sx={{ fontWeight: 600 }}
          />
        </Box>

        <Box
          sx={{
            display: 'flex',
            gap: 2.5,
            overflowX: 'auto',
            pb: 1,
          }}
        >
          {STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              orders={ordersByStatus[status]}
              onDetail={handleDetail}
            />
          ))}
        </Box>
      </Paper>

      {/* 最近订单列表 */}
      <Paper elevation={0} sx={{ p: 3, borderRadius: 3 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            🕐 最近动态
          </Typography>
          <Chip
            label="查看全部"
            size="small"
            clickable
            onClick={() => navigate('/orders')}
            sx={{ fontWeight: 600 }}
            icon={<ArrowForwardIcon sx={{ fontSize: '14px !important' }} />}
          />
        </Box>

        {orders.slice(0, 8).map((order, idx) => {
          const config = STATUS_CONFIG[order.status];
          return (
            <Fade key={order.id} in timeout={300 + idx * 100}>
              <Box>
                <Box
                  onClick={() => handleDetail(order)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    py: 1.5,
                    px: 1,
                    borderRadius: 2,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    '&:hover': {
                      bgcolor: 'rgba(0,0,0,0.02)',
                    },
                  }}
                >
                  <Avatar
                    sx={{
                      width: 36,
                      height: 36,
                      background: config.gradient,
                      fontSize: '0.85rem',
                      fontWeight: 700,
                    }}
                  >
                    {order.customerName.charAt(0)}
                  </Avatar>
                  <Box flex={1} minWidth={0}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {order.customerName}
                      </Typography>
                      <Chip
                        label={order.status}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          bgcolor: config.bg,
                          color: config.color,
                        }}
                      />
                    </Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {order.contractNo ? `${order.contractNo} · ` : ''}
                      {order.items.length}个型号 · ¥{(order.totalPrice || 0).toFixed(0)}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.disabled', whiteSpace: 'nowrap' }}>
                    {new Date(order.createdAt).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </Typography>
                </Box>
                {idx < Math.min(orders.length, 8) - 1 && <Divider sx={{ opacity: 0.5 }} />}
              </Box>
            </Fade>
          );
        })}

        {orders.length === 0 && !loading && (
          <Box textAlign="center" py={4} color="text.secondary">
            <Typography variant="body2">暂无订单数据</Typography>
          </Box>
        )}
      </Paper>

      {/* 订单详情弹窗 */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdated={() => {
            load();
            setSelectedOrder(null);
          }}
        />
      )}
    </Box>
  );
}
