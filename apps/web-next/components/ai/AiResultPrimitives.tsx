'use client';

import type { ReactNode } from 'react';
import {
  Boxes,
  ChevronDown,
  Coins,
  FileText,
  ReceiptText,
  Wrench,
} from 'lucide-react';
import type { AiAttachment } from '@/lib/ai';

export function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [];
}

export function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `¥${number.toFixed(2)}` : '';
}

export function numberText(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '';
}

export function textValue(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

export function dateText(value: unknown) {
  if (!value) return '-';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fileSizeText(value: number) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(value / 1024))} KB`;
}

export function attachmentParserText(attachment: AiAttachment) {
  if (attachment.detectedType === 'image') {
    if (attachment.parserStatus === 'parsed') {
      const confidence = Math.round(attachment.parserSummary?.confidence || 0);
      const candidates = attachment.parserSummary?.drawingCandidateCount || 0;
      const suffix = candidates > 0 ? `，${candidates} 个参数候选` : '';
      return `OCR ${confidence}%${suffix}`;
    }
    if (attachment.parserStatus === 'metadata_only' && attachment.parserSummary?.ocrApplied) return 'OCR 未识别到文字';
    if (attachment.parserStatus === 'failed') return 'OCR 失败';
    if (attachment.parserStatus === 'processing') return '正在 OCR';
    return '等待 OCR';
  }
  if (attachment.detectedType === 'spreadsheet') {
    if (attachment.parserStatus === 'parsed') {
      const sheets = attachment.parserSummary?.parsedSheetCount || attachment.parserSummary?.sheetCount || 0;
      const rows = attachment.parserSummary?.rowCount || 0;
      if (sheets > 0) return `已读取 ${sheets} 个表，${rows} 行`;
      return '已读取表格';
    }
    if (attachment.parserStatus === 'failed') return '解析失败';
    if (attachment.parserStatus === 'processing') return '正在解析';
    return '等待解析';
  }
  if (attachment.detectedType !== 'pdf') return fileSizeText(attachment.fileSize);
  if (attachment.parserStatus === 'parsed') {
    const pages = attachment.parserSummary?.parsedPageCount || attachment.parserSummary?.pageCount || 0;
    const ocr = attachment.parserSummary?.ocrApplied ? '（含 OCR）' : '';
    const candidates = attachment.parserSummary?.drawingCandidateCount || 0;
    const suffix = candidates > 0 ? `，${candidates} 个参数候选` : '';
    return pages > 0 ? `已读取 ${pages} 页${ocr}${suffix}` : `已读取文字层${ocr}${suffix}`;
  }
  if (attachment.parserStatus === 'metadata_only' && attachment.parserSummary?.ocrApplied) return 'OCR 未识别到文字';
  if (attachment.parserStatus === 'metadata_only' && attachment.parserSummary?.requiresOcr) return '扫描件，等待 OCR';
  if (attachment.parserStatus === 'failed') return '解析失败';
  if (attachment.parserStatus === 'processing') return '正在解析';
  return '等待解析';
}

export function isSafeInternalPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

export function buildFactoryWorkflowShortcutPrompt(
  plan: Record<string, unknown>,
  step: Record<string, unknown>
) {
  if (
    step.mode !== 'confirmable'
    || step.status !== 'available'
    || !step.canExecute
  ) return '';

  const confirmation = asRecord(step.confirmation);
  const args = asRecord(confirmation.args);
  const title = textValue(step.title, '当前步骤');
  if (confirmation.toolName === 'execute_factory_workflow_step') {
    const quotationId = Number(args.quotationId);
    if (
      plan.workflowType !== 'quotation_to_order'
      || args.workflowType !== 'quotation_to_order'
      || args.actionId !== 'convert_quotation'
      || !Number.isInteger(quotationId)
      || quotationId <= 0
    ) return '';
    return `执行报价 #${quotationId} 的“${title}”步骤。请先重新生成最新报价转订单执行计划，仅在步骤仍可执行时发起确认，不要绕过确认。`;
  }

  if (confirmation.toolName === 'execute_order_readiness_action') {
    const orderId = Number(args.orderId);
    const actionId = textValue(args.actionId, '');
    if (
      !['order_readiness', 'management_action'].includes(textValue(plan.workflowType, ''))
      || !Number.isInteger(orderId)
      || orderId <= 0
      || !actionId
    ) return '';
    return `执行订单 #${orderId} 的“${title}”步骤。请先重新检查最新生产准备计划，仅在步骤“${actionId}”仍可执行时发起确认，不要绕过确认。`;
  }

  return '';
}

