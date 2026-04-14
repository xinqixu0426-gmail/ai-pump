import { useState, useCallback } from 'react';
import { Routes, Route } from 'react-router-dom';
import {
  Box,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';
import Sidebar, { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from './components/Sidebar';
import AppBreadcrumbs from './components/AppBreadcrumbs';
import DashboardPage from './pages/DashboardPage';
import PartsPage from './pages/PartsPage';
import RecipesPage from './pages/RecipesPage';
import RecipeFormPage from './pages/RecipeFormPage';
import OrdersPage from './pages/OrdersPage';
import OrderFormPage from './pages/OrderFormPage';
import CoilRotorPage from './pages/CoilRotorPage';
import AIChatPage from './pages/AIChatPage';
import RotorDrawingPage from './pages/RotorDrawingPage';

function App() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleToggleCollapse = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  const handleMobileOpen = useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const handleMobileClose = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const sidebarWidth = isMobile
    ? 0
    : sidebarCollapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : SIDEBAR_WIDTH;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleCollapse}
        onClose={handleMobileClose}
      />

      {/* Main content area */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: `calc(100% - ${sidebarWidth}px)`,
          transition: 'width 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
        }}
      >
        {/* Top bar — minimal */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: { xs: 2, md: 3 },
            py: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            minHeight: 52,
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          {isMobile && (
            <IconButton
              onClick={handleMobileOpen}
              edge="start"
              sx={{ mr: 1 }}
            >
              <MenuIcon />
            </IconButton>
          )}
          <AppBreadcrumbs />
          <Box sx={{ flex: 1 }} />
          <Typography
            variant="caption"
            sx={{ color: 'text.disabled', fontSize: '0.7rem' }}
          >
            v1.2
          </Typography>
        </Box>

        {/* Page content */}
        <Box
          sx={{
            flex: 1,
            px: { xs: 2, md: 3 },
            py: 3,
            overflow: 'auto',
            bgcolor: 'background.default',
          }}
        >
          <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/parts" element={<PartsPage />} />
              <Route path="/recipes" element={<RecipesPage />} />
              <Route path="/recipe-form" element={<RecipeFormPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/order-form" element={<OrderFormPage />} />
              <Route path="/order-form/:id" element={<OrderFormPage />} />
              <Route path="/coils" element={<CoilRotorPage />} />
              <Route path="/ai" element={<AIChatPage />} />
              <Route path="/rotor" element={<RotorDrawingPage />} />
            </Routes>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default App;