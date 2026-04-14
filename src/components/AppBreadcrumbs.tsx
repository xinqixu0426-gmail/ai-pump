import { useMemo } from 'react';
import { useLocation, Link as RouterLink } from 'react-router-dom';
import { Breadcrumbs, Link, Typography, Box } from '@mui/material';
import { NavigateNext as SepIcon } from '@mui/icons-material';

/**
 * Route → breadcrumb label mapping
 */
const ROUTE_LABELS: Record<string, string> = {
  '/': '运营看板',
  '/parts': '零件管理',
  '/recipes': '配方管理',
  '/recipe-form': '录入配方',
  '/orders': '订单管理',
  '/order-form': '新建订单',
  '/coils': '线圈转子',
  '/ai': 'AI 助手',
  '/rotor': '转子出图',
};

/**
 * Sub-route → parent mapping (for breadcrumb chain)
 */
const PARENT_MAP: Record<string, string> = {
  '/recipe-form': '/recipes',
  '/order-form': '/orders',
};

export default function AppBreadcrumbs() {
  const location = useLocation();

  const crumbs = useMemo(() => {
    const path = location.pathname;

    // Root page — no breadcrumb needed
    if (path === '/') return [];

    // Normalize: /order-form/123 → /order-form
    const basePath = path.replace(/\/\d+$/, '');
    const hasId = basePath !== path;

    const result: { label: string; href?: string }[] = [];

    // Add parent if exists
    const parentPath = PARENT_MAP[basePath];
    if (parentPath) {
      result.push({
        label: ROUTE_LABELS[parentPath] || parentPath,
        href: parentPath,
      });
    }

    // Current page
    let currentLabel = ROUTE_LABELS[basePath] || basePath.replace('/', '');

    // Special cases for edit mode
    if (basePath === '/order-form' && hasId) {
      currentLabel = '编辑订单';
    }
    if (basePath === '/recipe-form' && location.state) {
      const state = location.state as { editFrom?: unknown; cloneFrom?: unknown };
      if (state.editFrom) currentLabel = '编辑配方';
      else if (state.cloneFrom) currentLabel = '复制配方';
    }

    result.push({ label: currentLabel });

    return result;
  }, [location.pathname, location.state]);

  if (crumbs.length === 0) return null;

  return (
    <Box sx={{ display: { xs: 'none', sm: 'block' }, mb: 1 }}>
      <Breadcrumbs
        separator={<SepIcon sx={{ fontSize: 16 }} />}
        sx={{
          '& .MuiBreadcrumbs-li': { fontSize: '0.8rem' },
          '& .MuiBreadcrumbs-separator': { mx: 0.5 },
        }}
      >
        {crumbs.map((crumb, idx) => {
          const isLast = idx === crumbs.length - 1;
          if (isLast || !crumb.href) {
            return (
              <Typography
                key={idx}
                variant="body2"
                sx={{
                  fontWeight: 600,
                  color: 'text.primary',
                  fontSize: '0.8rem',
                }}
              >
                {crumb.label}
              </Typography>
            );
          }
          return (
            <Link
              key={idx}
              component={RouterLink}
              to={crumb.href}
              underline="hover"
              color="text.secondary"
              sx={{ fontSize: '0.8rem', fontWeight: 500 }}
            >
              {crumb.label}
            </Link>
          );
        })}
      </Breadcrumbs>
    </Box>
  );
}
