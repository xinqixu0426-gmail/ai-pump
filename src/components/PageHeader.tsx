import { ReactNode } from 'react';
import { Box, Typography, Fade } from '@mui/material';

interface PageHeaderProps {
  /** Emoji + 标题文字, 如 "📊 运营看板" */
  title: string;
  /** 副标题描述 */
  subtitle?: string;
  /** 右侧操作按钮区域 */
  actions?: ReactNode;
}

/**
 * 统一的页面标题组件
 * 所有页面使用此组件保持一致的标题区样式
 */
export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <Fade in timeout={300}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: -0.5 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {actions && (
          <Box display="flex" gap={1} alignItems="center">
            {actions}
          </Box>
        )}
      </Box>
    </Fade>
  );
}
