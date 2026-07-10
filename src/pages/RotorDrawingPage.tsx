import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box, Paper, Typography, TextField, Button,
  Alert, CircularProgress,
  LinearProgress, Autocomplete, Snackbar,
  Dialog, DialogTitle, DialogContent, DialogActions,
  List, ListItemButton, ListItemText, ListItemIcon
} from '@mui/material';
import {
  FileText as PdfIcon,
  CheckCircle as CheckIcon,
  AlertCircle as ErrorIcon,
  Link as LinkIcon,
  Printer as PrintIcon,
  Package as PackageIcon,
  Copy as CopyIcon
} from 'lucide-react';
import { getAllTemplates, getAllParts, getAllModelVariants, proxyFetch, proxyRequest } from '../utils/api';
import type { PumpShellTemplate, Part, PumpShellMeta, PumpModelVariant } from '../types';
import { normalizeRotorHistoryRows, parseRotorFcParams, RotorHistoryRecord } from '../utils/rotorHistory';
import PageHeader from '../components/PageHeader';
import { normalizeBearing, JobStatus } from '../components/rotor/rotorConstants';
import RotorFormPanel, { RotorFormData } from '../components/rotor/RotorFormPanel';
import RotorHistoryTable from '../components/rotor/RotorHistoryTable';

const API_BASE = import.meta.env.VITE_API_URL || '';

type RotorLinkTargetType = 'order' | 'variant' | 'recipe';

interface RotorLinkTarget {
  type: RotorLinkTargetType;
  id: string;
  label: string;
  value: string;
  secondary: string;
}

const LINK_TARGET_LABELS: Record<RotorLinkTargetType, string> = {
  order: '订单型号',
  variant: '型号变体',
  recipe: '配方',
};

const emptyRotorForm = (): RotorFormData => ({
  upper_bearing: '', lower_bearing: '',
  piece_count: '', rotor_dia: '', bearing_span: '', stack_offset: '',
  oil_seal_dia: '', impeller_dia: '', impeller_span: '', impeller_depth: '',
  thread_length: '', thread_dia: ''
});

const bearingFromDia = (value: unknown) => {
  const dia = Number(value);
  if (dia === 12) return '6201';
  if (dia === 15) return '6202';
  if (dia === 17) return '6203';
  if (dia === 20) return '6204';
  if (dia === 25) return '6205';
  return '';
};

const asFormValue = (value: unknown) => value === undefined || value === null || value === '' ? '' : String(value);

const openOffsetFromMeta = (meta: PumpShellMeta | null) => meta?.openOffset ?? meta?.openFactor ?? null;

const calculateBearingSpan = (barrelLength: string | number, openOffset: number | null) => {
  const length = Number(barrelLength);
  const offset = Number(openOffset);
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(offset)) return '';
  return String(Number((length - offset).toFixed(1)));
};

const stainlessBarrelDrawingText = (barrelLength: string | number | null | undefined) => {
  const length = Number(barrelLength);
  if (!Number.isFinite(length) || length <= 0) return '';
  return `不锈钢机筒：${Number(length.toFixed(1))}mm`;
};

const normalizeShellModel = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const shellModelCandidates = (value: string) => {
  const normalized = normalizeShellModel(value);
  const withoutSuffix = normalized.replace(/-[a-z0-9]+$/i, '');
  return withoutSuffix === normalized ? [normalized] : [normalized, withoutSuffix];
};

function formFromFcParams(params: Record<string, unknown>): RotorFormData {
  return {
    upper_bearing: asFormValue(params.upper_bearing) || bearingFromDia(params.upper_bearing_dia),
    lower_bearing: asFormValue(params.lower_bearing) || bearingFromDia(params.lower_bearing_dia),
    piece_count: asFormValue(params.piece_count),
    rotor_dia: asFormValue(params.rotor_dia),
    bearing_span: asFormValue(params.bearing_span),
    stack_offset: asFormValue(params.stack_offset),
    oil_seal_dia: asFormValue(params.oil_seal_dia),
    impeller_dia: asFormValue(params.impeller_dia),
    impeller_span: asFormValue(params.impeller_span) || asFormValue(params.bearing_to_impeller),
    impeller_depth: asFormValue(params.impeller_depth),
    thread_length: asFormValue(params.thread_length),
    thread_dia: asFormValue(params.thread_dia),
  };
}

function sanitizeDownloadName(value: string) {
  return `${(value || '转子图纸').trim().replace(/[\\/:*?"<>|]/g, '_') || '转子图纸'}.pdf`;
}

