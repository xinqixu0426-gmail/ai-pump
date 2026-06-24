import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box, Paper, Typography, TextField, Button,
  Alert, CircularProgress, Chip,
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
import { getAllTemplates, getAllParts, proxyFetch, proxyRequest } from '../utils/api';
import type { PumpShellTemplate, Part, PumpShellMeta } from '../types';
import PageHeader from '../components/PageHeader';
import { normalizeBearing, JobStatus } from '../components/rotor/rotorConstants';
import RotorFormPanel, { RotorFormData } from '../components/rotor/RotorFormPanel';
import RotorHistoryTable from '../components/rotor/RotorHistoryTable';

const API_BASE = import.meta.env.VITE_API_URL || '';

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

function parseHistoryParams(row: any): Record<string, unknown> {
  try {
    return JSON.parse(row.fc_params_json || '{}');
  } catch {
    return {};
  }
}

export default function RotorDrawingPage() {
  const [nlLoading, setNlLoading] = useState(false);
  const [form, setForm] = useState<RotorFormData>(emptyRotorForm);
  const [drawingName, setDrawingName] = useState('');

  const [templates, setTemplates] = useState<PumpShellTemplate[]>([]);
  const [allParts, setAllParts] = useState<Part[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PumpShellTemplate | null>(null);
  const [templateHint, setTemplateHint] = useState('');

  const [ssMeta, setSsMeta] = useState<PumpShellMeta | null>(null);
  const [ssBarrelLength, setSsBarrelLength] = useState('');

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [printing, setPrinting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkTargetRow, setLinkTargetRow] = useState<any>(null);
  const [orderPumpModels, setOrderPumpModels] = useState<Array<{ orderId: number; customerName: string; contractNo: string; recipeName: string; spec: string }>>([]);
  const [linking, setLinking] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getAllTemplates().then(setTemplates).catch(() => {});
    getAllParts().then(setAllParts).catch(() => {});
  }, []);

  const handleTemplateSelect = useCallback((tpl: PumpShellTemplate | null) => {
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

      const shellPart = allParts.find(p => p.model === tpl.shellModel && p.category === '泵壳');
      if (shellPart && shellPart.notes) {
        try {
          const meta: PumpShellMeta = JSON.parse(shellPart.notes);
          if (!newForm.upper_bearing && meta.defaultUpperBearing) { newForm.upper_bearing = meta.defaultUpperBearing; hints.push(`预设上轴承${newForm.upper_bearing}`); }
          if (!newForm.lower_bearing && meta.defaultLowerBearing) { newForm.lower_bearing = meta.defaultLowerBearing; hints.push(`预设下轴承${newForm.lower_bearing}`); }
          if (!newForm.oil_seal_dia && meta.defaultOilSealDia != null) { newForm.oil_seal_dia = String(meta.defaultOilSealDia); hints.push(`预设油封孔径${newForm.oil_seal_dia}mm`); }

          if (!newForm.bearing_span) {
            if (meta.defaultBearingSpan != null) { newForm.bearing_span = String(meta.defaultBearingSpan); hints.push(`预设开档${meta.defaultBearingSpan}mm`); }
            else if (meta.isStainless && (meta.openOffset != null || meta.openFactor != null)) {
              setSsMeta(meta);
              if (meta.barrelLength) setSsBarrelLength(String(meta.barrelLength));
            }
          }
          if (!newForm.impeller_dia && meta.defaultImpellerDia != null) { newForm.impeller_dia = String(meta.defaultImpellerDia); hints.push(`预设叶轮孔径${meta.defaultImpellerDia}mm`); }
          if (!newForm.impeller_span && meta.defaultImpellerSpan != null) { newForm.impeller_span = String(meta.defaultImpellerSpan); hints.push(`预设叶轮开档${meta.defaultImpellerSpan}mm`); }
          if (!newForm.impeller_depth && meta.defaultImpellerDepth != null) { newForm.impeller_depth = String(meta.defaultImpellerDepth); hints.push(`预设叶轮厚度${meta.defaultImpellerDepth}mm`); }
          if (!newForm.thread_length && meta.defaultThreadLength != null) { newForm.thread_length = String(meta.defaultThreadLength); hints.push(`预设螺丝长度${meta.defaultThreadLength}mm`); }
          if (!newForm.thread_dia && meta.defaultThreadDia != null) { newForm.thread_dia = String(meta.defaultThreadDia); hints.push(`预设螺纹直径${meta.defaultThreadDia}mm`); }
          if (!newForm.stack_offset && meta.defaultStackOffset != null) { newForm.stack_offset = String(meta.defaultStackOffset); hints.push(`预设定位${meta.defaultStackOffset}mm`); }
        } catch { /* ignore invalid shell metadata */ }
      }
    } catch { /* ignore invalid template json */ }

    setForm(prev => ({ ...prev, ...newForm }));
    setTemplateHint(hints.length > 0 ? `已从 ${tpl.shellModel} 模板自动带入：${hints.join('、')}` : '');
  }, [allParts]);

  useEffect(() => {
    if (ssMeta && (ssMeta.openOffset != null || ssMeta.openFactor != null)) {
      const len = parseFloat(ssBarrelLength);
      if (!isNaN(len) && len > 0) {
        const span = len - (ssMeta.openOffset ?? ssMeta.openFactor ?? 0);
        setForm(prev => ({ ...prev, bearing_span: String(span) }));
      }
    }
  }, [ssBarrelLength, ssMeta]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await proxyRequest<any[] | { success: boolean; data: any[] }>('/api/rotor/history');
      setHistory(Array.isArray(res) ? res : res.data);
    } catch { /* ignore history refresh errors */ }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setJobStatus({ status: 'processing', drawingName });

    pollRef.current = setInterval(async () => {
      try {
        const res = await proxyFetch(`/api/rotor/status/${jobId}`, {}, { throwOnError: false });
        if (res.status === 404) {
          if (pollRef.current) clearInterval(pollRef.current);
          const histRes = await proxyFetch('/api/rotor/history', {}, { throwOnError: false });
          if (histRes.ok) {
            const histData = await histRes.json();
            const rows = Array.isArray(histData) ? histData : histData.data || [];
            const found = rows.find((r: any) => r.job_id === jobId);
            if (found) setJobStatus({ status: found.status, fileUrl: found.file_url, error: found.error, drawingName: found.drawing_name });
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
  }, [jobId, loadHistory, drawingName]);

  const handleFormSubmit = async () => {
    const hasAnyParam = Object.values(form).some(value => String(value || '').trim() !== '');
    if (!hasAnyParam) { setError('请至少填写一项参数'); return; }

    setError('');
    setNlLoading(true);
    setJobId(null);
    setJobStatus(null);

    try {
      const body = { ...form, drawingName: drawingName.trim() };
      const data = await proxyRequest<any>('/api/rotor/draw', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      if (data.status === 'success') {
        setJobId(data.jobId);
        setJobStatus({ status: 'processing', drawingName: data.drawingName || drawingName.trim() });
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

  const updateForm = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const reuseParamsFromRow = useCallback((row: any) => {
    const nextForm = formFromFcParams(parseHistoryParams(row));
    setForm(prev => ({ ...prev, ...nextForm }));
    if (row.drawing_name) setDrawingName(`${row.drawing_name}-复用`);
    setSnackbar({ open: true, message: '已复用历史图纸参数', severity: 'success' });
  }, []);

  const latestReusableRow = history.find(row => row.fc_params_json);

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

  const handleLinkClick = useCallback(async (row: any) => {
    setLinkTargetRow(row);
    try {
      const res = await proxyRequest<Array<{ orderId: number; customerName: string; contractNo: string; recipeName: string; spec: string }> | { success: boolean; data: Array<{ orderId: number; customerName: string; contractNo: string; recipeName: string; spec: string }> }>('/api/rotor/order-pump-models');
      setOrderPumpModels(Array.isArray(res) ? res : res.data);
    } catch { setOrderPumpModels([]); }
    setLinkDialogOpen(true);
  }, []);

  const handleLinkConfirm = useCallback(async (recipeName: string) => {
    if (!linkTargetRow) return;
    setLinking(true);
    try {
      const res = await proxyFetch(`/api/rotor/history/${linkTargetRow.id}/link`, {
        method: 'PATCH',
        body: JSON.stringify({ linkedPumpModel: recipeName })
      }, { throwOnError: false });
      if (res.ok) {
        setSnackbar({ open: true, message: `已关联到 ${recipeName}`, severity: 'success' });
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
        <Autocomplete
          size="small" options={templates}
          getOptionLabel={(o) => o.shellModel + (o.description ? ` - ${o.description}` : '')}
          value={selectedTemplate} onChange={(_, v) => handleTemplateSelect(v)}
          renderInput={(params) => <TextField {...params} placeholder="选择泵壳模板，自动带入轴承/油封/开档参数" />}
          isOptionEqualToValue={(o, v) => o.Id === v.Id}
        />
        {ssMeta && (
          <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, border: '1px solid #bae6fd', bgcolor: '#f0f9ff' }}>
            <Typography variant="body2" fontWeight={700} color="#0369a1" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              SS机筒长度
            </Typography>
            <Box display="flex" flexDirection="column" gap={1.5}>
              {ssMeta.barrelLengthPresets && ssMeta.barrelLengthPresets.length > 0 && (
                <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
                  <Typography variant="caption" color="text.secondary">快速选择:</Typography>
                  {ssMeta.barrelLengthPresets.map((len, idx) => (
                    <Chip
                      key={idx}
                      label={`${len} mm`}
                      size="small"
                      color={ssBarrelLength === String(len) ? 'primary' : 'default'}
                      onClick={() => setSsBarrelLength(String(len))}
                      sx={{ fontWeight: ssBarrelLength === String(len) ? 700 : 400 }}
                    />
                  ))}
                </Box>
              )}
              <Box display="flex" gap={1.5} alignItems="center">
                <TextField
                  size="small" label="机筒长度" type="number"
                  value={ssBarrelLength} onChange={(e) => setSsBarrelLength(e.target.value)}
                  placeholder="请输入机筒长度"
                  InputProps={{ endAdornment: <Typography variant="caption" sx={{ pl: 1 }}>mm</Typography> }}
                  sx={{ width: 150 }}
                />
                {ssBarrelLength && (ssMeta.openOffset != null || ssMeta.openFactor != null) && (
                  <Typography variant="body2" color="text.secondary">
                    开档自动计算:
                    <Typography component="span" fontWeight={700} color="primary.main" sx={{ mx: 0.5 }}>
                      {(Number(ssBarrelLength) - (ssMeta.openOffset ?? ssMeta.openFactor ?? 0)).toFixed(1)}
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
            onChange={(e) => setDrawingName(e.target.value)}
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
      </Paper>

      <RotorFormPanel form={form} updateForm={updateForm} onSubmit={handleFormSubmit} loading={nlLoading} hasWarning={false} />

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
          关联订单水泵型号
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            选择要关联到此图纸的订单水泵型号：
          </Typography>
          {orderPumpModels.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              暂无订单数据
            </Typography>
          ) : (
            <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
              {orderPumpModels.map((m, idx) => (
                <ListItemButton key={`${m.orderId}-${m.recipeName}-${idx}`}
                  onClick={() => handleLinkConfirm(m.recipeName)}
                  disabled={linking}
                  sx={{ borderRadius: 2, mb: 0.5 }}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <PackageIcon size={18} color="#64748b" />
                  </ListItemIcon>
                  <ListItemText
                    primary={m.recipeName + (m.spec ? ` (${m.spec})` : '')}
                    secondary={`订单#${m.orderId} - ${m.customerName}${m.contractNo ? ' / ' + m.contractNo : ''}`}
                    primaryTypographyProps={{ fontWeight: 600, fontSize: '0.9rem' }}
                    secondaryTypographyProps={{ fontSize: '0.75rem' }}
                  />
                </ListItemButton>
              ))}
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
