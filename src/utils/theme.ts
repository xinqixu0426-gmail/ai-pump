/**
 * 设计 Token 系统
 * 集中管理全局颜色、间距、渐变等魔法值，避免散落在各组件中
 */

// ─── 语义色板（浅色背景 + 边框 + 文字）────────────────

export const colors = {
  // 蓝色系（信息、链接、主操作）
  blue: {
    bg: '#eff6ff',
    border: '#bfdbfe',
    light: '#dbeafe',
    main: '#3b82f6',
    dark: '#1e40af',
    text: '#1d4ed8',
    deepText: '#1e3a8a',
  },
  // 绿色系（成功、完成、正收益）
  green: {
    bg: '#f0fdf4',
    border: '#bbf7d0',
    borderLight: '#86efac',
    light: '#dcfce7',
    main: '#10b981',
    dark: '#059669',
    text: '#166534',
    deepText: '#14532d',
    accent: '#4ade80',
  },
  // 红色系（错误、负收益、删除）
  red: {
    bg: '#fef2f2',
    border: '#fecaca',
    main: '#ef4444',
    dark: '#dc2626',
    text: '#d32f2f',
  },
  // 黄/橙色系（警告、待处理）
  amber: {
    bg: '#fffbeb',
    border: '#fde68a',
    light: '#fef3c7',
    main: '#f59e0b',
    dark: '#d97706',
    text: '#92400e',
    deepText: '#78350f',
  },
  // 紫色系（品牌、AI、高级功能）
  purple: {
    bg: '#faf5ff',
    border: '#d8b4fe',
    light: '#ede9fe',
    main: '#7c3aed',
    dark: '#5b21b6',
    text: '#5b21b6',
    deepText: '#3b0764',
  },
  // 中性色（布局、分割）
  slate: {
    bg: '#f8fafc',
    border: '#e2e8f0',
    light: '#f1f5f9',
    hover: '#e2e8f0',
    text: '#475569',
  },
} as const;

// ─── KPI 渐变色 ──────────────────────────────────────

export const gradients = {
  // Dashboard KPI 卡片
  orders: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  recipes: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  parts: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  revenue: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  profit: 'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)',

  // 订单状态
  pending: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
  processing: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
  completed: 'linear-gradient(135deg, #34d399 0%, #10b981 100%)',

  // 品牌/AI
  brand: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #06b6d4 100%)',
  brandText: 'linear-gradient(135deg, #7c3aed, #2563eb)',

  // 铜价面板
  copper: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',

  // 线圈成本
  coilCost: 'linear-gradient(135deg, #f0fdf4 0%, #bbf7d0 100%)',
  copperCard: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
  dbCard: 'linear-gradient(135deg, #dbeafe 0%, #93c5fd 100%)',
  fullCalc: 'linear-gradient(135deg, #ede9fe 0%, #c4b5fd 100%)',
} as const;

// ─── 通用 sx 预设（高频复用模式）─────────────────────

/** Glassmorphism 默认卡片 */
export const sxGlassPanel = {
  bgcolor: 'var(--panel)',
  borderRadius: '12px',
  border: '1px solid var(--border)',
  boxShadow: 'var(--shadow)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
} as const;

/** 信息面板 - 蓝色 */
export const sxInfoPanel = {
  bgcolor: colors.blue.bg,
  borderRadius: 2, border: `1px solid ${colors.blue.border}`,
} as const;

/** 成功面板 - 绿色 */
export const sxSuccessPanel = {
  bgcolor: colors.green.bg,
  borderRadius: 2, border: `1px solid ${colors.green.border}`,
} as const;

/** 错误面板 - 红色 */
export const sxErrorPanel = {
  bgcolor: colors.red.bg,
  borderRadius: 2, border: `1px solid ${colors.red.border}`,
} as const;

/** 紫色面板 */
export const sxPurplePanel = {
  bgcolor: colors.purple.bg,
  borderRadius: 2, border: `1px solid ${colors.purple.border}`,
} as const;

/** 警告面板 - 黄色 */
export const sxWarningPanel = {
  bgcolor: colors.amber.bg,
  borderRadius: 2, border: `1px solid ${colors.amber.border}`,
} as const;

// ─── 工具函数 ────────────────────────────────────────

/** 根据成本变动返回颜色 */
export function costDiffColor(diff: number): string {
  return diff > 0 ? colors.red.dark : colors.green.dark;
}

// ─── MUI 主题（统一管理，从 main.tsx 迁移）─────────────
import { createTheme } from '@mui/material/styles';

export const muiTheme = createTheme({
  palette: {
    primary: {
      main: '#2563eb',
      light: '#60a5fa',
      dark: '#1e40af',
    },
    secondary: {
      main: '#7c3aed',
    },
    success: {
      main: '#059669',
    },
    error: {
      main: '#dc2626',
    },
    background: {
      default: '#f1f5f9',
      paper: '#ffffff',
    },
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily: [
      'Inter',
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
    h4: {
      letterSpacing: '-0.01em',
      fontWeight: 700,
    },
    h5: {
      letterSpacing: '-0.01em',
      fontWeight: 700,
    },
    h6: {
      letterSpacing: '-0.01em',
      fontWeight: 600,
    },
  },
  components: {
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--panel)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRadius: 12,
          boxShadow: 'var(--shadow)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 10,
          cursor: 'pointer',
          userSelect: 'none',
          '& .MuiButton-startIcon, & .MuiButton-endIcon, & svg, & .MuiTouchRipple-root': {
            pointerEvents: 'none',
          },
        },
        contained: {
          boxShadow: 'var(--shadow)',
          '&:hover': {
            boxShadow: 'var(--shadow-heavy)',
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          cursor: 'pointer',
          userSelect: 'none',
          '& svg, & .MuiTouchRipple-root': {
            pointerEvents: 'none',
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          border: 'none',
        },
      },
    },
    MuiDialog: {
      defaultProps: {
        disableRestoreFocus: true,
      },
      styleOverrides: {
        paper: {
          borderRadius: 16,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          backgroundColor: 'var(--panel-strong)',
          '@media (max-width: 600px)': {
            margin: 16,
            width: 'calc(100% - 32px)',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          '@media (max-width: 600px)': {
            padding: '8px 8px',
            fontSize: '0.8rem',
          },
        },
        head: {
          fontWeight: 700,
          fontSize: '0.8rem',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          borderRadius: 999,
          letterSpacing: '0.02em',
        },
      },
    },
  },
});
