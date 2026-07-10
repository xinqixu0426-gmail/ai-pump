'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { CircleAlert, Copy, Download, FileText, Link as LinkIcon, Play, Printer, RefreshCw, Save, Trash2 } from 'lucide-react';
import { FadePanel } from '@/components/motion/fade-panel';
import { PresenceRow } from '@/components/motion/presence-row';
import { Button } from '@/components/ui/button';
import { dateShort } from '@/lib/format';
import { getAllModelVariants, getAllTemplates, type PumpModelVariant, type PumpShellTemplate } from '@/lib/recipes';
import {
  bearingOptions,
  deleteRotorHistory,
  emptyRotorForm,
  formFromRotorParams,
  getRotorLinkTargets,
  getRotorHistory,
  getRotorJobStatus,
  getRotorTemplateDraft,
  linkRotorHistory,
  parseRotorParams,
  printRotorDrawing,
  saveRotorParams,
  startRotorDraw,
  type RotorFormData,
  type RotorHistoryRecord,
  type RotorJobStatus,
  type RotorLinkTarget,
} from '@/lib/rotor';
import { calculateBearingSpan, openOffsetFromMeta, stainlessBarrelDrawingText } from '@/lib/technical-references';

const numberFields: Array<{ key: keyof RotorFormData; label: string; placeholder?: string }> = [
  { key: 'piece_count', label: '片数' },
  { key: 'rotor_dia', label: '转子直径' },
  { key: 'bearing_span', label: '开档' },
  { key: 'stack_offset', label: '定位' },
  { key: 'oil_seal_dia', label: '油封孔径' },
  { key: 'impeller_dia', label: '叶轮孔径' },
  { key: 'impeller_span', label: '叶轮开档' },
  { key: 'impeller_depth', label: '叶轮厚度' },
  { key: 'thread_length', label: '螺纹长度' },
  { key: 'thread_dia', label: '螺纹直径' },
];

