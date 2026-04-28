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
      <Box 
        display="flex" 
        flexDirection={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }} 
        justifyContent="space-between" 
        mb={3}
      >
        <Box mb={{ xs: actions ? 1 : 0, sm: 0 }}>
          <Typography variant="h3" sx={{ fontWeight: 700, letterSpacing: '-0.01em', fontSize: { xs: '1.5rem', sm: '2rem' } }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500, mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {actions && (
          <Box display="flex" gap={1} alignItems="center" sx={{ width: { xs: '100%', sm: 'auto' }, overflowX: 'auto', pb: { xs: 0.5, sm: 0 } }}>
            {actions}
          </Box>
        )}
      </Box>
    </Fade>
  );
}
