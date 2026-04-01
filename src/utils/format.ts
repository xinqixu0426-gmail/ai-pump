/**
 * 通用格式化工具
 */

/** 格式化日期为 MM/DD HH:mm */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 格式化日期为 MM/DD */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
}

/** 格式化金额，千分位 + 2位小数 */
export function formatMoney(n: number): string {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
