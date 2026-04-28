import { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <Box sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
          bgcolor: '#f8fafc'
        }}>
          <Paper elevation={0} sx={{
            p: 4,
            maxWidth: 600,
            width: '100%',
            borderRadius: 3,
            border: '1px solid',
            borderColor: '#fca5a5',
            textAlign: 'center'
          }}>
            <Box sx={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              bgcolor: 'rgba(239, 68, 68, 0.1)',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 3
            }}>
              <AlertTriangle size={32} />
            </Box>
            
            <Typography variant="h5" fontWeight={700} gutterBottom color="text.primary">
              系统出现异常
            </Typography>
            <Typography variant="body1" color="text.secondary" mb={3}>
              很抱歉，应用遇到了意外错误。请尝试刷新页面。如果问题持续存在，请联系管理员。
            </Typography>

            {this.state.error && (
              <Box sx={{
                mb: 4,
                p: 2,
                bgcolor: '#f1f5f9',
                borderRadius: 2,
                border: '1px solid',
                borderColor: '#e2e8f0',
                textAlign: 'left',
                overflowX: 'auto',
                maxHeight: 300
              }}>
                <Typography variant="body2" fontFamily="monospace" color="#ef4444" fontWeight={600} gutterBottom>
                  {this.state.error.toString()}
                </Typography>
                {this.state.errorInfo && (
                  <Typography variant="caption" fontFamily="monospace" color="text.secondary" component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap' }}>
                    {this.state.errorInfo.componentStack}
                  </Typography>
                )}
              </Box>
            )}

            <Button
              variant="contained"
              size="large"
              startIcon={<RefreshCw size={20} />}
              onClick={this.handleReload}
              sx={{ fontWeight: 600 }}
            >
              重新加载页面
            </Button>
          </Paper>
        </Box>
      );
    }

    return this.props.children;
  }
}
