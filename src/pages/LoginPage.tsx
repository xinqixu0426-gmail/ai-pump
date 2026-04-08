import { useState, useCallback } from 'react';
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  InputAdornment,
  IconButton,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  LockOutlined,
  Login as LoginIcon,
} from '@mui/icons-material';
import { login } from '../utils/authUtils';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!password.trim() || loading) return;

    setError('');
    setLoading(true);

    const result = await login(password);

    if (result.success) {
      onLoginSuccess();
    } else {
      setError(result.error || '登录失败');
      setLoading(false);
    }
  }, [password, loading, onLoginSuccess]);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 30%, #1e40af 70%, #2563eb 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 背景装饰 */}
      <Box sx={{
        position: 'absolute',
        top: '-20%',
        right: '-10%',
        width: 600,
        height: 600,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <Box sx={{
        position: 'absolute',
        bottom: '-15%',
        left: '-5%',
        width: 400,
        height: 400,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* 登录卡片 */}
      <Paper
        elevation={0}
        component="form"
        onSubmit={handleSubmit}
        sx={{
          width: 400,
          maxWidth: '90vw',
          p: 5,
          borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.4), 0 0 100px rgba(37,99,235,0.08)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Logo 区域 */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: 3,
              background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 2,
              boxShadow: '0 8px 24px rgba(37,99,235,0.3)',
            }}
          >
            <LockOutlined sx={{ fontSize: 32, color: '#fff' }} />
          </Box>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 800,
              color: '#f1f5f9',
              letterSpacing: 1,
            }}
          >
            💧 水泵BOM管理系统
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: 'rgba(148,163,184,0.8)', mt: 0.5 }}
          >
            请输入访问密码以继续
          </Typography>
        </Box>

        {/* 错误提示 */}
        {error && (
          <Alert
            severity="error"
            sx={{
              mb: 2,
              borderRadius: 2,
              backgroundColor: 'rgba(220,38,38,0.1)',
              color: '#fca5a5',
              border: '1px solid rgba(220,38,38,0.2)',
              '& .MuiAlert-icon': { color: '#f87171' },
            }}
          >
            {error}
          </Alert>
        )}

        {/* 密码输入 */}
        <TextField
          id="login-password"
          fullWidth
          type={showPassword ? 'text' : 'password'}
          placeholder="访问密码"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          autoFocus
          disabled={loading}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => setShowPassword(!showPassword)}
                  edge="end"
                  size="small"
                  sx={{ color: 'rgba(148,163,184,0.6)' }}
                >
                  {showPassword ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={{
            mb: 3,
            '& .MuiOutlinedInput-root': {
              borderRadius: 2.5,
              backgroundColor: 'rgba(30,41,59,0.8)',
              color: '#f1f5f9',
              '& fieldset': { borderColor: 'rgba(100,116,139,0.3)' },
              '&:hover fieldset': { borderColor: 'rgba(100,116,139,0.5)' },
              '&.Mui-focused fieldset': { borderColor: '#2563eb' },
            },
            '& .MuiInputBase-input::placeholder': {
              color: 'rgba(148,163,184,0.5)',
            },
          }}
        />

        {/* 登录按钮 */}
        <Button
          id="login-submit"
          type="submit"
          fullWidth
          variant="contained"
          disabled={!password.trim() || loading}
          startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <LoginIcon />}
          sx={{
            py: 1.5,
            borderRadius: 2.5,
            fontWeight: 700,
            fontSize: '1rem',
            background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
            boxShadow: '0 4px 16px rgba(37,99,235,0.3)',
            textTransform: 'none',
            '&:hover': {
              background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
              boxShadow: '0 6px 20px rgba(37,99,235,0.4)',
            },
            '&.Mui-disabled': {
              background: 'rgba(37,99,235,0.3)',
              color: 'rgba(255,255,255,0.5)',
            },
          }}
        >
          {loading ? '验证中...' : '进入系统'}
        </Button>

        {/* 底部说明 */}
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            textAlign: 'center',
            mt: 3,
            color: 'rgba(100,116,139,0.5)',
          }}
        >
          此系统受访问密码保护 · 仅限授权人员使用
        </Typography>
      </Paper>
    </Box>
  );
}
