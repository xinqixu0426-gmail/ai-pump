import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
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
  Skeleton,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  ShoppingCart as OrderIcon,
  FileText as RecipeIcon,
  Wrench as PartIcon,
  BadgeDollarSign as MoneyIcon,
  RefreshCw as RefreshIcon,
  Plus as AddIcon,
  ArrowRight as ArrowForwardIcon,
  CheckCircle as CheckIcon,
  Hourglass as PendingIcon,
  Truck as ShippingIcon,
  Package as InventoryIcon,
  PackageCheck as PackageCheckIcon,
  Zap as BoltIcon,
  Compass as ArchitectureIcon,
  AlertTriangle as AlertIcon,
  Store as StoreIcon,
} from 'lucide-react';
import { Order, OrderStatus } from '../types';
import { useAppStore } from '../utils/store';
import OrderDetailModal from '../components/OrderDetailModal';
import PageHeader from '../components/PageHeader';
import { formatDate } from '../utils/format';
import { colors, gradients } from '../utils/theme';

// ─── 状态配置 ─────────────────────────────────────────
const STATUS_CONFIG: Record<OrderStatus, { color: string; bg: string; icon: React.ReactNode; gradient: string }> = {
  待采购: {
    color: colors.amber.main,
    bg: 'rgba(245, 158, 11, 0.08)',
    icon: <PendingIcon />,
    gradient: gradients.pending,
  },
  采购中: {
    color: colors.blue.main,
    bg: 'rgba(59, 130, 246, 0.08)',
    icon: <ShippingIcon />,
    gradient: gradients.processing,
  },
  已完成: {
    color: colors.green.main,
    bg: 'rgba(16, 185, 129, 0.08)',
    icon: <CheckIcon />,
    gradient: gradients.completed,
  },
};

const DEFAULT_STATUS_CONFIG = {
  color: colors.slate.text,
  bg: 'rgba(0,0,0,0.04)',
  icon: <PendingIcon />,
  gradient: gradients.pending,
};

const STATUSES: OrderStatus[] = ['待采购', '采购中', '已完成'];

import StatCard from '../components/StatCard';

interface WorkbenchItem {
  label: string;
  count: number;
  desc: string;
  path: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
}

