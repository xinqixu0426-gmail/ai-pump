import { Paper, Box, Typography, Fade } from '@mui/material';
import { LineChart, Line } from 'recharts';

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
  /** 可选微型图表数据 */
  chartData?: { name: string, value: number }[];
  /** 图表走势线颜色 */
  chartColor?: string;
}

export default function StatCard({ label, value, subtitle, icon, gradient, delay = 0, chartData, chartColor = '#3b82f6' }: StatCardProps) {
  return (
    <Fade in timeout={400 + delay * 150}>
      <Paper
        sx={{
          p: { xs: 2.5, sm: 3 },
          position: 'relative',
          overflow: 'hidden',
          flex: 1,
          transition: 'border-color 0.2s ease',
          '&:hover': {
            borderColor: 'rgba(148, 163, 184, 0.4)',
          },
        }}
      >
        <Box display="flex" alignItems="flex-start" justifyContent="space-between">
          <Box>
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase', fontSize: '0.75rem' }}
            >
              {label}
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 700, mt: 1, letterSpacing: '-0.02em', fontSize: { xs: '1.75rem', sm: '2.25rem' } }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.75, display: 'block', fontWeight: 500 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {icon && (
              <Box
              sx={{
                background: gradient,
                width: { xs: 42, sm: 56 },
                height: { xs: 42, sm: 56 },
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.1)',
                '& > svg': {
                  width: { xs: 20, sm: 26 },
                  height: { xs: 20, sm: 26 },
                }
              }}
            >
              {icon}
            </Box>
          )}
        </Box>
        {chartData && chartData.length > 0 && (
          <Box sx={{ height: 48, mt: 2, mx: -2.5, mb: -3, opacity: 0.6, overflow: 'hidden' }}>
            <LineChart width={300} height={48} data={chartData} style={{ width: '100%', height: '100%' }}>
              <Line type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2.5} dot={false} isAnimationActive={true} />
            </LineChart>
          </Box>
        )}
      </Paper>
    </Fade>
  );
}
