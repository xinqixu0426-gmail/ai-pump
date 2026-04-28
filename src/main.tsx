import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Box, CircularProgress, Typography } from '@mui/material';
import './index.css';
import App from './App';
import VoiceAssistantPage from './pages/VoiceAssistantPage';
import LoginPage from './pages/LoginPage';
import { checkAuth } from './utils/authUtils';
import { muiTheme } from './utils/theme';
import ErrorBoundary from './components/ErrorBoundary';

/**
 * 全屏加载动画 — 应用启动时检查认证状态
 */
function LoadingScreen() {
  return (
    <Box sx={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 30%, #1e40af 70%, #2563eb 100%)',
      gap: 2,
    }}>
      <CircularProgress size={48} sx={{ color: '#60a5fa' }} />
      <Typography sx={{ color: 'rgba(148,163,184,0.8)', fontSize: '0.9rem' }}>
        正在验证身份...
      </Typography>
    </Box>
  );
}

/**
 * 认证守卫组件
 * 应用启动时检查登录状态，未登录则展示登录页
 */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const location = useLocation();

  useEffect(() => {
    checkAuth().then((isAuthed) => {
      setAuthState(isAuthed ? 'authenticated' : 'unauthenticated');
    });
  }, []);

  const handleLoginSuccess = useCallback(() => {
    setAuthState('authenticated');
  }, []);

  // 正在检查认证状态
  if (authState === 'loading') {
    return <LoadingScreen />;
  }

  // 未登录
  if (authState === 'unauthenticated') {
    // 如果当前不在 /login 路径，重定向到 /login
    if (location.pathname !== '/login') {
      return <Navigate to="/login" replace />;
    }
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  // 已登录但在 /login 路径，重定向到首页
  if (location.pathname === '/login') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <ErrorBoundary>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthGuard>
            <Routes>
              {/* /voice 全屏沉浸式语音助手页面，不走 App 的 AppBar 布局 */}
              <Route path="/voice" element={<VoiceAssistantPage />} />
              {/* /login 路由由 AuthGuard 内部处理 */}
              <Route path="/login" element={<Navigate to="/" replace />} />
              {/* 其余所有路由走原 App 布局 */}
              <Route path="/*" element={<App />} />
            </Routes>
          </AuthGuard>
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>
);