function sameLocalDay(value?: string) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function WorkbenchItemRow({ item, onClick }: { item: WorkbenchItem; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'grid',
        gridTemplateColumns: '36px 1fr auto',
        alignItems: 'center',
        gap: 1.5,
        py: 1.25,
        px: 1,
        borderRadius: 2,
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
        '&:hover': { bgcolor: 'rgba(15,23,42,0.035)' },
      }}
    >
      <Avatar sx={{ width: 36, height: 36, bgcolor: item.bg, color: item.color }}>
        {item.icon}
      </Avatar>
      <Box minWidth={0}>
        <Typography variant="body2" fontWeight={700}>{item.label}</Typography>
        <Typography variant="caption" color="text.secondary">{item.desc}</Typography>
      </Box>
      <Chip
        label={item.count}
        size="small"
        sx={{ bgcolor: item.bg, color: item.color, fontWeight: 800, minWidth: 34 }}
      />
    </Box>
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
  const config = STATUS_CONFIG[order.status] ?? DEFAULT_STATUS_CONFIG;



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
          transition: 'all 0.2s ease',
          '&:hover': {
            borderColor: config.color,
            boxShadow: `0 4px 12px ${config.bg}`,
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
          <ArrowForwardIcon size={14} color="var(--border)" />
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
        minWidth: { xs: '100%', md: 280 },
        maxWidth: { xs: '100%', md: 420 },
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
            '& > svg': { width: 16, height: 16, color: '#fff' },
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
            <InventoryIcon size={40} style={{ marginBottom: 8, opacity: 0.2 }} />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>暂无订单</Typography>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
              点击右上角 + 新建
            </Typography>
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
  const { orders: rawOrders, recipes, parts, fetchAll } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const orders = useMemo(() =>
    [...rawOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [rawOrders]
  );

  const load = useCallback(async (force = false) => {
    try {
      setLoading(true);
      await fetchAll(force);
    } catch (err) {
      console.error('看板加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    load(true);
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
      const stock = p.stock;
      return stock <= 5 && stock >= 0;
    }).length;
    return { totalRevenue, totalProfit, pendingCount, lowStockParts };
  }, [orders, ordersByStatus, parts]);

  const trends = useMemo(() => {
    const chronological = [...orders].reverse();
    const revTrend = chronological.map((o, i) => ({ name: String(i), value: o.totalPrice || 0 })).slice(-15);
    const profTrend = chronological.map((o, i) => ({ name: String(i), value: o.totalProfit || 0 })).slice(-15);
    return { revTrend, profTrend };
  }, [orders]);

  const workbench = useMemo(() => {
    const activeOrders = orders.filter(order => order.status !== '已完成');
    const purchaseOrders = activeOrders.filter(order =>
      order.purchaseList.some(item => Number(item.needToBuy || 0) > 0 && !item.purchased)
    );
    const readyToReceiveOrders = activeOrders.filter(order => {
      const needItems = order.purchaseList.filter(item => Number(item.needToBuy || 0) > 0);
      return needItems.length > 0 && needItems.every(item => item.purchased);
    });
    const outOfStockParts = parts.filter(part => Number(part.stock || 0) <= 0);
    const lowStockParts = parts.filter(part => Number(part.stock || 0) > 0 && Number(part.stock || 0) <= 5);
    const todayOrders = orders.filter(order => sameLocalDay(order.createdAt));

    const supplierMap = new Map<string, { supplier: string; pending: number; orderIds: Set<string> }>();
    for (const order of purchaseOrders) {
      for (const item of order.purchaseList) {
        if (Number(item.needToBuy || 0) <= 0 || item.purchased) continue;
        const supplier = item.supplier?.trim() || '未指定供应商';
        const current = supplierMap.get(supplier) || { supplier, pending: 0, orderIds: new Set<string>() };
        current.pending += Number(item.needToBuy || 0);
        current.orderIds.add(order.id);
        supplierMap.set(supplier, current);
      }
    }

    const supplierFocus = [...supplierMap.values()]
      .sort((a, b) => b.pending - a.pending)
      .slice(0, 5);

    const items: WorkbenchItem[] = [
      {
        label: '待采购',
        count: purchaseOrders.length,
        desc: '订单中仍有未采购零件',
        path: '/purchase',
        icon: <ShippingIcon size={18} />,
        color: colors.amber.text,
        bg: colors.amber.bg,
      },
      {
        label: '可确认入库',
        count: readyToReceiveOrders.length,
        desc: '采购项已勾选完成，需订单内确认入库',
        path: '/orders',
        icon: <PackageCheckIcon size={18} />,
        color: colors.green.text,
        bg: colors.green.bg,
      },
      {
        label: '缺货零件',
        count: outOfStockParts.length,
        desc: `另有 ${lowStockParts.length} 个低库存零件`,
        path: '/parts',
        icon: <AlertIcon size={18} />,
        color: colors.red.text,
        bg: colors.red.bg,
      },
      {
        label: '今日新增订单',
        count: todayOrders.length,
        desc: '今天录入或转化的订单',
        path: '/orders',
        icon: <OrderIcon size={18} />,
        color: colors.blue.text,
        bg: colors.blue.bg,
      },
    ];

    return {
      items,
      supplierFocus,
    };
  }, [orders, parts]);

  const handleDetail = (order: Order) => setSelectedOrder(order);

  return (
    <Box>
      {/* 页面标题 */}
      <PageHeader
        title="运营看板"
        subtitle="实时掌握订单与库存动态"
        actions={
          <>
            <Tooltip title="新建订单">
              <IconButton onClick={() => navigate('/order-form')} sx={{ bgcolor: 'primary.main', color: 'white', '&:hover': { bgcolor: 'primary.dark' }, boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)' }}>
                <AddIcon size={24} />
              </IconButton>
            </Tooltip>
            <Tooltip title="刷新数据">
              <span>
                <IconButton onClick={() => load(true)} disabled={loading}>
                  {loading ? <CircularProgress size={20} /> : <RefreshIcon size={24} />}
                </IconButton>
              </span>
            </Tooltip>
          </>
        }
      />

      {loading ? (
        <Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(5, 1fr)' }, gap: 2, mb: 4 }}>
            {[...Array(5)].map((_, i) => <Skeleton key={i} variant="rounded" height={100} sx={{ borderRadius: 3 }} />)}
          </Box>
          <Box sx={{ display: 'flex', gap: 2.5, flexDirection: { xs: 'column', md: 'row' } }}>
            {[...Array(3)].map((_, i) => <Skeleton key={i} variant="rounded" height={300} sx={{ flex: 1, borderRadius: 3 }} />)}
          </Box>
        </Box>
      ) : (
        <>

      {/* KPI 统计面板 */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(5, 1fr)' },
          gap: 2,
          mb: 4,
        }}
      >
        <StatCard
          label="订单总数"
          value={orders.length}
          subtitle={`进行中 ${kpis.pendingCount} 单`}
          icon={<OrderIcon size={22} />}
          gradient={gradients.orders}
          delay={0}
        />
        <StatCard
          label="配方数量"
          value={recipes.length}
          subtitle="已录入配方"
          icon={<RecipeIcon size={22} />}
          gradient={gradients.recipes}
          delay={1}
        />
        <StatCard
          label="零件种类"
          value={parts.length}
          subtitle={`低库存 ${kpis.lowStockParts} 项`}
          icon={<PartIcon size={22} />}
          gradient={gradients.parts}
          delay={2}
        />
        <StatCard
          label="总营收"
          value={`¥${(kpis.totalRevenue / 10000).toFixed(1)}w`}
          subtitle="订单出厂价合计"
          icon={<MoneyIcon size={22} />}
          gradient={gradients.revenue}
          delay={3}
          chartData={trends.revTrend}
          chartColor={colors.blue.main}
        />
        <StatCard
          label="总利润"
          value={`¥${(kpis.totalProfit / 10000).toFixed(1)}w`}
          subtitle={kpis.totalRevenue > 0 ? `利润率 ${((kpis.totalProfit / kpis.totalRevenue) * 100).toFixed(1)}%` : '-'}
          icon={<TrendingUpIcon size={22} />}
          gradient={gradients.profit}
          delay={4}
          chartData={trends.profTrend}
          chartColor={colors.green.main}
        />
      </Box>

      {/* 今日工作台 */}
      <Paper elevation={0} sx={{ p: 3, borderRadius: 3, mb: 3 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} mb={2}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              今日工作台
            </Typography>
            <Typography variant="body2" color="text.secondary">
              优先处理采购、入库和库存异常
            </Typography>
          </Box>
          <Button
            variant="outlined"
            size="small"
            endIcon={<ArrowForwardIcon size={16} />}
            onClick={() => navigate('/purchase')}
          >
            进入采购中心
          </Button>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.1fr 0.9fr' }, gap: 3 }}>
          <Box>
            {workbench.items.map((item) => (
              <WorkbenchItemRow key={item.label} item={item} onClick={() => navigate(item.path)} />
            ))}
          </Box>

          <Box sx={{
            borderLeft: { xs: 'none', md: '1px solid' },
            borderTop: { xs: '1px solid', md: 'none' },
            borderColor: 'divider',
            pl: { xs: 0, md: 3 },
            pt: { xs: 2, md: 0 },
          }}>
            <Box display="flex" alignItems="center" gap={1} mb={1.5}>
              <StoreIcon size={18} />
              <Typography variant="subtitle2" fontWeight={700}>采购关注供应商</Typography>
            </Box>
            {workbench.supplierFocus.length > 0 ? (
              <Box display="flex" flexDirection="column" gap={1}>
                {workbench.supplierFocus.map((supplier) => (
                  <Box key={supplier.supplier} display="flex" alignItems="center" gap={1}>
                    <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
                      {supplier.supplier}
                    </Typography>
                    <Chip size="small" label={`${supplier.orderIds.size} 单`} variant="outlined" />
                    <Chip size="small" label={`待采 ${supplier.pending}`} color="warning" variant="outlined" />
                  </Box>
                ))}
              </Box>
            ) : (
              <Box sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
                <CheckIcon size={32} style={{ opacity: 0.35, marginBottom: 6 }} />
                <Typography variant="body2">暂无待采购事项</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Paper>

      {/* 快捷操作栏 */}
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          borderRadius: 3,
          mb: 3,
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
          快捷操作
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(6, 1fr)' },
            gap: 2,
          }}
        >
          {[
            { label: '新建订单', icon: <AddIcon size={22} />, gradient: gradients.orders, path: '/order-form' },
            { label: '采购中心', icon: <ShippingIcon size={22} />, gradient: gradients.processing, path: '/purchase' },
            { label: '新建配方', icon: <RecipeIcon size={22} />, gradient: gradients.recipes, path: '/recipe-form' },
            { label: '新增零件', icon: <PartIcon size={22} />, gradient: gradients.parts, path: '/parts' },
            { label: '线圈管理', icon: <BoltIcon size={22} />, gradient: gradients.revenue, path: '/coils' },
            { label: '转子绘图', icon: <ArchitectureIcon size={22} />, gradient: gradients.profit, path: '/rotor' },
            { label: '泵壳模板', icon: <InventoryIcon size={22} />, gradient: gradients.pending, path: '/recipes' },
          ].map((item) => (
            <Box
              key={item.label}
              onClick={() => navigate(item.path)}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                py: 1.5,
                borderRadius: 2.5,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                '&:hover': {
                  bgcolor: 'rgba(0,0,0,0.02)',
                },
                '&:active': { transform: 'scale(0.97)' },
              }}
            >
              <Avatar
                sx={{
                  width: 48,
                  height: 48,
                  background: item.gradient,
                  '& > svg': { width: 22, height: 22, color: '#fff' },
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              >
                {item.icon}
              </Avatar>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.75rem' }}>
                {item.label}
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>

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
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            订单看板
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
            flexDirection: { xs: 'column', md: 'row' },
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
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            最近动态
          </Typography>
          <Chip
            label="查看全部"
            size="small"
            clickable
            onClick={() => navigate('/orders')}
            sx={{ fontWeight: 600 }}
            icon={<ArrowForwardIcon size={14} />}
          />
        </Box>

        {orders.slice(0, 8).map((order, idx) => {
          const config = STATUS_CONFIG[order.status] ?? DEFAULT_STATUS_CONFIG;
          return (
            <Fade key={order.id} in timeout={300 + idx * 100}>
              <Box>
                <Box
                  onClick={() => handleDetail(order)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
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
                  <Box flex={1} minWidth={0} sx={{ flexBasis: { xs: '100%', sm: 'auto' } }}>
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
                  <Typography variant="caption" sx={{ color: 'text.disabled', whiteSpace: 'nowrap', width: { xs: '100%', sm: 'auto' }, textAlign: { xs: 'left', sm: 'right' }, pl: { xs: 6, sm: 0 }, mt: { xs: -1, sm: 0 } }}>
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
      </>
      )}

      {/* 订单详情弹窗 */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdated={() => {
            load(true);
            setSelectedOrder(null);
          }}
        />
      )}
    </Box>
  );
}
