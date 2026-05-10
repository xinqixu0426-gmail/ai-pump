import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { LayoutDashboard, Settings, ShoppingCart, Receipt, Cpu, BrainCircuit, PenTool, Droplet, Users, FileText, ClipboardList } from 'lucide-react';
import GlobalSearch from './GlobalSearch';

interface NavItem {
  label: string;
  icon: any;
  path: string;
  matchPaths?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { label: '运营看板', icon: LayoutDashboard, path: '/' },
  { label: '零件管理', icon: Settings, path: '/parts' },
  { label: '配方管理', icon: Receipt, path: '/recipes', matchPaths: ['/recipe-form'] },
  { label: '订单管理', icon: ShoppingCart, path: '/orders', matchPaths: ['/order-form'] },
  { label: '采购中心', icon: ClipboardList, path: '/purchase' },
  { label: '线圈转子', icon: Cpu, path: '/coils' },
  { label: '客户管理', icon: Users, path: '/customers' },
  { label: '报价单', icon: FileText, path: '/quotations' },
  { label: 'AI 助手', icon: BrainCircuit, path: '/ai' },
  { label: '转子出图', icon: PenTool, path: '/rotor' },
];

export default function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (item: NavItem) => {
    if (location.pathname === item.path) return true;
    if (item.matchPaths?.some(p => location.pathname.startsWith(p))) return true;
    return false;
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
      <Box sx={{ maxWidth: 1360, mx: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        {/* Brand */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 38, height: 38, borderRadius: '10px',
            background: 'var(--dark)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)',
            fontWeight: 700,
          }}>
            <Droplet size={22} fill="currentColor" strokeWidth={0} />
          </Box>
          <Box sx={{ display: { xs: 'none', lg: 'block' } }}>
            <Typography sx={{ m: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
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
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <Box
                key={item.path}
                onClick={() => navigate(item.path)}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
                  minWidth: { xs: 'auto', md: 96 },
                  py: { xs: 1.25, sm: 1.25 }, px: { xs: 1.5, sm: 2 },
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
                <Icon size={16} />
                <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
                  {item.label}
                </Box>
              </Box>
            );
          })}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: { xs: 38, md: 48 } }}>
          <GlobalSearch />
        </Box>
      </Box>
    </Box>
  );
}