function statusLabel(status: string): { label: string; className: string } {
  if (status === 'success') return { label: '完成', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (status === 'failed') return { label: '失败', className: 'border-rose-200 bg-rose-50 text-rose-700' };
  if (status === 'saved') return { label: '暂存', className: 'border-slate-200 bg-slate-50 text-slate-700' };
  return { label: '处理中', className: 'border-amber-200 bg-amber-50 text-amber-700' };
}

function downloadUrl(fileUrl: string): string {
  if (!fileUrl) return '#';
  if (/^https?:\/\//.test(fileUrl)) return fileUrl;
  return `${process.env.NEXT_PUBLIC_API_BASE_URL || ''}${fileUrl}`;
}

export function RotorView() {
  const [form, setForm] = useState<RotorFormData>(emptyRotorForm);
  const [drawingName, setDrawingName] = useState('');
  const [drawingText, setDrawingText] = useState('');
  const [history, setHistory] = useState<RotorHistoryRecord[]>([]);
  const [templates, setTemplates] = useState<PumpShellTemplate[]>([]);
  const [variants, setVariants] = useState<PumpModelVariant[]>([]);
  const [selectedShellMeta, setSelectedShellMeta] = useState<Record<string, unknown> | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [templateHint, setTemplateHint] = useState('');
  const [ssBarrelLength, setSsBarrelLength] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printingJobId, setPrintingJobId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<RotorJobStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkRow, setLinkRow] = useState<RotorHistoryRecord | null>(null);
  const [linkTargets, setLinkTargets] = useState<RotorLinkTarget[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const pollRef = useRef<number | null>(null);
  const autoDrawingTextRef = useRef('');

  async function load(force = false) {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      setHistory(await getRotorHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : '出图历史加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
    void loadAuxiliaryData();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  async function loadAuxiliaryData() {
    try {
      const [templateRows, variantRows] = await Promise.all([
        getAllTemplates(),
        getAllModelVariants(),
      ]);
      setTemplates(templateRows);
      setVariants(variantRows);
    } catch {
      // The page can still draw manually when auxiliary template data is unavailable.
    }
  }

  const stats = useMemo(() => {
    return {
      total: history.length,
      success: history.filter((row) => row.status === 'success').length,
      saved: history.filter((row) => row.status === 'saved').length,
    };
  }, [history]);

  const filteredVariants = useMemo(
    () => variants.filter((variant) => !selectedTemplateId || String(variant.templateId) === selectedTemplateId),
    [selectedTemplateId, variants]
  );
  const ssOpenOffset = openOffsetFromMeta(selectedShellMeta);

  function updateForm(key: keyof RotorFormData, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyAutoDrawingText(text: string) {
    const nextAuto = text.trim();
    const previousAuto = autoDrawingTextRef.current;
    autoDrawingTextRef.current = nextAuto;
    if (!nextAuto) return;
    setDrawingText((current) => {
      const trimmed = current.trim();
      return !trimmed || trimmed === previousAuto ? nextAuto : current;
    });
  }

  async function applyTemplate(template: PumpShellTemplate | null, variant?: PumpModelVariant | null) {
    if (!template) {
      setSelectedTemplateId('');
      setSelectedVariantId('');
      setTemplateHint('');
      setSsBarrelLength('');
      setSelectedShellMeta(null);
      return;
    }

    try {
      const draft = await getRotorTemplateDraft(template.id, variant?.id);
      setSelectedShellMeta(draft.meta);
      if (draft.barrelLength) {
        setSsBarrelLength(String(draft.barrelLength));
      }
      if (draft.drawingText) {
        applyAutoDrawingText(draft.drawingText);
      }
      setForm((current) => ({ ...current, ...draft.patch }));
      setTemplateHint(draft.hints.length > 0 ? `已从 ${template.shellModel} 带入：${draft.hints.join('、')}` : `已选择 ${template.shellModel}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '转子模板草稿生成失败');
    }
  }

  function onTemplateChange(nextTemplateId: string) {
    setSelectedTemplateId(nextTemplateId);
    setSelectedVariantId('');
    const template = templates.find((item) => String(item.id) === nextTemplateId) || null;
    void applyTemplate(template, null);
  }

  function onVariantChange(nextVariantId: string) {
    setSelectedVariantId(nextVariantId);
    const variant = variants.find((item) => String(item.id) === nextVariantId) || null;
    if (!variant) return;
    const template = templates.find((item) => item.id === variant.templateId) || null;
    if (template) setSelectedTemplateId(String(template.id));
    void applyTemplate(template, variant);
  }

  function updateSsBarrelLength(value: string) {
    setSsBarrelLength(value);
    const span = calculateBearingSpan(value, ssOpenOffset);
    if (selectedShellMeta?.isStainless) applyAutoDrawingText(stainlessBarrelDrawingText(value));
    setForm((current) => ({
      ...current,
      bearing_span: span || (value ? current.bearing_span : ''),
    }));
  }

  function clearPoll() {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }

  function beginPoll(nextJobId: string) {
    clearPoll();
    const tick = async () => {
      const status = await getRotorJobStatus(nextJobId);
      setJobStatus(status);
      if (status.status === 'success' || status.status === 'failed') {
        clearPoll();
        await load(true);
      }
    };
    void tick();
    pollRef.current = window.setInterval(() => void tick(), 2500);
  }

  async function saveOnly() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await saveRotorParams(form, drawingName, drawingText);
      setJobId(result.jobId);
      setJobStatus({ status: 'saved', drawingName: result.drawingName });
      setMessage('参数已暂存');
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '参数保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function draw() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await startRotorDraw(form, drawingName, drawingText);
      setJobId(result.jobId);
      setJobStatus({ status: 'processing', drawingName: result.drawingName });
      setMessage(result.message || '出图任务已启动');
      beginPoll(result.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '出图任务启动失败');
    } finally {
      setSaving(false);
    }
  }

  function reuse(row: RotorHistoryRecord) {
    const params = parseRotorParams(row.paramsJson);
    setForm(formFromRotorParams(params));
    setDrawingName(row.drawingName ? `${row.drawingName}-复用` : '');
    setDrawingText(String(params.drawingText || params.drawing_text || ''));
    setMessage('已复用历史参数');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function openLinkDialog(row: RotorHistoryRecord) {
    setLinkRow(row);
    setLinkLoading(true);
    setError(null);
    try {
      setLinkTargets(await getRotorLinkTargets());
    } catch (err) {
      setError(err instanceof Error ? err.message : '关联对象加载失败');
      setLinkTargets([]);
    } finally {
      setLinkLoading(false);
    }
  }

  async function linkToTarget(target: RotorLinkTarget) {
    if (!linkRow) return;
    setLinkLoading(true);
    setError(null);
    try {
      await linkRotorHistory(linkRow.id, target.value);
      setMessage(`已关联到 ${target.label}`);
      setLinkRow(null);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '关联出图记录失败');
    } finally {
      setLinkLoading(false);
    }
  }

  async function print(row: RotorHistoryRecord) {
    setPrintingJobId(row.jobId);
    setError(null);
    setMessage(null);
    try {
      setMessage(await printRotorDrawing(row.jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '打印失败');
    } finally {
      setPrintingJobId(null);
    }
  }

  async function remove(row: RotorHistoryRecord) {
    if (!window.confirm(`确定删除「${row.drawingName || row.jobId}」？`)) return;
    setSaving(true);
    setError(null);
    try {
      await deleteRotorHistory(row.id);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除出图记录失败');
    } finally {
      setSaving(false);
    }
  }

  const activeStatus = jobStatus ? statusLabel(jobStatus.status) : null;

  return (
    <div className="space-y-5">
      <FadePanel className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Rotor</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">转子出图</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">结构化参数出图，支持暂存、轮询任务状态和历史 PDF 下载。</p>
        </div>
        <Button onClick={() => void load(true)} disabled={refreshing || saving} icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}>
          刷新
        </Button>
      </FadePanel>

      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <CircleAlert size={16} />
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>
      ) : null}
      {templateHint ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-700">{templateHint}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-panel border border-line bg-white p-4 shadow-panel">
          <div className="text-2xl font-semibold tracking-tight text-ink">{stats.total}</div>
          <div className="mt-1 text-xs text-muted">历史记录</div>
        </div>
        <div className="rounded-panel border border-line bg-white p-4 shadow-panel">
          <div className="text-2xl font-semibold tracking-tight text-ink">{stats.success}</div>
          <div className="mt-1 text-xs text-muted">成功出图</div>
        </div>
        <div className="rounded-panel border border-line bg-white p-4 shadow-panel">
          <div className="text-2xl font-semibold tracking-tight text-ink">{stats.saved}</div>
          <div className="mt-1 text-xs text-muted">暂存参数</div>
        </div>
      </div>

      <FadePanel className="grid gap-5 xl:grid-cols-[440px_1fr]">
        <div className="rounded-panel border border-line bg-white">
          <div className="border-b border-line p-4">
            <div className="text-sm font-semibold text-ink">出图参数</div>
            <div className="mt-1 text-xs text-muted">填写任意有效参数即可暂存；生成 PDF 建议补齐长度相关字段。</div>
          </div>
          <div className="space-y-4 p-4">
            <div className="rounded-md border border-line bg-slate-50 p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                <LinkIcon size={15} />
                关联模板
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-muted">泵壳模板</span>
                  <select
                    value={selectedTemplateId}
                    onChange={(event) => onTemplateChange(event.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  >
                    <option value="">不使用模板</option>
                    {templates.map((template) => (
                      <option key={template.id} value={String(template.id)}>
                        {template.shellModel}{template.description ? ` - ${template.description}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">型号变体</span>
                  <select
                    value={selectedVariantId}
                    onChange={(event) => onVariantChange(event.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  >
                    <option value="">不使用变体</option>
                    {filteredVariants.map((variant) => (
                      <option key={variant.id} value={String(variant.id)}>
                        {variant.modelName}{variant.barrelLength ? ` - ${variant.barrelLength}mm` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedShellMeta?.isStainless && ssOpenOffset != null ? (
                <div className="mt-3 rounded-md border border-sky-100 bg-white p-3">
                  <div className="text-xs font-medium text-muted">SS 机筒开档</div>
                  <div className="mt-2 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                    <label className="block">
                      <span className="text-xs text-muted">机筒长度 mm，开档 = 机筒长度 - {ssOpenOffset}</span>
                      <input
                        value={ssBarrelLength}
                        onChange={(event) => updateSsBarrelLength(event.target.value)}
                        type="number"
                        min="0"
                        step="0.1"
                        className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                      />
                    </label>
                    <div className="rounded-md border border-line bg-slate-50 px-3 py-2 text-sm text-muted">
                      开档 {calculateBearingSpan(ssBarrelLength, ssOpenOffset) || '-'} mm
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <label className="block">
              <span className="text-sm font-medium text-ink">图纸名称</span>
              <input
                value={drawingName}
                onChange={(event) => setDrawingName(event.target.value)}
                className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                placeholder="例如：1500W 转子"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">图纸备注</span>
              <input
                value={drawingText}
                onChange={(event) => setDrawingText(event.target.value)}
                maxLength={120}
                className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                placeholder="显示在图纸上的短文本"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">上轴承</span>
                <select
                  value={form.upper_bearing}
                  onChange={(event) => updateForm('upper_bearing', event.target.value)}
                  className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                >
                  {bearingOptions.map((bearing) => <option key={bearing || 'empty'} value={bearing}>{bearing || '未指定'}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">下轴承</span>
                <select
                  value={form.lower_bearing}
                  onChange={(event) => updateForm('lower_bearing', event.target.value)}
                  className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                >
                  {bearingOptions.map((bearing) => <option key={bearing || 'empty'} value={bearing}>{bearing || '未指定'}</option>)}
                </select>
              </label>
              {numberFields.map((field) => (
                <label key={field.key} className="block">
                  <span className="text-sm font-medium text-ink">{field.label}</span>
                  <input
                    value={form[field.key]}
                    onChange={(event) => updateForm(field.key, event.target.value)}
                    type="number"
                    min="0"
                    step="0.1"
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                  />
                </label>
              ))}
            </div>
            {activeStatus ? (
              <div className="rounded-md border border-line bg-slate-50 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ink">{jobId}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${activeStatus.className}`}>{activeStatus.label}</span>
                </div>
                {jobStatus?.fileUrl ? (
                  <a className="mt-2 inline-flex text-sm font-medium text-ink underline" href={downloadUrl(jobStatus.fileUrl)} target="_blank" rel="noreferrer">
                    打开 PDF
                  </a>
                ) : null}
                {jobStatus?.error ? <div className="mt-2 text-rose-700">{jobStatus.error}</div> : null}
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 border-t border-line p-4">
            <Button type="button" variant="ghost" onClick={() => { setForm(emptyRotorForm); setDrawingName(''); setDrawingText(''); setSelectedTemplateId(''); setSelectedVariantId(''); setTemplateHint(''); setSsBarrelLength(''); }}>
              清空
            </Button>
            <Button type="button" onClick={() => void saveOnly()} disabled={saving} icon={<Save size={15} />}>
              暂存
            </Button>
            <Button type="button" variant="primary" onClick={() => void draw()} disabled={saving} icon={<Play size={15} />}>
              生成 PDF
            </Button>
          </div>
        </div>

        <div className="min-w-0 rounded-panel border border-line bg-white">
          <div className="border-b border-line p-4">
            <div className="text-sm font-semibold text-ink">出图历史</div>
            <div className="mt-1 text-xs text-muted">最近 100 条记录。</div>
          </div>
          {loading ? (
            <div className="p-6 text-sm text-muted">加载中...</div>
          ) : history.length === 0 ? (
            <div className="p-6 text-sm text-muted">暂无出图记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">图纸</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">关联型号</th>
                    <th className="px-4 py-3 font-medium">时间</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {history.map((row) => {
                      const status = statusLabel(row.status);
                      return (
                        <PresenceRow key={row.id}>
                          <td className="border-b border-line px-4 py-3">
                            <div className="font-medium text-ink">{row.drawingName || row.jobId}</div>
                            <div className="mt-1 text-xs text-muted">{row.jobId}</div>
                            {row.error ? <div className="mt-1 text-xs text-rose-700">{row.error}</div> : null}
                          </td>
                          <td className="border-b border-line px-4 py-3">
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${status.className}`}>{status.label}</span>
                          </td>
                          <td className="border-b border-line px-4 py-3 text-muted">{row.linkedPumpModel || '-'}</td>
                          <td className="border-b border-line px-4 py-3 text-muted">{dateShort(row.createdAt)}</td>
                          <td className="border-b border-line px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="ghost" onClick={() => reuse(row)} icon={<Copy size={14} />}>
                                复用
                              </Button>
                              <Button size="sm" variant="ghost" disabled={linkLoading} onClick={() => void openLinkDialog(row)} icon={<LinkIcon size={14} />}>
                                关联
                              </Button>
                              {row.fileUrl ? (
                                <a
                                  href={downloadUrl(row.fileUrl)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-transparent bg-transparent px-2.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-slate-100 hover:text-ink"
                                >
                                  <Download size={14} />
                                  PDF
                                </a>
                              ) : (
                                <Button size="sm" variant="ghost" disabled icon={<FileText size={14} />}>
                                  PDF
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" disabled={row.status !== 'success' || printingJobId === row.jobId} onClick={() => void print(row)} icon={<Printer size={14} />}>
                                打印
                              </Button>
                              <Button size="sm" variant="danger" disabled={saving} onClick={() => void remove(row)} icon={<Trash2 size={14} />}>
                                删除
                              </Button>
                            </div>
                          </td>
                        </PresenceRow>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </FadePanel>

      {linkRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
          <div className="w-full max-w-xl rounded-panel border border-line bg-white shadow-panel">
            <div className="flex items-center justify-between gap-3 border-b border-line p-4">
              <div>
                <div className="text-sm font-semibold text-ink">关联出图记录</div>
                <div className="mt-1 text-xs text-muted">{linkRow.drawingName || linkRow.jobId}</div>
              </div>
              <Button type="button" variant="ghost" onClick={() => setLinkRow(null)} disabled={linkLoading}>
                关闭
              </Button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4">
              {linkLoading ? (
                <div className="text-sm text-muted">加载中...</div>
              ) : linkTargets.length === 0 ? (
                <div className="rounded-md border border-dashed border-line p-4 text-sm text-muted">暂无可关联对象</div>
              ) : (
                <div className="space-y-2">
                  {linkTargets.map((target) => (
                    <button
                      key={`${target.type}-${target.id}`}
                      type="button"
                      onClick={() => void linkToTarget(target)}
                      className="block w-full rounded-md border border-line px-3 py-2 text-left transition-colors duration-150 hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-ink">{target.label}</span>
                        <span className="rounded-full border border-line bg-slate-50 px-2 py-0.5 text-xs text-muted">
                          {target.type === 'order' ? '订单' : target.type === 'variant' ? '变体' : '配方'}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted">{target.secondary}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
