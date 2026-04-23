import React from 'react';
import { Box, Typography, CircularProgress, Fade, alpha } from '@mui/material';
import {
  Brain as ThinkIcon,
  Plug as ApiIcon,
  Braces as DataIcon,
  CheckCircle as DoneIcon,
  AlertCircle as ErrorIcon,
} from 'lucide-react';

interface StatusIndicatorProps {
  status: string;
  message: string;
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; animate: boolean }> = {
  thinking: { icon: <ThinkIcon size={18} />, color: '#7c3aed', animate: true },
  calling_api: { icon: <ApiIcon size={18} />, color: '#2563eb', animate: true },
  formatting: { icon: <DataIcon size={18} />, color: '#059669', animate: true },
  done: { icon: <DoneIcon size={18} />, color: '#059669', animate: false },
  error: { icon: <ErrorIcon size={18} />, color: '#dc2626', animate: false },
};

export default function StatusIndicator({ status, message }: StatusIndicatorProps) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG.thinking;

  return (
    <Fade in>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 0.5,
        px: 1.5,
        borderRadius: 2,
        bgcolor: alpha(c.color, 0.08),
        color: c.color,
        mb: 1,
        ...(c.animate ? {
          animation: 'pulse 1.5s ease-in-out infinite',
          '@keyframes pulse': {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0.5 },
          }
        } : {})
      }}>
        {c.animate ? <CircularProgress size={16} sx={{ color: c.color }} /> : c.icon}
        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>
          {message}
        </Typography>
      </Box>
    </Fade>
  );
}
