import { useEffect, useState, type MouseEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Badge, Box, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import {
  BrainCircuit,
  ChevronDown,
  ClipboardList,
  Cpu,
  FileText,
  LayoutDashboard,
  PenTool,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
} from 'lucide-react';
import GlobalSearch from './GlobalSearch';
import { useAppStore } from '../utils/store';
import { outOfStockPartCount, pendingPurchaseItemCount } from '../utils/dashboardRules';

interface NavItem {
  label: string;
  icon: LucideIcon;
  path: string;
  desc?: string;
  matchPaths?: string[];
}

interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  path?: string;
  matchPaths?: string[];
  children?: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  { key: 'dashboard', label: '运营', icon: LayoutDashboard, path: '/' },
  {
    key: 'sales',
    label: '订单',
    icon: ShoppingCart,
    children: [
      { label: '订单管理', desc: '生产订单与入库进度', icon: ShoppingCart, path: '/orders', matchPaths: ['/order-form'] },
      { label: '报价单', desc: '报价核算与转订单', icon: FileText, path: '/quotations' },
      { label: '客户管理', desc: '客户档案与默认加价', icon: Users, path: '/customers' },
    ],
  },
  { key: 'purchase', label: '采购', icon: ClipboardList, path: '/purchase' },
  {
    key: 'bom',
    label: '成本BOM',
    icon: Receipt,
    children: [
      { label: '配方管理', desc: '水泵 BOM 与成本配方', icon: Receipt, path: '/recipes', matchPaths: ['/recipe-form'] },
      { label: '零件管理', desc: '零件价格、库存、供应商', icon: Settings, path: '/parts' },
      { label: '线圈转子', desc: '线圈规格和转子数据', icon: Cpu, path: '/coils' },
    ],
  },
  {
    key: 'tools',
    label: '工具',
    icon: PenTool,
    children: [
      { label: '转子出图', desc: '转子参数计算与图纸', icon: PenTool, path: '/rotor' },
      { label: 'AI 助手', desc: '语音和文本业务助手', icon: BrainCircuit, path: '/ai' },
    ],
  },
];

function PumpLogo() {
  return (
    <Box
      component="svg"
      viewBox="0 0 48 48"
      aria-hidden="true"
      sx={{ width: 31, height: 31, display: 'block' }}
    >
      <path
        d="M10 29
           C11.2 19.8 17.7 13 24 13
           C30.3 13 36.8 19.8 38 29
           C34.6 26.4 31.2 26.4 27.8 29
           C25.3 30.9 22.7 30.9 20.2 29
           C16.8 26.4 13.4 26.4 10 29Z"
        fill="#fff"
      />
      <path
        d="M10 29
           C13.4 26.4 16.8 26.4 20.2 29
           C22.7 30.9 25.3 30.9 27.8 29
           C31.2 26.4 34.6 26.4 38 29"
        fill="none"
        stroke="#05070d"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    </Box>
  );
}

