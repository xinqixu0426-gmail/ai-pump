import { Routes, Route } from 'react-router-dom';
import { Box } from '@mui/material';
import TopBar from './components/TopBar';
import DashboardPage from './pages/DashboardPage';
import PartsPage from './pages/PartsPage';
import RecipesPage from './pages/RecipesPage';
import RecipeFormPage from './pages/RecipeFormPage';
import OrdersPage from './pages/OrdersPage';
import OrderFormPage from './pages/OrderFormPage';
import CoilRotorPage from './pages/CoilRotorPage';
import AIChatPage from './pages/AIChatPage';
import RotorDrawingPage from './pages/RotorDrawingPage';
import GlobalSnackbar from './components/GlobalSnackbar';

function App() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%' }}>
      {/* 顶部导航 */}
      <TopBar />

      {/* Main content area */}
      <Box
        component="main"
        sx={{
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          px: { xs: 2, md: 3 },
          py: 4,
          minHeight: 0,
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 1360, mx: 'auto', flex: 1 }}>
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

      {/* 全局组件 */}
      <GlobalSnackbar />
    </Box>
  );
}

export default App;