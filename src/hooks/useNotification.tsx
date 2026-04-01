import { useState, useCallback, ReactNode } from 'react';
import { Snackbar, Alert, AlertColor } from '@mui/material';

interface Notification {
  message: string;
  severity: AlertColor;
}

/**
 * 全局通知 Hook
 * 替代分散在各页面的 error/success useState + Alert 模式
 *
 * @example
 * const { notify, NotificationBar } = useNotification();
 * notify('保存成功', 'success');
 * notify('操作失败', 'error');
 * // 在 JSX 中: <NotificationBar />
 */
export function useNotification() {
  const [notification, setNotification] = useState<Notification | null>(null);

  const notify = useCallback((message: string, severity: AlertColor = 'info') => {
    setNotification({ message, severity });
  }, []);

  const handleClose = useCallback(() => {
    setNotification(null);
  }, []);

  const NotificationBar = useCallback(
    (): ReactNode =>
      notification ? (
        <Snackbar
          open
          autoHideDuration={notification.severity === 'error' ? 6000 : 3000}
          onClose={handleClose}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <Alert
            onClose={handleClose}
            severity={notification.severity}
            variant="filled"
            sx={{ width: '100%', fontWeight: 600 }}
          >
            {notification.message}
          </Alert>
        </Snackbar>
      ) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notification]
  );

  return { notify, NotificationBar };
}