export default function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orders, parts, fetchOrders, fetchParts } = useAppStore();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);

  const openGroup = NAV_GROUPS.find(group => group.key === openGroupKey);
  const pendingPurchaseCount = pendingPurchaseItemCount(orders);
  const outOfStockCount = outOfStockPartCount(parts);

  useEffect(() => {
    fetchOrders();
    fetchParts();
  }, [fetchOrders, fetchParts]);

  const isActive = (item: NavItem) => {
    if (location.pathname === item.path) return true;
    if (item.matchPaths?.some(p => location.pathname.startsWith(p))) return true;
    return false;
  };

  const isGroupActive = (group: NavGroup) => {
    if (group.path && location.pathname === group.path) return true;
    if (group.matchPaths?.some(p => location.pathname.startsWith(p))) return true;
    return group.children?.some(isActive) ?? false;
  };

  const activeGroup = NAV_GROUPS.find(isGroupActive);
  const activeGroupChildren = activeGroup?.children || [];

  const handleGroupClick = (event: MouseEvent<HTMLElement>, group: NavGroup) => {
    if (!group.children?.length) {
      if (group.path) navigate(group.path);
      return;
    }
    setMenuAnchor(event.currentTarget);
    setOpenGroupKey(group.key);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setOpenGroupKey(null);
  };

  const handleMenuNavigate = (path: string) => {
    handleMenuClose();
    navigate(path);
  };

  const groupBadge = (key: string) => {
    if (key === 'purchase') return pendingPurchaseCount;
    if (key === 'bom') return outOfStockCount;
    return 0;
  };

  return (
    <Box sx={{
      position: 'sticky',
      top: 0,
      zIndex: 40,
      py: 2,
      px: { xs: 2, md: 3 },
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      background: 'rgba(248, 250, 252, 0.78)',
      borderBottom: '1px solid var(--border)',
    }}>
      <Box sx={{ maxWidth: 1360, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          {/* Brand */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{
              width: 44, height: 44, borderRadius: '12px',
              background: '#05070d',
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 10px 22px rgba(15, 23, 42, 0.18)',
              fontWeight: 700,
              position: 'relative',
              overflow: 'hidden',
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: 1,
                borderRadius: '11px',
                border: '1px solid rgba(255,255,255,0.12)',
              },
            }}>
              <PumpLogo />
            </Box>
            <Box sx={{ display: { xs: 'none', lg: 'block' } }}>
              <Typography sx={{ m: 0, fontSize: 20, fontWeight: 700, letterSpacing: 0 }}>
                水泵BOM
              </Typography>
              <Typography sx={{ m: 0, color: 'text.secondary', fontSize: 12, fontWeight: 600 }}>
                智能管理系统
              </Typography>
            </Box>
          </Box>

          {/* Nav Pills */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.5, p: '5px',
            border: '1px solid var(--border)', borderRadius: 999,
            background: 'rgba(241, 245, 249, 0.95)',
            overflowX: 'auto',
            maxWidth: '100%',
            '&::-webkit-scrollbar': { display: 'none' }
          }}>
            {NAV_GROUPS.map((group) => {
              const Icon = group.icon;
              const active = isGroupActive(group);
              const hasChildren = Boolean(group.children?.length);
              const badge = groupBadge(group.key);
              return (
                <Box
                  key={group.key}
                  component="button"
                  type="button"
                  aria-label={group.label}
                  aria-haspopup={hasChildren ? 'menu' : undefined}
                  aria-expanded={hasChildren && openGroupKey === group.key ? 'true' : undefined}
                  onClick={(event) => handleGroupClick(event, group)}
                  sx={{
                    appearance: 'none',
                    border: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
                    minWidth: { xs: 42, md: 82 },
                    py: { xs: 1.25, sm: 1.25 }, px: { xs: 1.25, sm: 1.75 },
                    borderRadius: 999,
                    cursor: 'pointer',
                    color: active ? '#fff' : 'text.secondary',
                    bgcolor: active ? 'var(--dark)' : 'transparent',
                    fontWeight: 700,
                    fontSize: 14,
                    transition: '0.2s ease',
                    boxShadow: active ? '0 2px 8px rgba(15, 23, 42, 0.15)' : 'none',
                    flexShrink: 0,
                    '&:hover': {
                      bgcolor: active ? 'var(--dark)' : 'rgba(255, 255, 255, 0.9)',
                      color: active ? '#fff' : 'var(--text)',
                    }
                  }}
                >
                  <Badge
                    badgeContent={badge > 0 ? badge : 0}
                    color={group.key === 'bom' ? 'error' : 'warning'}
                    invisible={badge <= 0}
                    max={99}
                    sx={{
                      '& .MuiBadge-badge': {
                        minWidth: 16,
                        height: 16,
                        px: 0.5,
                        fontSize: 10,
                        fontWeight: 800,
                      },
                    }}
                  >
                    <Icon size={16} />
                  </Badge>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                    {group.label}
                  </Box>
                  {hasChildren && (
                    <ChevronDown size={14} />
                  )}
                </Box>
              );
            })}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: { xs: 38, md: 48 } }}>
            <GlobalSearch />
          </Box>
        </Box>

        {activeGroupChildren.length > 0 && (
          <Box sx={{
            mt: 1.5,
            display: 'flex',
            justifyContent: { xs: 'flex-start', md: 'center' },
            overflowX: 'auto',
            '&::-webkit-scrollbar': { display: 'none' },
          }}>
            <Box sx={{
              display: 'flex',
              gap: 0.75,
              p: 0.5,
              borderRadius: 999,
              bgcolor: 'rgba(255, 255, 255, 0.72)',
              border: '1px solid rgba(226, 232, 240, 0.9)',
            }}>
              {activeGroupChildren.map((item) => {
                const Icon = item.icon;
                const active = isActive(item);
                return (
                  <Box
                    key={item.path}
                    component="button"
                    type="button"
                    aria-label={item.label}
                    onClick={() => navigate(item.path)}
                    sx={{
                      appearance: 'none',
                      border: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      px: { xs: 1.25, sm: 1.5 },
                      py: 0.75,
                      borderRadius: 999,
                      bgcolor: active ? '#fff' : 'transparent',
                      color: active ? 'var(--text)' : 'text.secondary',
                      boxShadow: active ? '0 2px 8px rgba(15, 23, 42, 0.08)' : 'none',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: active ? 800 : 700,
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        bgcolor: '#fff',
                        color: 'var(--text)',
                      },
                    }}
                  >
                    <Icon size={14} />
                    {item.label}
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={handleMenuClose}
          MenuListProps={{ dense: true }}
          PaperProps={{
            sx: {
              mt: 1,
              minWidth: 168,
              borderRadius: 2,
              border: '1px solid var(--border)',
              boxShadow: '0 16px 40px rgba(15, 23, 42, 0.14)',
            },
          }}
        >
          {openGroup?.children?.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <MenuItem
                key={item.path}
                selected={active}
                onClick={() => handleMenuNavigate(item.path)}
                sx={{
                  mx: 0.75,
                  my: 0.25,
                  borderRadius: 1.5,
                  fontWeight: active ? 800 : 600,
                }}
              >
                <ListItemIcon sx={{ minWidth: 32, color: active ? 'primary.main' : 'text.secondary' }}>
                  <Icon size={17} />
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  secondary={item.desc}
                  primaryTypographyProps={{ fontSize: 14, fontWeight: active ? 800 : 600 }}
                  secondaryTypographyProps={{ fontSize: 12 }}
                />
              </MenuItem>
            );
          })}
        </Menu>
      </Box>
    </Box>
  );
}
