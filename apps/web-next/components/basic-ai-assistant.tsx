'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bot, Check, ChevronDown, Loader2, Mic, MicOff, RefreshCcw, Send, ShieldAlert, Square, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import {
  ChatContainer,
  ChatMessages,
  Message,
  MessageHeader,
  PromptInput,
  PromptInputActions,
  PromptInputTextarea,
  PromptSuggestion,
  StreamingText,
} from '@/components/prompt-kit/basic-chat';
import { confirmAiTool, streamAiChat, type AiChatMessage, type AiToolResult } from '@/lib/ai';
import { getSupportedVoiceMimeType, recognizeVoiceBlob } from '@/lib/voice';

type AssistantStatus = 'idle' | 'recording' | 'recognizing' | 'thinking' | 'calling' | 'answering' | 'confirming' | 'done' | 'error' | 'cancelled';
type VoiceInputState = 'idle' | 'recording' | 'recognizing' | 'error';

type ChatItem = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: AssistantStatus;
  statusMessage?: string;
  toolCalls?: Array<{ name: string; args: unknown }>;
  toolResults?: AiToolResult[];
};

type ConfirmationResult = {
  requiresConfirmation?: boolean;
  confirmation?: {
    toolName: string;
    args?: unknown;
    title?: string;
    summary?: string;
    warning?: string;
    rows?: Array<{ label: string; value: string }>;
  };
};

const suggestions = [
  '今天有哪些待处理事项？',
  '查一下最近 5 个订单',
  'V750 的成本是多少',
  '找所有螺丝零件',
  '12-140 的线圈成本',
  '看看最近出的转子图',
];

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [];
}

function textValue(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `¥${number.toFixed(2)}` : '';
}

function dateText(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isConfirmationResult(value: unknown): value is ConfirmationResult {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as ConfirmationResult).requiresConfirmation &&
    (value as ConfirmationResult).confirmation?.toolName
  );
}

function toolLabel(name: string) {
  const labels: Record<string, string> = {
    get_dashboard_summary: '运营概况',
    get_recent_orders: '最近订单',
    get_order_detail: '订单详情',
    search_parts: '零件搜索',
    get_all_parts: '零件列表',
    get_all_recipes: '配方列表',
    query_recipe_cost_by_name: '配方成本',
    query_recipe_cost_by_id: '配方成本',
    full_calculate: '完整估算',
    calculate_coil_cost: '线圈成本',
    dynamic_config_cost: '动态配置',
    get_copper_price: '铜价',
    compare_recipes: '配方对比',
    generate_rotor_drawing: '转子出图',
    get_rotor_drawing_history: '出图历史',
    print_rotor_drawing: '打印图纸',
    create_order: '新建订单',
    update_order_status: '订单状态',
    add_recipe_to_order: '追加产品',
    update_part: '修改零件',
    create_part: '新增零件',
    generate_purchase_list: '采购清单',
  };
  return labels[name] || name;
}

function statusTone(status?: AssistantStatus): StatusBadgeTone {
  if (status === 'error') return 'red';
  if (status === 'done') return 'green';
  if (status === 'confirming') return 'amber';
  if (status === 'calling') return 'purple';
  if (status === 'answering') return 'blue';
  return 'slate';
}

function unwrapResult(value: unknown): Record<string, unknown> {
  const result = asRecord(value);
  const data = asRecord(result.data);
  if (Object.keys(data).length > 0) return data;
  return result;
}

function pickMetrics(source: Record<string, unknown>) {
  const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: unknown, formatter?: (value: unknown) => string) => {
    const display = formatter ? formatter(value) : textValue(value, '');
    if (display) rows.push({ label, value: display });
  };
  add('总成本', source.totalCost ?? source.savedTotalCost ?? source.cost, money);
  add('单位成本', source.unitCost, money);
  add('出厂价', source.unitPrice ?? source.totalPrice, money);
  add('利润', source.totalProfit ?? source.profit, money);
  add('数量', source.count ?? source.qty ?? source.quantity);
  add('铜价', source.copperPrice ?? source.livePricePerKg ?? source.dbPrice, money);
  add('状态', source.status);
  return rows.slice(0, 6);
}

function MetricGrid({ metrics }: { metrics: Array<{ label: string; value: string }> }) {
  if (metrics.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] text-muted">{metric.label}</div>
          <div className="mt-1 truncate text-sm font-semibold text-ink">{metric.value}</div>
        </div>
      ))}
    </div>
  );
}

