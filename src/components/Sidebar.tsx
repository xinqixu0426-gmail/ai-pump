import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  IconButton,
  Tooltip,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Build as BuildIcon,
  Receipt as ReceiptIcon,
  ShoppingCart as OrderIcon,
  Cable as CableIcon,
  SmartToy as AIIcon,
  Engineering as RotorIcon,
  ChevronLeft as CollapseIcon,
  ChevronRight as ExpandIcon,
} from '@mui/icons-material';
import { gradients } from '../utils/theme';

export const SIDEBAR_WIDTH = 240;
export const SIDEBAR_COLLAPSED_WIDTH = 68;

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
  matchPaths?: string[]; // additional paths that should highlight this nav item
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: '业务管理',
    items: [
      { label: '运营看板', icon: <DashboardIcon />, path: '/' },
      { label: '零件管理', icon: <BuildIcon />, path: '/parts' },
      { label: '配方管理', icon: <ReceiptIcon />, path: '/recipes', matchPaths: ['/recipe-form'] },
      { label: '订单管理', icon: <OrderIcon />, path: '/orders', matchPaths: ['/order-form'] },
    ],
  },
  {
    title: '工具',
    items: [
      { label: '线圈转子', icon: <CableIcon />, path: '/coils' },
      { label: 'AI 助手',  icon: <AIIcon />, path: '/ai' },
      { label: '转子出图', icon: <RotorIcon />, path: '/rotor' },
    ],
  },
];

interface SidebarProps {
  open: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onClose: () => void;
}

export default function Sidebar({ open, collapsed, onToggleCollapse, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const isActive = (item: NavItem) => {
    if (location.pathname === item.path) return true;
    if (item.matchPaths) {
      return item.matchPaths.some(p => location.pathname.startsWith(p));
    }
    return false;
  };

  const handleNav = (path: string) => {
    navigate(path);
    if (isMobile) onClose();
  };

  const width = collapsed && !isMobile ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  const drawerContent = (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Brand header */}
      <Box sx={{
        px: collapsed && !isMobile ? 1 : 2.5,
        py: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed && !isMobile ? 'center' : 'space-between',
        minHeight: 64,
        background: gradients.brand,
      }}>
        {(!collapsed || isMobile) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{
              fontSize: '1.25rem',
              fontWeight: 800,
              color: 'white',
              letterSpacing: 0.5,
              lineHeight: 1.2,
            }}>
              💧 水泵BOM
            </Typography>
          </Box>
        )}
        {collapsed && !isMobile && (
          <Typography sx={{ fontSize: '1.4rem', lineHeight: 1 }}>💧</Typography>
        )}
      </Box>

      {/* Nav groups */}
      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', py: 1 }}>
        {NAV_GROUPS.map((group, gIdx) => (
          <Box key={group.title}>
            {gIdx > 0 && <Divider sx={{ my: 0.5 }} />}
            {(!collapsed || isMobile) && (
              <Typography
                variant="caption"
                sx={{
                  px: 2.5,
                  py: 1,
                  display: 'block',
                  fontWeight: 700,
                  fontSize: '0.65rem',
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  color: 'text.disabled',
                }}
              >
                {group.title}
              </Typography>
            )}
            <List disablePadding>
              {group.items.map((item) => {
                const active = isActive(item);
                return (
                  <ListItem key={item.path} disablePadding sx={{ px: 1, py: 0.25 }}>
                    <Tooltip title={collapsed && !isMobile ? item.label : ''} placement="right" arrow>
                      <ListItemButton
                        onClick={() => handleNav(item.path)}
                        sx={{
                          borderRadius: 2,
                          minHeight: 42,
                          justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
                          px: collapsed && !isMobile ? 1.5 : 2,
                          bgcolor: active ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                          color: active ? 'primary.main' : 'text.secondary',
                          '&:hover': {
                            bgcolor: active ? 'rgba(37, 99, 235, 0.12)' : 'rgba(0,0,0,0.04)',
                          },
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <ListItemIcon sx={{
                          minWidth: collapsed && !isMobile ? 'auto' : 36,
                          color: active ? 'primary.main' : 'text.secondary',
                          '& .MuiSvgIcon-root': { fontSize: 20 },
                        }}>
                          {item.icon}
                        </ListItemIcon>
                        {(!collapsed || isMobile) && (
                          <ListItemText
                            primary={item.label}
                            primaryTypographyProps={{
                              fontSize: '0.875rem',
                              fontWeight: active ? 700 : 500,
                            }}
                          />
                        )}
                        {/* Active indicator */}
                        {active && (
                          <Box sx={{
                            position: 'absolute',
                            left: 0,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: 3,
                            height: 20,
                            borderRadius: '0 4px 4px 0',
                            bgcolor: 'primary.main',
                          }} />
                        )}
                      </ListItemButton>
                    </Tooltip>
                  </ListItem>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      {/* Collapse toggle (desktop only) */}
      {!isMobile && (
        <Box sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
          p: 1,
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'flex-end',
        }}>
          <Tooltip title={collapsed ? '展开菜单' : '折叠菜单'} placement="right">
            <IconButton size="small" onClick={onToggleCollapse} sx={{ color: 'text.secondary' }}>
              {collapsed ? <ExpandIcon /> : <CollapseIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );

  // Mobile: temporary overlay drawer
  if (isMobile) {
    return (
      <Drawer
        variant="temporary"
        open={open}
        onClose={onClose}
        ModalProps={{ keepMounted: true }}
        PaperProps={{
          sx: {
            width: SIDEBAR_WIDTH,
            borderRight: 'none',
            boxShadow: '4px 0 24px rgba(0,0,0,0.08)',
          },
        }}
      >
        {drawerContent}
      </Drawer>
    );
  }

  // Desktop: persistent drawer
  return (
    <Drawer
      variant="permanent"
      open
      PaperProps={{
        sx: {
          width,
          borderRight: '1px solid',
          borderColor: 'divider',
          transition: 'width 0.2s ease',
          overflowX: 'hidden',
          bgcolor: 'background.paper',
        },
      }}
    >
      {drawerContent}
    </Drawer>
  );
}
