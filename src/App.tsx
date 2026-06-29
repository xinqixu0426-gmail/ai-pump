import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import TopBar from './components/TopBar';
import GlobalSnackbar from './components/GlobalSnackbar';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const PartsPage = lazy(() => import('./pages/PartsPage'));
const RecipesPage = lazy(() => import('./pages/RecipesPage'));
const RecipeFormPage = lazy(() => import('./pages/RecipeFormPage'));
const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const OrderFormPage = lazy(() => import('./pages/OrderFormPage'));
const PurchaseCenterPage = lazy(() => import('./pages/PurchaseCenterPage'));
const CoilRotorPage = lazy(() => import('./pages/CoilRotorPage'));
const AIChatPage = lazy(() => import('./pages/AIChatPage'));
const RotorDrawingPage = lazy(() => import('./pages/RotorDrawingPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const QuotationsPage = lazy(() => import('./pages/QuotationsPage'));

function PageLoading() {
  return (
    <Box display="flex" justifyContent="center" alignItems="center" py={8}>
      <CircularProgress />
    </Box>
  );
}

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
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/parts" element={<PartsPage />} />
              <Route path="/recipes" element={<RecipesPage />} />
              <Route path="/recipe-form" element={<RecipeFormPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/order-form" element={<OrderFormPage />} />
              <Route path="/order-form/:id" element={<OrderFormPage />} />
              <Route path="/purchase" element={<PurchaseCenterPage />} />
              <Route path="/coils" element={<CoilRotorPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/quotations" element={<QuotationsPage />} />
              <Route path="/ai" element={<AIChatPage />} />
              <Route path="/rotor" element={<RotorDrawingPage />} />
            </Routes>
          </Suspense>
        </Box>
      </Box>

      {/* 全局组件 */}
      <GlobalSnackbar />
    </Box>
  );
}

export default App;