function KeyValueRows({ rows }: { rows: Array<{ label: string; value: unknown }> }) {
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

function CompactRows({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200 bg-white">
      {rows.slice(0, 8).map((row, index) => (
        <div key={`${textValue(row.id, String(index))}-${index}`} className="px-3 py-2">
          <div className="text-sm font-semibold text-ink">{textValue(row.name || row.model || row.recipeName || row.customer || row.jobId || row.id)}</div>
          <div className="mt-1 grid gap-1 text-xs text-muted">
            <div className="flex justify-between gap-3">
              <span>状态</span>
              <span className="truncate text-right text-slate-700">{textValue(row.status || row.category || row.supplier, '')}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>数量/价格</span>
              <span className="truncate text-right text-slate-700">{textValue(row.qty ?? row.stock ?? row.price ?? row.totalCost ?? row.unitCost, '')}</span>
            </div>
          </div>
        </div>
      ))}
      {rows.length > 8 ? <div className="bg-slate-50 px-3 py-2 text-xs text-muted">仅显示前 8 条，共 {rows.length} 条</div> : null}
    </div>
  );
}

function RawDetails({ result }: { result: unknown }) {
  return (
    <details className="group mt-3 rounded-md border border-slate-200 bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-muted">
        调试数据
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-slate-200 bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">{formatJson(result)}</pre>
    </details>
  );
}

function ToolResultCard({ item, onConfirmed }: { item: AiToolResult; onConfirmed: (next: AiToolResult) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const result = item.result;

  if (isConfirmationResult(result)) {
    const confirmation = result.confirmation;
    async function handleConfirm() {
      if (!confirmation?.toolName || confirming) return;
      try {
        setConfirming(true);
        setError('');
        const next = await confirmAiTool(confirmation.toolName, confirmation.args || {});
        onConfirmed(next);
      } catch (err) {
        setError((err as Error).message || '确认执行失败');
      } finally {
        setConfirming(false);
      }
    }

    return (
      <div className="rounded-panel border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-200 bg-white text-amber-700">
            <ShieldAlert size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-amber-950">{confirmation?.title || '待确认操作'}</div>
            {confirmation?.summary ? <div className="mt-1 text-sm text-amber-900">{confirmation.summary}</div> : null}
            {Array.isArray(confirmation?.rows) && confirmation.rows.length > 0 ? (
              <div className="mt-2 grid gap-1 text-xs text-amber-950">
                {confirmation.rows.map((row, index) => (
                  <div key={`${row.label}-${index}`} className="flex min-w-0 justify-between gap-3 rounded-md border border-amber-200/80 bg-white/70 px-2 py-1">
                    <span className="text-amber-700">{row.label}</span>
                    <span className="truncate font-medium">{row.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {confirmation?.warning ? <div className="mt-2 text-xs text-amber-800">{confirmation.warning}</div> : null}
            {error ? <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</div> : null}
            <Button
              size="sm"
              variant="primary"
              onClick={handleConfirm}
              disabled={confirming}
              className="mt-3 w-full"
              icon={confirming ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            >
              确认执行
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const record = asRecord(result);
  const failed = record.success === false;
  const data = unwrapResult(result);
  const order = asRecord(data.order || record.order);
  const recipe = asRecord(data.recipe || record.recipe);
  const part = asRecord(data.part || record.part);
  const primary = Object.keys(order).length > 0 ? order : Object.keys(recipe).length > 0 ? recipe : Object.keys(part).length > 0 ? part : data;
  const rows = arrayValue(data.data || data.parts || data.items || data.history || data.purchaseList || data.comparison || data.summary);

  return (
    <div className="rounded-panel border border-line bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-3 font-medium text-ink">
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            <Wrench size={14} />
          </span>
          <span className="truncate">{toolLabel(item.name)}</span>
        </span>
        <StatusBadge tone={failed ? 'red' : 'green'}>{failed ? '失败' : '完成'}</StatusBadge>
      </div>
      {failed ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{textValue(record.error, '执行失败')}</span>
        </div>
      ) : (
        <>
          <MetricGrid metrics={pickMetrics(primary)} />
          <KeyValueRows rows={[
            { label: '消息', value: record.message || data.message },
            { label: '订单', value: primary.id || data.orderId },
            { label: '客户', value: primary.customerName || data.customerName },
            { label: '型号', value: primary.model || data.model },
            { label: '配方', value: primary.name || data.recipeName || data.itemName },
            { label: '规格', value: primary.spec || data.spec },
            { label: '时间', value: dateText(primary.createdAt || data.createdAt) },
          ]} />
          <CompactRows rows={rows} />
        </>
      )}
      <RawDetails result={result} />
    </div>
  );
}

function toolResultState(result: unknown): { label: string; tone: StatusBadgeTone; icon: ReactNode } {
  if (!result) return { label: '执行中', tone: 'blue', icon: <Loader2 size={13} className="shrink-0 animate-spin" /> };
  if (isConfirmationResult(result)) return { label: '待确认', tone: 'amber', icon: <ShieldAlert size={13} className="shrink-0" /> };
  if (asRecord(result).success === false) return { label: '失败', tone: 'red', icon: <AlertCircle size={13} className="shrink-0" /> };
  return { label: '完成', tone: 'green', icon: <Check size={13} className="shrink-0" /> };
}

function ToolCalls({ calls, results }: { calls: Array<{ name: string; args: unknown }>; results: AiToolResult[] }) {
  if (calls.length === 0) return null;
  const usedResultIndexes = new Set<number>();

  return (
    <div className="mt-3 space-y-2">
      {calls.map((call, index) => {
        const resultIndex = results.findIndex((item, itemIndex) => item.name === call.name && !usedResultIndexes.has(itemIndex));
        if (resultIndex >= 0) usedResultIndexes.add(resultIndex);
        const state = toolResultState(resultIndex >= 0 ? results[resultIndex].result : null);
        return (
          <div key={`${call.name}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="inline-flex min-w-0 items-center gap-2">
              {state.icon}
              <span className="truncate">{toolLabel(call.name)}</span>
            </span>
            <StatusBadge tone={state.tone} className="h-6 min-w-0 px-2">{state.label}</StatusBadge>
          </div>
        );
      })}
    </div>
  );
}

export function BasicAiAssistant() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');
  const [serviceStatus, setServiceStatus] = useState('就绪');
  const [voiceState, setVoiceState] = useState<VoiceInputState>('idle');
  const [voiceError, setVoiceError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef('');
  const unmountRef = useRef(false);

  const apiMessages = useMemo<AiChatMessage[]>(() => (
    items
      .filter((item) => item.role === 'user' || (item.role === 'assistant' && item.content.trim()))
      .slice(-12)
      .map((item) => ({ role: item.role, content: item.content }))
  ), [items]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items]);

  useEffect(() => () => {
    unmountRef.current = true;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function updateAssistant(id: string, updater: (item: ChatItem) => ChatItem) {
    setItems((current) => current.map((item) => (item.id === id ? updater(item) : item)));
  }

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || loading) return;

    const userItem: ChatItem = { id: makeId(), role: 'user', content };
    const assistantId = makeId();
    const assistantItem: ChatItem = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'thinking',
      statusMessage: '正在理解需求...',
      toolCalls: [],
      toolResults: [],
    };
    const nextMessages = [...apiMessages, { role: 'user' as const, content }];

    setItems((current) => [...current, userItem, assistantItem]);
    setInput('');
    setLastPrompt(content);
    setLoading(true);
    setServiceStatus('处理中');

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      await streamAiChat(nextMessages, (event) => {
        updateAssistant(assistantId, (item) => {
          if (event.type === 'status') {
            const nextStatus = event.status === 'calling' ? 'calling' : 'thinking';
            setServiceStatus(event.message || (nextStatus === 'calling' ? '执行中' : '理解中'));
            return { ...item, status: nextStatus, statusMessage: event.message || '' };
          }
          if (event.type === 'content') {
            setServiceStatus('回复中');
            return { ...item, content: item.content + event.content, status: 'answering', statusMessage: '' };
          }
          if (event.type === 'tool_call') {
            setServiceStatus(`正在执行 ${toolLabel(event.name)}`);
            return { ...item, toolCalls: [...(item.toolCalls || []), { name: event.name, args: event.args }], status: 'calling', statusMessage: `正在执行 ${toolLabel(event.name)}` };
          }
          if (event.type === 'tool_result') {
            const resultFailed = asRecord(event.result).success === false;
            const nextStatus = isConfirmationResult(event.result) ? 'confirming' : resultFailed ? 'error' : 'answering';
            if (nextStatus === 'confirming') setServiceStatus('等待确认');
            else if (nextStatus === 'error') setServiceStatus('出错');
            else setServiceStatus('整理结果');
            return { ...item, toolResults: [...(item.toolResults || []), { name: event.name, result: event.result }], status: nextStatus };
          }
          if (event.type === 'detail') return { ...item, toolResults: event.toolResults || item.toolResults || [] };
          if (event.type === 'done') {
            const hasConfirmation = (item.toolResults || []).some((tool) => isConfirmationResult(tool.result));
            const nextStatus = hasConfirmation ? 'confirming' : 'done';
            setServiceStatus(hasConfirmation ? '等待确认' : '就绪');
            return { ...item, status: nextStatus, statusMessage: '' };
          }
          if (event.type === 'error') {
            setServiceStatus('出错');
            return { ...item, status: 'error', statusMessage: event.message, content: item.content || event.message };
          }
          return item;
        });
      }, controller.signal);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setServiceStatus('出错');
        updateAssistant(assistantId, (item) => ({
          ...item,
          status: 'error',
          statusMessage: (err as Error).message || 'AI 请求失败',
          content: item.content || 'AI 请求失败',
        }));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function stopCurrent() {
    abortRef.current?.abort();
    setLoading(false);
    setServiceStatus('已取消');
    setItems((current) => current.map((item) => item.status && !['done', 'error', 'confirming'].includes(item.status) ? { ...item, status: 'cancelled', statusMessage: '已取消' } : item));
  }

  function stopMediaStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  async function startVoiceInput() {
    if (loading || voiceState === 'recording' || voiceState === 'recognizing') return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceState('error');
      setVoiceError('当前浏览器不支持录音，请使用文字输入');
      return;
    }

    try {
      setVoiceError('');
      setVoiceState('recording');
      setServiceStatus('正在录音');
      chunksRef.current = [];
      mimeTypeRef.current = getSupportedVoiceMimeType();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream, mimeTypeRef.current ? { mimeType: mimeTypeRef.current } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        if (unmountRef.current) return;
        setVoiceState('error');
        setVoiceError('录音失败，请改用文字输入');
        setServiceStatus('就绪');
        stopMediaStream();
      };
      recorder.onstop = () => {
        if (unmountRef.current) return;
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/wav' });
        chunksRef.current = [];
        stopMediaStream();
        void handleVoiceBlob(blob);
      };

      recorder.start();
    } catch (err) {
      setVoiceState('error');
      setVoiceError((err as Error).message || '无法访问麦克风，请检查权限');
      setServiceStatus('就绪');
      stopMediaStream();
    }
  }

  function stopVoiceInput() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    setServiceStatus('正在识别');
    recorder.stop();
  }

  async function handleVoiceBlob(blob: Blob) {
    if (blob.size === 0) {
      setVoiceState('error');
      setVoiceError('没有录到声音，请再试一次');
      setServiceStatus('就绪');
      return;
    }

    try {
      setVoiceState('recognizing');
      setServiceStatus('正在识别');
      const text = await recognizeVoiceBlob(blob, mimeTypeRef.current || blob.type);
      setInput(text);
      setVoiceState('idle');
      setServiceStatus('处理中');
      await sendMessage(text);
    } catch (err) {
      setVoiceState('error');
      setVoiceError((err as Error).message || '语音识别失败，请改用文字输入');
      setServiceStatus('就绪');
    }
  }

  function replaceToolResult(messageId: string, oldIndex: number, next: AiToolResult) {
    updateAssistant(messageId, (item) => ({
      ...item,
      status: 'done',
      toolResults: (item.toolResults || []).map((tool, index) => (index === oldIndex ? next : tool)),
    }));
    setServiceStatus('就绪');
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-[calc(env(safe-area-inset-top)+12px)] md:px-5 md:py-5">
        <header className="mb-3 rounded-panel border border-line bg-white px-4 py-3 shadow-panel">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted">
                <span>DeepSeek</span>
                <span className="h-1 w-1 rounded-full bg-emerald-500" />
                <span>AI Executor</span>
              </div>
              <h1 className="mt-1 text-lg font-semibold tracking-normal text-ink">水泵 AI 助手</h1>
              <p className="mt-1 text-sm leading-5 text-muted">支持文字和语音输入，可查询成本、订单、零件、线圈、采购和出图记录。</p>
            </div>
            <StatusBadge tone={serviceStatus === '出错' ? 'red' : serviceStatus === '就绪' ? 'green' : 'blue'}>{serviceStatus}</StatusBadge>
          </div>
        </header>

        <ChatContainer className="min-h-[calc(100vh-190px)]">
          <ChatMessages ref={scrollRef} className="bg-slate-50/80">
            {items.length === 0 ? (
              <div className="grid min-h-[48vh] place-items-center text-center">
                <div className="max-w-sm">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-ink text-white">
                    <Bot size={21} />
                  </div>
                  <h2 className="mt-4 text-base font-semibold text-ink">今天要查什么？</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">可以输入文字，也可以点麦克风说一句任务。涉及写库的操作会先显示确认卡片。</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {suggestions.slice(0, 3).map((suggestion) => (
                      <PromptSuggestion key={suggestion} onClick={() => void sendMessage(suggestion)} disabled={loading}>
                        {suggestion}
                      </PromptSuggestion>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {items.map((item) => (
              <Message key={item.id} role={item.role}>
                <MessageHeader muted={item.role === 'user'}>
                  <span>{item.role === 'user' ? '你' : 'AI'}</span>
                  {item.status && item.status !== 'done' ? (
                    <StatusBadge tone={statusTone(item.status)} className="h-6 min-w-0 px-2">
                      {item.statusMessage || item.status}
                    </StatusBadge>
                  ) : null}
                </MessageHeader>
                {item.content ? (
                  item.role === 'assistant'
                    ? <StreamingText id={item.id} text={item.content} streaming={loading && !['done', 'error', 'confirming', 'cancelled'].includes(item.status || 'idle')} />
                    : <div className="whitespace-pre-wrap">{item.content}</div>
                ) : null}
                {item.role === 'assistant' && loading && !item.content && item.status !== 'error' ? (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 size={15} className="animate-spin" />
                    {item.statusMessage || '处理中...'}
                  </div>
                ) : null}
                <ToolCalls calls={item.toolCalls || []} results={item.toolResults || []} />
                {item.toolResults && item.toolResults.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {item.toolResults.map((tool, index) => (
                      <ToolResultCard key={`${tool.name}-${index}`} item={tool} onConfirmed={(next) => replaceToolResult(item.id, index, next)} />
                    ))}
                  </div>
                ) : null}
              </Message>
            ))}
          </ChatMessages>

          <div className="border-t border-line bg-white px-3 py-2">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {suggestions.map((suggestion) => (
                <PromptSuggestion key={suggestion} onClick={() => void sendMessage(suggestion)} disabled={loading} className="text-xs">
                  {suggestion}
                </PromptSuggestion>
              ))}
            </div>
          </div>

          <PromptInput onSubmit={handleSubmit} className="pb-[max(env(safe-area-inset-bottom),12px)]">
            <PromptInputTextarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onSubmitShortcut={() => void sendMessage(input)}
              placeholder="输入任务，例如：查 V750 成本"
              disabled={loading}
            />
            <PromptInputActions>
              <div className="min-w-0 text-xs text-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <span>Enter 发送</span>
                  <span>Shift+Enter 换行</span>
                  {voiceState === 'recording' ? <span className="font-medium text-rose-600">正在录音</span> : null}
                  {voiceState === 'recognizing' ? <span className="font-medium text-blue-600">正在识别</span> : null}
                </div>
                {voiceError ? <div className="mt-1 text-rose-600">{voiceError}</div> : null}
              </div>
              <div className="flex items-center gap-2">
                {lastPrompt && !loading ? (
                  <Button size="sm" variant="ghost" onClick={() => void sendMessage(lastPrompt)} icon={<RefreshCcw size={15} />}>
                    重试
                  </Button>
                ) : null}
                {loading ? (
                  <Button size="sm" variant="secondary" onClick={stopCurrent} icon={<Square size={14} />}>
                    停止
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant={voiceState === 'recording' ? 'secondary' : 'ghost'}
                      onClick={voiceState === 'recording' ? stopVoiceInput : () => void startVoiceInput()}
                      disabled={voiceState === 'recognizing'}
                      icon={voiceState === 'recording' ? <MicOff size={15} /> : voiceState === 'recognizing' ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
                    >
                      {voiceState === 'recording' ? '结束' : voiceState === 'recognizing' ? '识别中' : '语音'}
                    </Button>
                    <Button type="submit" size="sm" variant="primary" disabled={!input.trim() || voiceState === 'recording' || voiceState === 'recognizing'} icon={<Send size={15} />}>
                      发送
                    </Button>
                  </>
                )}
              </div>
            </PromptInputActions>
          </PromptInput>
        </ChatContainer>
      </div>
    </main>
  );
}
