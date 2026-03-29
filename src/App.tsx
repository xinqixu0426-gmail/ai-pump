import { useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import {
  AppBar,
  Toolbar,
  Typography,
  Tabs,
  Tab,
  Box,
  Container
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Build as BuildIcon,
  Receipt as ReceiptIcon,
  ShoppingCart as OrderIcon,
  SmartToy as SmartToyIcon
} from '@mui/icons-material';
import DashboardPage from './pages/DashboardPage';
import PartsPage from './pages/PartsPage';
import RecipesPage from './pages/RecipesPage';
import RecipeFormPage from './pages/RecipeFormPage';
import OrdersPage from './pages/OrdersPage';
import OrderFormPage from './pages/OrderFormPage';
import AgentConfigPage from './pages/AgentConfigPage';
import AIChat from './components/AIChat';

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  // 根据当前路径确定选中的 tab
  const getTabValue = (path: string) => {
    if (path === '/') return 0;
    if (path === '/parts') return 1;
    if (path === '/recipes' || path === '/recipe-form') return 2;
    if (path === '/orders' || path === '/order-form') return 3;
    if (path === '/agent-config') return 4;
    return 0;
  };

  const [tabValue, setTabValue] = useState(getTabValue(location.pathname));

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    switch (newValue) {
      case 0:
        navigate('/');
        break;
      case 1:
        navigate('/parts');
        break;
      case 2:
        navigate('/recipes');
        break;
      case 3:
        navigate('/orders');
        break;
      case 4:
        navigate('/agent-config');
        break;
    }
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* 顶部导航栏 */}
      <AppBar position="static" elevation={0} sx={{
        background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 50%, #3b82f6 100%)',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" component="div" sx={{ 
            flexGrow: 1, 
            letterSpacing: 1,
            fontWeight: 800,
            textShadow: '0 1px 2px rgba(0,0,0,0.1)'
          }}>
            💧 水泵BOM管理系统
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            v1.2
          </Typography>
        </Toolbar>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          textColor="inherit"
          indicatorColor="secondary"
          sx={{ 
            px: 3,
            '& .MuiTab-root': { 
              fontWeight: 600,
              letterSpacing: 0.5,
              minHeight: 48,
            } 
          }}
        >
          <Tab icon={<DashboardIcon />} iconPosition="start" label="运营看板" />
          <Tab icon={<BuildIcon />} iconPosition="start" label="零件管理" />
          <Tab icon={<ReceiptIcon />} iconPosition="start" label="配方管理" />
          <Tab icon={<OrderIcon />} iconPosition="start" label="订单管理" />
          <Tab icon={<SmartToyIcon />} iconPosition="start" label="AI 配置" />
        </Tabs>
      </AppBar>

      {/* 页面内容 */}
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/parts" element={<PartsPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/recipe-form" element={<RecipeFormPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/order-form" element={<OrderFormPage />} />
          <Route path="/agent-config" element={<AgentConfigPage />} />
        </Routes>
      </Container>
      
      {/* 全局 AI 助手悬浮窗 */}
      <AIChat />
    </Box>
  );
}

export default App;