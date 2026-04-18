import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box, Paper, Typography, TextField, Button,
  Alert, CircularProgress, Chip,
  LinearProgress, Autocomplete, Snackbar
} from '@mui/material';
import {
  Send as SendIcon,
  PictureAsPdf as PdfIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Link as LinkIcon,
  Print as PrintIcon
} from '@mui/icons-material';
import { getAllTemplates, getAllParts } from '../utils/api';
import type { PumpShellTemplate, Part, PumpShellMeta } from '../types';
import PageHeader from '../components/PageHeader';

import { STATOR_TO_ROTOR, normalizeBearing, JobStatus } from '../components/rotor/rotorConstants';
import RotorFormPanel, { RotorFormData } from '../components/rotor/RotorFormPanel';
import RotorHistoryTable from '../components/rotor/RotorHistoryTable';
import RotorWarningDialog, { RotorWarningData } from '../components/rotor/RotorWarningDialog';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function RotorDrawingPage() {
  const [nlInput, setNlInput] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [formMode, setFormMode] = useState(false);
  const [form, setForm] = useState<RotorFormData>({
    upper_bearing: '', lower_bearing: '',
    piece_count: '', rotor_dia: '', bearing_span: '', stack_offset: '',
    oil_seal_dia: '', impeller_dia: '', impeller_span: '', impeller_depth: '',
    thread_length: '', thread_dia: ''
  });

  const [templates, setTemplates] = useState<PumpShellTemplate[]>([]);
  const [allParts, setAllParts] = useState<Part[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PumpShellTemplate | null>(null);
  const [templateHint, setTemplateHint] = useState('');

  const [warning, setWarning] = useState<RotorWarningData | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState('');
  const [extracted, setExtracted] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [supplements, setSupplements] = useState<Record<string, string>>({});
  const [printing, setPrinting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSubmittedMessage = useRef<string>('');

  useEffect(() => {
    getAllTemplates().then(setTemplates).catch(() => {});
    getAllParts().then(setAllParts).catch(() => {});
  }, []);

  const handleTemplateSelect = useCallback((tpl: PumpShellTemplate | null) => {
    setSelectedTemplate(tpl);
    if (!tpl) { setTemplateHint(''); return; }

    const newForm: RotorFormData = {
      upper_bearing: '', lower_bearing: '',
      piece_count: '', rotor_dia: '', bearing_span: '', stack_offset: '',
      oil_seal_dia: '', impeller_dia: '', impeller_span: '', impeller_depth: '',
      thread_length: '', thread_dia: ''
    };
    const hints: string[] = [];

    try {
      const parts: Array<{ name: string; model: string }> = JSON.parse(tpl.parts_json || '[]');
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

      const shellPart = allParts.find(p => p.model === tpl.shell_model && p.category === '泵壳');
      if (shellPart && shellPart.notes) {
        try {
          const meta: PumpShellMeta = JSON.parse(shellPart.notes);
          if (!newForm.upper_bearing && meta.defaultUpperBearing) { newForm.upper_bearing = meta.defaultUpperBearing; hints.push(`预设上轴承${newForm.upper_bearing}`); }
          if (!newForm.lower_bearing && meta.defaultLowerBearing) { newForm.lower_bearing = meta.defaultLowerBearing; hints.push(`预设下轴承${newForm.lower_bearing}`); }
          if (!newForm.oil_seal_dia && meta.defaultOilSealDia != null) { newForm.oil_seal_dia = String(meta.defaultOilSealDia); hints.push(`预设油封孔径${newForm.oil_seal_dia}mm`); }

          if (!newForm.bearing_span) {
            if (meta.defaultBearingSpan != null) { newForm.bearing_span = String(meta.defaultBearingSpan); hints.push(`预设开档${meta.defaultBearingSpan}mm`); }
            else if (meta.isStainless && meta.barrelLength && meta.openFactor != null) { const span = meta.barrelLength - meta.openFactor; newForm.bearing_span = String(span); hints.push(`开档${span}mm`); }
          }
          if (!newForm.impeller_dia && meta.defaultImpellerDia != null) { newForm.impeller_dia = String(meta.defaultImpellerDia); hints.push(`预设叶轮孔径${meta.defaultImpellerDia}mm`); }
          if (!newForm.impeller_span && meta.defaultImpellerSpan != null) { newForm.impeller_span = String(meta.defaultImpellerSpan); hints.push(`预设叶轮开档${meta.defaultImpellerSpan}mm`); }
          if (!newForm.impeller_depth && meta.defaultImpellerDepth != null) { newForm.impeller_depth = String(meta.defaultImpellerDepth); hints.push(`预设叶轮厚度${meta.defaultImpellerDepth}mm`); }
          if (!newForm.thread_length && meta.defaultThreadLength != null) { newForm.thread_length = String(meta.defaultThreadLength); hints.push(`预设螺丝长度${meta.defaultThreadLength}mm`); }
          if (!newForm.thread_dia && meta.defaultThreadDia != null) { newForm.thread_dia = String(meta.defaultThreadDia); hints.push(`预设螺纹直径${meta.defaultThreadDia}mm`); }
          if (!newForm.stack_offset && meta.defaultStackOffset != null) { newForm.stack_offset = String(meta.defaultStackOffset); hints.push(`预设定位${meta.defaultStackOffset}mm`); }
        } catch { /* */ }
      }
    } catch { /* */ }

    setForm(prev => ({ ...prev, ...newForm }));
    setFormMode(true);
    setTemplateHint(hints.length > 0 ? `已从 ${tpl.shell_model} 模板自动带入：${hints.join('、')}` : '');
  }, [allParts]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/rotor/history`, { credentials: 'include' });
      if (res.ok) setHistory(await res.json());
    } catch { /* */ }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setJobStatus({ status: 'processing' });

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/rotor/status/${jobId}`, { credentials: 'include' });
        if (res.status === 404) {
          if (pollRef.current) clearInterval(pollRef.current);
          const histRes = await fetch(`${API_BASE}/api/rotor/history`, { credentials: 'include' });
          if (histRes.ok) {
            const histData = await histRes.json();
            const found = histData.find((r: any) => r.job_id === jobId);
            if (found) setJobStatus({ status: found.status, fileUrl: found.file_url, error: found.error });
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
      } catch (e) {
        // ...
      }
    }, 2000);

    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId, loadHistory]);

  const submitChat = useCallback(async (message: string, force = false, sups?: Record<string, number>) => {
    setError(''); setNlLoading(true); setJobId(null); setJobStatus(null);
    lastSubmittedMessage.current = message;

    try {
      const body: any = { message, force };
      if (sups && Object.keys(sups).length > 0) body.supplements = sups;
      const res = await fetch(`${API_BASE}/api/rotor/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (data.status === 'warning') {
        setWarning({ missing_length: data.missing_length, stator_clearance: data.stator_clearance, extracted: data.extracted });
        setExtracted(data.extracted);
      } else if (data.status === 'success') {
        setJobId(data.jobId); setExtracted(data.extracted); setWarning(null);
        setTimeout(loadHistory, 2000);
      } else if (data.status === 'need_params') {
        setError('参数不足: ' + data.message); setExtracted(data.extracted);
      } else if (data.status === 'error') {
        setError(data.message);
      }
    } catch (e: any) {
      setError('请求失败: ' + e.message);
    } finally {
      setNlLoading(false);
    }
  }, [loadHistory]);

  const handleNlSubmit = () => {
    if (!nlInput.trim()) return;
    let fullMessage = nlInput;

    fullMessage = fullMessage.replace(/(\d+\.?\d*)-(\d+)/g, (_match, spec, pieces) => {
      const rotorDia = STATOR_TO_ROTOR[spec];
      if (rotorDia) return `转子直径${rotorDia}，转子片数${pieces}片`;
      return _match;
    });

    if (selectedTemplate) {
      const prefixParts: string[] = [];
      if (form.upper_bearing) prefixParts.push(`上轴承${form.upper_bearing.replace(/^6/, '')}`);
      if (form.lower_bearing) prefixParts.push(`下轴承${form.lower_bearing.replace(/^6/, '')}`);
      if (form.oil_seal_dia) prefixParts.push(`油封孔径${form.oil_seal_dia}`);
      if (form.bearing_span) prefixParts.push(`开档${form.bearing_span}`);
      if (prefixParts.length > 0) fullMessage = prefixParts.join('，') + '，' + fullMessage;
    }
    submitChat(fullMessage);
  };

  const handleWarningConfirm = () => {
    const sups: Record<string, number> = {};
    if (warning?.missing_length) {
      for (const [k, v] of Object.entries(supplements)) {
        const num = parseFloat(v);
        if (!isNaN(num) && num > 0) sups[k] = num;
      }
    }
    setWarning(null); setSupplements({});
    submitChat(lastSubmittedMessage.current || nlInput, true, sups);
  };

  const handleWarningCancel = () => {
    setWarning(null); setError('已取消。请调整 定位(stack_offset) 后重试。');
  };

  const handleFormSubmit = () => {
    const parts: string[] = [];
    if (form.upper_bearing) parts.push(`上轴承${form.upper_bearing.replace(/^6/, '')}`);
    if (form.lower_bearing) parts.push(`下轴承${form.lower_bearing.replace(/^6/, '')}`);
    if (form.piece_count) parts.push(`转子片数${form.piece_count}片`);
    if (form.rotor_dia) parts.push(`转子直径${form.rotor_dia}`);
    if (form.bearing_span) parts.push(`开档${form.bearing_span}`);
    if (form.stack_offset) parts.push(`定位${form.stack_offset}`);
    if (form.oil_seal_dia) parts.push(`油封孔径${form.oil_seal_dia}`);
    if (form.impeller_dia) parts.push(`叶轮孔径${form.impeller_dia}`);
    if (form.impeller_span) parts.push(`叶轮开档${form.impeller_span}`);
    if (form.impeller_depth) parts.push(`叶轮厚度${form.impeller_depth}`);
    if (form.thread_length) parts.push(`螺丝长度${form.thread_length}`);
    if (form.thread_dia) parts.push(`螺纹直径${form.thread_dia}`);

    if (parts.length === 0) { setError('请至少填写一项参数'); return; }
    const msg = parts.join('，');
    setNlInput(msg); submitChat(msg);
  };

  const updateForm = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const handlePrint = useCallback(async (targetJobId: string) => {
    setPrinting(true);
    try {
      const res = await fetch(`${API_BASE}/api/rotor/print/${targetJobId}`, { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (res.ok && data.ok) setSnackbar({ open: true, message: '🖨️ 打印指令已发送到默认打印机', severity: 'success' });
      else setSnackbar({ open: true, message: '打印失败: ' + (data.error || '未知错误'), severity: 'error' });
    } catch (e: any) { setSnackbar({ open: true, message: '打印请求失败: ' + e.message, severity: 'error' }); }
    finally { setPrinting(false); }
  }, []);

  return (
    <Box sx={{ p: 3, maxWidth: 1000, mx: 'auto' }}>
      <PageHeader title="🔧 转子出图系统" subtitle="自然语言或表单填参，自动生成转子工程图纸" />

      {/* ── 泵壳模板关联 ── */}
      <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 3, bgcolor: 'background.default' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <LinkIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2">关联泵壳模板（可选）</Typography>
        </Box>
        <Autocomplete
          size="small" options={templates}
          getOptionLabel={(o) => o.shell_model + (o.description ? ` - ${o.description}` : '')}
          value={selectedTemplate} onChange={(_, v) => handleTemplateSelect(v)}
          renderInput={(params) => <TextField {...params} placeholder="选择泵壳模板，自动带入轴承/油封/开档参数" />}
          isOptionEqualToValue={(o, v) => o.Id === v.Id}
        />
      </Paper>
      {templateHint && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setTemplateHint('')}>{templateHint}</Alert>}

      <Box sx={{ mb: 3, display: 'flex', gap: 1 }}>
        <Chip label="语音/文字指令" color={!formMode ? 'primary' : 'default'} onClick={() => setFormMode(false)} />
        <Chip label="表单填参" color={formMode ? 'primary' : 'default'} onClick={() => setFormMode(true)} />
      </Box>

      {/* ── 自然语言输入 ── */}
      {!formMode && (
        <Paper elevation={0} sx={{ p: 3, mb: 3, borderRadius: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
            用自然语言描述转子参数，例如："上轴承202，下轴承203，转子片数160片，定位30，开档150"
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField fullWidth value={nlInput} onChange={e => setNlInput(e.target.value)} placeholder="请输入转子参数..."
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleNlSubmit(); } }} disabled={nlLoading} />
            <Button variant="contained" onClick={handleNlSubmit} disabled={nlLoading || !nlInput.trim()}
              startIcon={nlLoading ? <CircularProgress size={20} /> : <SendIcon />}>出图</Button>
          </Box>
        </Paper>
      )}

      {/* ── 表单输入 ── */}
      {formMode && (
        <RotorFormPanel form={form} updateForm={updateForm} onSubmit={handleFormSubmit} loading={nlLoading} hasWarning={!!warning} />
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {extracted && (
        <Paper elevation={0} sx={{ p: 2, mb: 2, borderRadius: 3, bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>AI 提取参数:</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {Object.entries(extracted).filter(([k, v]) => v != null && k !== 'reply').map(([k, v]) => (
              <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" />
            ))}
          </Box>
        </Paper>
      )}

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
              <Alert severity="success" icon={<CheckIcon />} sx={{ mb: 2 }}>转子图纸生成完成！</Alert>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button variant="contained" color="success" startIcon={<PdfIcon />}
                  href={`${API_BASE}${jobStatus.fileUrl}`} target="_blank">下载 PDF 图纸</Button>
                <Button variant="contained" color="primary" startIcon={printing ? <CircularProgress size={20} color="inherit" /> : <PrintIcon />}
                  disabled={printing || !jobId} onClick={() => jobId && handlePrint(jobId)}>{printing ? '发送中...' : '打印图纸'}</Button>
              </Box>
            </Box>
          )}
          {jobStatus.status === 'failed' && <Alert severity="error" icon={<ErrorIcon />}>出图失败: {jobStatus.error}</Alert>}
        </Paper>
      )}

      {/* ── 历史及弹窗 ── */}
      <RotorHistoryTable history={history} loadHistory={loadHistory} handlePrint={handlePrint} printing={printing} API_BASE={API_BASE} />

      <RotorWarningDialog warning={warning} supplements={supplements} setSupplements={setSupplements} onConfirm={handleWarningConfirm} onCancel={handleWarningCancel} />

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
