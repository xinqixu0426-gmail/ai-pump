import React from 'react';
import { Paper, Box, Typography, Avatar, Fade } from '@mui/material';

interface StatCardProps {
  /** 标签文字，如"订单总数" */
  label: string;
  /** 主数值，如 16 或 "¥2.6w" */
  value: string | number;
  /** 副标题，如"进行中 3 单" */
  subtitle?: string;
  /** 右上角 icon（可选, 传入后会显示渐变 Avatar） */
  icon?: React.ReactNode;
  /** 顶部渐变色条 */
  gradient: string;
  /** 入场动画延时因子（0, 1, 2, ...），用于错开淡入 */
  delay?: number;
}

export default function StatCard({ label, value, subtitle, icon, gradient, delay = 0 }: StatCardProps) {
  return (
    <Fade in timeout={400 + delay * 150}>
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          borderRadius: 3,
          position: 'relative',
          overflow: 'hidden',
          flex: 1,
          border: '1px solid',
          borderColor: 'divider',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            transform: { xs: 'none', sm: 'translateY(-4px)' },
            boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
          },
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: gradient,
          },
        }}
      >
        <Box display="flex" alignItems="flex-start" justifyContent="space-between">
          <Box>
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', fontSize: '0.7rem' }}
            >
              {label}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, mt: 0.5, letterSpacing: -0.5, fontSize: { xs: '1.5rem', sm: '2.125rem' } }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {icon && (
            <Avatar
              sx={{
                background: gradient,
                width: { xs: 36, sm: 44 },
                height: { xs: 36, sm: 44 },
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                '& .MuiSvgIcon-root': {
                  fontSize: { xs: 20, sm: 24 }
                }
              }}
            >
              {icon}
            </Avatar>
          )}
        </Box>
      </Paper>
    </Fade>
  );
}