function normalizeJobStatus(status: string): JobStatus['status'] {
  if (status === 'success' || status === 'failed') return status;
  return 'processing';
}

export default function RotorDrawingPage() {
  const [nlLoading, setNlLoading] = useState(false);
  const [form, setForm] = useState<RotorFormData>(emptyRotorForm);
  const [drawingName, setDrawingName] = useState('');
  const [drawingText, setDrawingText] = useState('');

  const [templates, setTemplates] = useState<PumpShellTemplate[]>([]);
  const [modelVariants, setModelVariants] = useState<PumpModelVariant[]>([]);
  const [allParts, setAllParts] = useState<Part[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PumpShellTemplate | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<PumpModelVariant | null>(null);
  const [templateHint, setTemplateHint] = useState('');

  const [ssMeta, setSsMeta] = useState<PumpShellMeta | null>(null);
  const [ssBarrelLength, setSsBarrelLength] = useState('');

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<RotorHistoryRecord[]>([]);
  const [printing, setPrinting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkTargetRow, setLinkTargetRow] = useState<RotorHistoryRecord | null>(null);
  const [linkTargets, setLinkTargets] = useState<RotorLinkTarget[]>([]);
  const [linking, setLinking] = useState(false);
  const [savingParams, setSavingParams] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeJobDrawingNameRef = useRef('');
  const autoDrawingTextRef = useRef('');

  useEffect(() => {
    getAllTemplates().then(setTemplates).catch(() => {});
    getAllModelVariants().then(setModelVariants).catch(() => {});
    getAllParts().then(setAllParts).catch(() => {});
  }, []);

  const findShellMetaForTemplate = useCallback((tpl: PumpShellTemplate | null): PumpShellMeta | null => {
    if (!tpl) return null;
    const candidates = shellModelCandidates(tpl.shellModel);
    const shellPart = candidates
      .map(candidate => allParts.find(p => p.category === '泵壳' && normalizeShellModel(p.model) === candidate))
      .find(Boolean);
    if (!shellPart?.notes) return null;
    try {
      return JSON.parse(shellPart.notes) as PumpShellMeta;
    } catch {
      return null;
    }
  }, [allParts]);

  const applyAutoDrawingText = useCallback((text: string) => {
    const nextAuto = text.trim();
    const previousAuto = autoDrawingTextRef.current;
    autoDrawingTextRef.current = nextAuto;
    if (!nextAuto) return;
    setDrawingText(prev => {
      const current = prev.trim();
      if (!current || current === previousAuto) return nextAuto;
      return prev;
    });
  }, []);

  const applyTemplate = useCallback((tpl: PumpShellTemplate | null, variant?: PumpModelVariant | null) => {
    setSelectedTemplate(tpl);
    setSsMeta(null);
    setSsBarrelLength('');
    if (!tpl) { setTemplateHint(''); return; }

    const newForm: RotorFormData = emptyRotorForm();
    const hints: string[] = [];

    try {
      const parts: Array<{ name: string; model: string }> = JSON.parse(tpl.partsJson || '[]');
      for (const p of parts) {
        const name = (p.name || '').trim();
        const model = (p.model || '').trim();
        if (!name || !model) continue;

        if (name.includes('花板') && name.includes('轴承')) {
          const b = normalizeBearing(model); newForm.upper_bearing = b; hints.push(`上轴承${b}`);
        }
        if (name.includes('油缸') && name.includes('轴承')) {
          const b = normalizeBearing(model); newForm.lower_bearing = b; hints.push(`下轴承${b}`);
        }
        if (name.includes('机械油封') || (name.includes('机封') && !name.includes('骨架'))) {
          const d = parseFloat(model.split('*')[0].trim());
          if (!isNaN(d)) { newForm.oil_seal_dia = String(d); hints.push(`油封孔径${d}mm`); }
        }
      }

      const meta = findShellMetaForTemplate(tpl);
      if (meta) {
          if (!newForm.upper_bearing && meta.defaultUpperBearing) { newForm.upper_bearing = meta.defaultUpperBearing; hints.push(`预设上轴承${newForm.upper_bearing}`); }
          if (!newForm.lower_bearing && meta.defaultLowerBearing) { newForm.lower_bearing = meta.defaultLowerBearing; hints.push(`预设下轴承${newForm.lower_bearing}`); }
          if (!newForm.oil_seal_dia && meta.defaultOilSealDia != null) { newForm.oil_seal_dia = String(meta.defaultOilSealDia); hints.push(`预设油封孔径${newForm.oil_seal_dia}mm`); }

          const openOffset = openOffsetFromMeta(meta);
          if (meta.isStainless && openOffset != null) {
            setSsMeta(meta);
            hints.push(`开档偏移量${openOffset}mm`);
          }
          if (!newForm.bearing_span) {
            if (meta.defaultBearingSpan != null) { newForm.bearing_span = String(meta.defaultBearingSpan); hints.push(`预设开档${meta.defaultBearingSpan}mm`); }
          }
          if (!newForm.impeller_dia && meta.defaultImpellerDia != null) { newForm.impeller_dia = String(meta.defaultImpellerDia); hints.push(`预设叶轮孔径${meta.defaultImpellerDia}mm`); }
          if (!newForm.impeller_span && meta.defaultImpellerSpan != null) { newForm.impeller_span = String(meta.defaultImpellerSpan); hints.push(`预设叶轮开档${meta.defaultImpellerSpan}mm`); }
          if (!newForm.impeller_depth && meta.defaultImpellerDepth != null) { newForm.impeller_depth = String(meta.defaultImpellerDepth); hints.push(`预设叶轮厚度${meta.defaultImpellerDepth}mm`); }
          if (!newForm.thread_length && meta.defaultThreadLength != null) { newForm.thread_length = String(meta.defaultThreadLength); hints.push(`预设螺丝长度${meta.defaultThreadLength}mm`); }
          if (!newForm.thread_dia && meta.defaultThreadDia != null) { newForm.thread_dia = String(meta.defaultThreadDia); hints.push(`预设螺纹直径${meta.defaultThreadDia}mm`); }
          if (!newForm.stack_offset && meta.defaultStackOffset != null) { newForm.stack_offset = String(meta.defaultStackOffset); hints.push(`预设定位${meta.defaultStackOffset}mm`); }
      }
    } catch { /* ignore invalid template json */ }

    const meta = findShellMetaForTemplate(tpl);
    const openOffset = openOffsetFromMeta(meta);
    if (meta?.isStainless && meta.barrelLength) {
      applyAutoDrawingText(stainlessBarrelDrawingText(meta.barrelLength));
    }
    if (variant?.barrelLength && openOffset != null) {
      const span = calculateBearingSpan(variant.barrelLength, openOffset);
      if (span) {
        newForm.bearing_span = span;
        setSsMeta(meta);
        setSsBarrelLength(String(variant.barrelLength));
        applyAutoDrawingText(stainlessBarrelDrawingText(variant.barrelLength));
        hints.push(`${variant.modelName}机筒${variant.barrelLength}mm，自动开档${span}mm`);
      }
    }

    setForm(prev => ({ ...prev, ...newForm }));
    setTemplateHint(hints.length > 0 ? `已从 ${tpl.shellModel} 模板自动带入：${hints.join('、')}` : '');
  }, [applyAutoDrawingText, findShellMetaForTemplate]);

  const handleTemplateSelect = useCallback((tpl: PumpShellTemplate | null) => {
    setSelectedVariant(null);
    applyTemplate(tpl, null);
  }, [applyTemplate]);

  const handleVariantSelect = useCallback((variant: PumpModelVariant | null) => {
    setSelectedVariant(variant);
    if (!variant) return;
    const tpl = templates.find(t => t.Id === variant.templateId) || null;
    applyTemplate(tpl, variant);
  }, [applyTemplate, templates]);

  useEffect(() => {
    const span = calculateBearingSpan(ssBarrelLength, openOffsetFromMeta(ssMeta));
    if (span) {
      setForm(prev => prev.bearing_span === span ? prev : { ...prev, bearing_span: span });
    }
  }, [ssBarrelLength, ssMeta]);

  const updateSsBarrelLength = useCallback((value: string) => {
    setSsBarrelLength(value);
    const span = calculateBearingSpan(value, openOffsetFromMeta(ssMeta));
    if (ssMeta?.isStainless) {
      applyAutoDrawingText(stainlessBarrelDrawingText(value));
    }
    setForm(prev => ({
      ...prev,
      bearing_span: span || (value ? prev.bearing_span : ''),
    }));
  }, [applyAutoDrawingText, ssMeta]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await proxyRequest<any[] | { success: boolean; data: any[] }>('/api/rotor/history');
      setHistory(normalizeRotorHistoryRows(Array.isArray(res) ? res : res.data));
    } catch { /* ignore history refresh errors */ }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setJobStatus({ status: 'processing', drawingName: activeJobDrawingNameRef.current });

    pollRef.current = setInterval(async () => {
      try {
        const res = await proxyFetch(`/api/rotor/status/${jobId}`, {}, { throwOnError: false });
        if (res.status === 404) {
          if (pollRef.current) clearInterval(pollRef.current);
          const histRes = await proxyFetch('/api/rotor/history', {}, { throwOnError: false });
          if (histRes.ok) {
            const histData = await histRes.json();
            const rows = Array.isArray(histData) ? histData : histData.data || [];
            const normalizedRows = normalizeRotorHistoryRows(rows);
            const found = normalizedRows.find((r) => r.jobId === jobId);
            if (found) setJobStatus({ status: normalizeJobStatus(found.status), fileUrl: found.fileUrl, error: found.error, drawingName: found.drawingName });
            else setJobStatus({ status: 'failed', error: '任务已过期，未找到记录' });
          }
          loadHistory();
          return;
        }
        const data: JobStatus = await res.json();
        if (cancelled) return;
        setJobStatus(data);
        if (data.status === 'success' || data.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          loadHistory();
        }
      } catch {
        // Keep polling while the backend is busy.
      }
    }, 2000);

    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId, loadHistory]);

  const handleFormSubmit = async () => {
    const hasAnyParam = Object.values(form).some(value => String(value || '').trim() !== '');
    if (!hasAnyParam) { setError('请至少填写一项参数'); return; }

    setError('');
    setNlLoading(true);
    setJobId(null);
    setJobStatus(null);

    try {
      const submittedDrawingName = drawingName.trim();
      activeJobDrawingNameRef.current = submittedDrawingName;
      const body = { ...form, drawingName: submittedDrawingName, drawingText: drawingText.trim() };
      const data = await proxyRequest<any>('/api/rotor/draw', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      if (data.status === 'success') {
        setJobId(data.jobId);
        setJobStatus({ status: 'processing', drawingName: data.drawingName || submittedDrawingName });
        setTimeout(loadHistory, 2000);
      } else {
        setError(data.message || '出图任务启动失败');
      }
    } catch (e: any) {
      setError('请求失败: ' + e.message);
    } finally {
      setNlLoading(false);
    }
  };

  const handleSaveParams = async () => {
    const hasAnyParam = Object.values(form).some(value => String(value || '').trim() !== '');
    if (!hasAnyParam) { setError('请至少填写一项参数'); return; }

    setError('');
    setSavingParams(true);

    try {
      const submittedDrawingName = drawingName.trim();
      await proxyRequest<any>('/api/rotor/save', {
        method: 'POST',
        body: JSON.stringify({ ...form, drawingName: submittedDrawingName, drawingText: drawingText.trim() })
      });
      setSnackbar({ open: true, message: '参数已保存到保存历史', severity: 'success' });
      loadHistory();
    } catch (e: any) {
      setError('保存失败: ' + e.message);
    } finally {
      setSavingParams(false);
    }
  };

  const updateForm = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const handleDrawingNameChange = (value: string) => {
    setDrawingName(value);
    if (jobStatus && jobStatus.status !== 'processing') {
      setJobId(null);
      setJobStatus(null);
    }
  };

  const handleDrawingTextChange = (value: string) => {
    autoDrawingTextRef.current = '';
    setDrawingText(value);
    if (jobStatus && jobStatus.status !== 'processing') {
      setJobId(null);
      setJobStatus(null);
    }
  };

  const reuseParamsFromRow = useCallback((row: RotorHistoryRecord) => {
    const params = parseRotorFcParams(row);
    const nextForm = formFromFcParams(params);
    setForm(prev => ({ ...prev, ...nextForm }));
    autoDrawingTextRef.current = '';
    setDrawingText(asFormValue(params._drawing_text) || asFormValue(params.drawing_text));
    if (row.drawingName) setDrawingName(`${row.drawingName}-复用`);
    setSnackbar({ open: true, message: '已复用历史图纸参数', severity: 'success' });
  }, []);

  const latestReusableRow = history.find(row => row.fcParamsJson);

  const handleReuseLatest = useCallback(() => {
    if (!latestReusableRow) return;
    reuseParamsFromRow(latestReusableRow);
  }, [latestReusableRow, reuseParamsFromRow]);

  const handlePrint = useCallback(async (targetJobId: string) => {
    setPrinting(true);
    try {
      const res = await proxyFetch(`/api/rotor/print/${targetJobId}`, { method: 'POST' }, { throwOnError: false });
      const data = await res.json();
      if (res.ok && (data.ok || data.success)) setSnackbar({ open: true, message: '打印指令已发送到默认打印机', severity: 'success' });
      else setSnackbar({ open: true, message: '打印失败: ' + (data.error || '未知错误'), severity: 'error' });
    } catch (e: any) { setSnackbar({ open: true, message: '打印请求失败: ' + e.message, severity: 'error' }); }
    finally { setPrinting(false); }
  }, []);

  const handleLinkClick = useCallback(async (row: RotorHistoryRecord) => {
    setLinkTargetRow(row);
    try {
      const res = await proxyRequest<RotorLinkTarget[] | { success: boolean; data: RotorLinkTarget[] }>('/api/rotor/link-targets');
      setLinkTargets(Array.isArray(res) ? res : res.data);
    } catch { setLinkTargets([]); }
    setLinkDialogOpen(true);
  }, []);

  const handleLinkConfirm = useCallback(async (target: RotorLinkTarget) => {
    if (!linkTargetRow) return;
    setLinking(true);
    try {
      const res = await proxyFetch(`/api/rotor/history/${linkTargetRow.id}/link`, {
        method: 'PATCH',
        body: JSON.stringify({ linkedPumpModel: target.value })
      }, { throwOnError: false });
      if (res.ok) {
        setSnackbar({ open: true, message: `已关联到 ${target.label}`, severity: 'success' });
        loadHistory();
      } else {
        const data = await res.json();
        setSnackbar({ open: true, message: '关联失败: ' + (data.error || '未知错误'), severity: 'error' });
      }
    } catch (e: any) {
      setSnackbar({ open: true, message: '请求失败: ' + e.message, severity: 'error' });
    } finally {
      setLinking(false);
      setLinkDialogOpen(false);
      setLinkTargetRow(null);
    }
  }, [linkTargetRow, loadHistory]);

  return (
    <Box sx={{ maxWidth: { xs: '100%', lg: 1100 }, margin: '0 auto', pb: 6 }}>
      <PageHeader title="转子出图系统" subtitle="填写参数后自动生成转子工程图纸" />

      <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 3, bgcolor: 'background.default' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <LinkIcon size={18} color="#2563eb" />
          <Typography variant="subtitle2">关联泵壳模板（可选）</Typography>
        </Box>
        <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr' }} gap={1.5}>
          <Autocomplete
            size="small" options={templates}
            getOptionLabel={(o) => o.shellModel + (o.description ? ` - ${o.description}` : '')}
            value={selectedTemplate} onChange={(_, v) => handleTemplateSelect(v)}
            renderInput={(params) => <TextField {...params} placeholder="选择泵壳模板，自动带入轴承/油封/开档参数" />}
            isOptionEqualToValue={(o, v) => o.Id === v.Id}
          />
          <Autocomplete
            size="small" options={modelVariants}
            getOptionLabel={(o) => o.modelName + (o.barrelLength ? ` - ${o.barrelLength}mm` : '')}
            value={selectedVariant} onChange={(_, v) => handleVariantSelect(v)}
            renderInput={(params) => <TextField {...params} placeholder="选择泵壳变体，自动计算开档" />}
            isOptionEqualToValue={(o, v) => o.Id === v.Id}
          />
        </Box>
        {ssMeta && (
          <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, border: '1px solid #bae6fd', bgcolor: '#f0f9ff' }}>
            <Typography variant="body2" fontWeight={700} color="#0369a1" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              SS机筒长度
            </Typography>
            <Box display="flex" flexDirection="column" gap={1.5}>
              <Typography variant="caption" color="text.secondary">
                开档偏移量：{openOffsetFromMeta(ssMeta)} mm，填写机筒长度后自动写入图纸参数“开档”。
              </Typography>
              <Box display="flex" gap={1.5} alignItems="center">
                <TextField
                  size="small" label="机筒长度" type="number"
                  value={ssBarrelLength} onChange={(e) => updateSsBarrelLength(e.target.value)}
                  placeholder="请输入机筒长度"
                  InputProps={{ endAdornment: <Typography variant="caption" sx={{ pl: 1 }}>mm</Typography> }}
                  sx={{ width: 150 }}
                />
                {ssBarrelLength && openOffsetFromMeta(ssMeta) != null && (
                  <Typography variant="body2" color="text.secondary">
                    开档自动计算:
                    <Typography component="span" fontWeight={700} color="primary.main" sx={{ mx: 0.5 }}>
                      {calculateBearingSpan(ssBarrelLength, openOffsetFromMeta(ssMeta))}
                    </Typography>
                    mm
                  </Typography>
                )}
              </Box>
            </Box>
          </Box>
        )}
      </Paper>

      {templateHint && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setTemplateHint('')}>{templateHint}</Alert>}

      <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 3 }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="图纸名称"
            value={drawingName}
            onChange={(e) => handleDrawingNameChange(e.target.value)}
            placeholder="例如 V750转子-160片"
            sx={{ flex: '1 1 280px' }}
          />
          <Button
            variant="outlined"
            startIcon={<CopyIcon size={18} />}
            disabled={!latestReusableRow}
            onClick={handleReuseLatest}
          >
            复用上一张参数
          </Button>
        </Box>
        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={3}
          size="small"
          label="图纸显示文字"
          value={drawingText}
          onChange={(e) => handleDrawingTextChange(e.target.value)}
          placeholder="例如：客户名称、订单号、特殊说明"
          inputProps={{ maxLength: 120 }}
          helperText={`${drawingText.length}/120，会显示在生成的转子图纸中`}
          sx={{ mt: 1.5 }}
        />
      </Paper>

      <RotorFormPanel
        form={form}
        updateForm={updateForm}
        onSubmit={handleFormSubmit}
        onSave={handleSaveParams}
        loading={nlLoading}
        saving={savingParams}
        hasWarning={false}
      />

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {jobStatus && (
        <Paper elevation={0} sx={{ p: 3, mb: 2, borderRadius: 3 }}>
          {jobStatus.status === 'processing' && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CircularProgress size={24} />
                <Typography>正在生成转子图纸，FreeCAD 渲染中...</Typography>
              </Box>
              <LinearProgress />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>通常需要 20-40 秒，请稍候</Typography>
            </Box>
          )}
          {jobStatus.status === 'success' && (
            <Box>
              <Alert severity="success" icon={<CheckIcon size={24} />} sx={{ mb: 2 }}>转子图纸生成完成！</Alert>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<PdfIcon size={20} />}
                  href={`${API_BASE}${jobStatus.fileUrl}`}
                  download={sanitizeDownloadName(jobStatus.drawingName || drawingName)}
                >
                  下载 PDF 图纸
                </Button>
                <Button variant="contained" color="primary" startIcon={printing ? <CircularProgress size={20} color="inherit" /> : <PrintIcon size={20} />}
                  disabled={printing || !jobId} onClick={() => jobId && handlePrint(jobId)}>{printing ? '发送中...' : '打印图纸'}</Button>
              </Box>
            </Box>
          )}
          {jobStatus.status === 'failed' && <Alert severity="error" icon={<ErrorIcon size={24} />}>出图失败: {jobStatus.error}</Alert>}
        </Paper>
      )}

      <RotorHistoryTable
        history={history}
        loadHistory={loadHistory}
        handlePrint={handlePrint}
        printing={printing}
        API_BASE={API_BASE}
        onLinkClick={handleLinkClick}
        linking={linking}
        onReuseParams={reuseParamsFromRow}
      />

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>{snackbar.message}</Alert>
      </Snackbar>

      <Dialog open={linkDialogOpen} onClose={() => setLinkDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LinkIcon size={20} color="#2563eb" />
          关联图纸对象
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            选择要关联到此图纸的订单型号、型号变体或配方：
          </Typography>
          {linkTargets.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              暂无可关联对象
            </Typography>
          ) : (
            <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
              {(['order', 'variant', 'recipe'] as RotorLinkTargetType[]).map(type => {
                const targets = linkTargets.filter(item => item.type === type);
                if (targets.length === 0) return null;
                return (
                  <Box key={type} sx={{ mb: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1, mb: 0.5, fontWeight: 700 }}>
                      {LINK_TARGET_LABELS[type]}
                    </Typography>
                    {targets.map(target => (
                      <ListItemButton key={`${target.type}-${target.id}-${target.value}`}
                        onClick={() => handleLinkConfirm(target)}
                        disabled={linking}
                        sx={{ borderRadius: 2, mb: 0.5 }}>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <PackageIcon size={18} color="#64748b" />
                        </ListItemIcon>
                        <ListItemText
                          primary={target.label}
                          secondary={target.secondary}
                          primaryTypographyProps={{ fontWeight: 600, fontSize: '0.9rem' }}
                          secondaryTypographyProps={{ fontSize: '0.75rem' }}
                        />
                      </ListItemButton>
                    ))}
                  </Box>
                );
              })}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkDialogOpen(false)} disabled={linking}>取消</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
