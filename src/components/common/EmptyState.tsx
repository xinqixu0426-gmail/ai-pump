import { Box, Typography } from '@mui/material';
import { SvgIconComponent } from '@mui/icons-material';
import InboxIcon from '@mui/icons-material/Inbox';

interface EmptyStateProps {
  /** 提示文本 */
  message?: string;
  /** 自定义图标 */
  Icon?: SvgIconComponent;
}

/**
 * 全局统一的空数据状态组件
 */
export default function EmptyState({
  message = '暂无数据',
  Icon = InboxIcon,
}: EmptyStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 6,
        color: 'text.disabled',
      }}
    >
      <Icon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
      <Typography>{message}</Typography>
    </Box>
  );
}
