import { Box, CircularProgress, Typography } from '@mui/material';

interface PageLoadingProps {
  /** 加载提示文本 */
  message?: string;
}

/**
 * 全局统一的页面加载状态组件
 */
export default function PageLoading({ message = '加载中...' }: PageLoadingProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 8,
        gap: 2,
      }}
    >
      <CircularProgress size={36} />
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}