export function percentText(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${number > 10 ? number.toFixed(1) : (number * 100).toFixed(1)}%`;
}

export function toolLabel(name: string) {
  const labels: Record<string, string> = {
    get_all_parts: '零件列表',
    search_parts: '零件搜索',
    create_part: '新增零件',
    batch_create_parts: '批量新增零件',
    adjust_part_stock: '调整零件库存',
    update_part: '修改零件',
    batch_update_prices: '批量调价',
    get_all_recipes: '配方列表',
    query_recipe_cost_by_name: '配方成本',
    query_recipe_cost_by_id: '配方成本',
    full_calculate: '完整估算',
    calculate_coil_cost: '线圈成本',
    dynamic_config_cost: '动态配置成本',
    get_copper_price: '铜价',
    compare_recipes: '配方对比',
    create_recipe: '新增配方',
    update_recipe: '修改配方',
    get_recent_orders: '最近订单',
    get_order_detail: '订单详情',
    get_order_knowledge_package: '订单知识包',
    get_order_readiness_overview: '订单准备总览',
    check_order_readiness: '生产准备检查',
    plan_order_readiness_actions: '订单处理方案',
    execute_order_readiness_action: '执行订单处理步骤',
    create_order: '新增订单',
    add_recipe_to_order: '追加型号',
    update_order_status: '订单状态',
    update_order_item: '修改订单项',
    generate_purchase_list: '采购清单',
    generate_rotor_drawing: '转子出图',
    get_rotor_drawing_history: '出图历史',
    print_rotor_drawing: '打印图纸',
    get_dashboard_summary: '运营看板',
  };
  return labels[name] || name;
}

export function resultIcon(name: string) {
  if (name.includes('part')) return Boxes;
  if (name.includes('recipe') || name.includes('cost') || name.includes('calculate')) return Coins;
  if (name.includes('order') || name.includes('purchase')) return ReceiptText;
  if (name.includes('rotor') || name.includes('drawing') || name.includes('print')) return FileText;
  return Wrench;
}

export function unwrapResult(value: unknown): Record<string, unknown> {
  const result = asRecord(value);
  const data = asRecord(result.data);
  if (Object.keys(data).length > 0 && Object.keys(result).length <= 2 && result.success !== false) return data;
  return result;
}

export function pickMetrics(source: Record<string, unknown>) {
  const candidates: Array<[string, unknown, 'money' | 'number' | 'text' | 'percent']> = [
    ['总成本', source.totalCost ?? source.savedTotalCost ?? source.cost, 'money'],
    ['单位成本', source.unitCost, 'money'],
    ['销售单价', source.unitPrice ?? source.totalPrice, 'money'],
    ['利润', source.totalProfit ?? source.profit, 'money'],
    ['利润率', source.profitMargin ?? source.margin, 'percent'],
    ['数量', source.count ?? source.qty ?? source.quantity, 'number'],
    ['铜价', source.copperPrice ?? source.price, 'money'],
    ['线径', source.wireDiameter ?? source.resolvedWire ?? source.wire, 'text'],
    ['片数', source.sheets ?? source.statorSheets, 'number'],
  ];
  return candidates
    .map(([label, value, type]) => {
      if (value === undefined || value === null || value === '') return null;
      const display = type === 'money' ? money(value) : type === 'percent' ? percentText(value) : type === 'number' ? numberText(value) : textValue(value);
      return display ? { label, value: display } : null;
    })
    .filter((item): item is { label: string; value: string } => Boolean(item));
}

export function RawDetails({ result }: { result: unknown }) {
  return (
    <details className="group mt-3 rounded-md border border-slate-200 bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-muted">
        原始数据
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-slate-200 bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">{formatJson(result)}</pre>
    </details>
  );
}

export function MetricGrid({ metrics }: { metrics: Array<{ label: string; value: string }> }) {
  if (metrics.length === 0) return null;
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {metrics.slice(0, 6).map((metric) => (
        <div key={metric.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs text-muted">{metric.label}</div>
          <div className="mt-1 truncate text-base font-semibold text-ink">{metric.value}</div>
        </div>
      ))}
    </div>
  );
}

export function KeyValueRows({ rows }: { rows: Array<{ label: string; value: unknown }> }) {
  const visible = rows.filter((row) => row.value !== undefined && row.value !== null && row.value !== '');
  if (visible.length === 0) return null;
  return (
    <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
      {visible.map((row) => (
        <div key={row.label} className="flex min-w-0 justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
          <span className="shrink-0 text-muted">{row.label}</span>
          <span className="truncate font-medium text-ink">{String(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function DataTable({ columns, rows, emptyText = '暂无数据' }: {
  columns: Array<{ key: string; label: string; render?: (row: Record<string, unknown>) => ReactNode }>;
  rows: Array<Record<string, unknown>>;
  emptyText?: string;
}) {
  if (rows.length === 0) return <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-muted">{emptyText}</div>;
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
      <div className="max-h-80 overflow-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-slate-100 text-xs font-medium text-muted">
            <tr>
              {columns.map((column) => <th key={column.key} className="border-b border-slate-200 px-3 py-2">{column.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.slice(0, 30).map((row, index) => (
              <tr key={`${textValue(row.id, String(index))}-${index}`}>
                {columns.map((column) => (
                  <td key={column.key} className="max-w-48 truncate px-3 py-2 text-slate-700">
                    {column.render ? column.render(row) : textValue(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 30 ? <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted">仅显示前 30 条，共 {rows.length} 条</div> : null}
    </div>
  );
}

export function ChangesList({ changes }: { changes: unknown }) {
  const rows = Array.isArray(changes) ? changes.map(String) : [];
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
      <div className="text-xs font-medium text-emerald-800">变更内容</div>
      <div className="mt-2 grid gap-1 text-sm text-emerald-950">
        {rows.map((change, index) => <div key={`${change}-${index}`}>{change}</div>)}
      </div>
    </div>
  );
}
