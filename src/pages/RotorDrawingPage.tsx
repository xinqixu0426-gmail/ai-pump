import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box, Paper, Typography, TextField, Button, Grid,
  Alert, Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress, Chip, IconButton, Tooltip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  LinearProgress, MenuItem, Autocomplete
} from '@mui/material';
import {
  Build as BuildIcon,
  Send as SendIcon,
  PictureAsPdf as PdfIcon,
  Warning as WarningIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Refresh as RefreshIcon,
  History as HistoryIcon,
  Delete as DeleteIcon,
  Link as LinkIcon
} from '@mui/icons-material';
import { getAllTemplates, getAllParts } from '../utils/api';
import type { PumpShellTemplate, Part, PumpShellMeta } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

const BEARING_OPTIONS = [
  { value: '', label: '未指定' },
  { value: '6201', label: '6201 (孔径12mm)' },
  { value: '6202', label: '6202 (孔径15mm)' },
  { value: '6203', label: '6203 (孔径17mm)' },
  { value: '6204', label: '6204 (孔径20mm)' },
  { value: '6205', label: '6205 (孔径25mm)' },
];

// 定子规格 → 转子直径映射（格式："12-160" 中 12 是定子规格，160 是片数）
// 后续新增规格只需在这里加一行
const STATOR_TO_ROTOR: Record<string, number> = {
  '12': 61,     // 12号定子 → 转子直径61mm
  '13.5': 67,   // 13.5号定子 → 转子直径67mm
};

interface JobStatus {
  status: 'processing' | 'success' | 'failed';
  fileUrl?: string;
  error?: string;
}

export default function RotorDrawingPage() {
  // ── 自然语言模式 ──
  const [nlInput, setNlInput] = useState('');
  const [nlLoading, setNlLoading] = useState(false);

  // ── 表单模式 ──
  const [formMode, setFormMode] = useState(false);
  const [form, setForm] = useState({
    upper_bearing: '', lower_bearing: '',
    piece_count: '', rotor_dia: '', bearing_span: '', stack_offset: '',
    oil_seal_dia: '', impeller_dia: '', impeller_span: '', impeller_depth: '',
    thread_length: '', thread_dia: ''
  });

  // ── 泵壳模板联动 ──
  const [templates, setTemplates] = useState<PumpShellTemplate[]>([]);
  const [allParts, setAllParts] = useState<Part[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<PumpShellTemplate | null>(null);
  const [templateHint, setTemplateHint] = useState('');

  // ── 状态 ──
  const [warning, setWarning] = useState<{ 
    missing_length?: {
      missing_params: Array<{key: string, name: string}>;
      components: Array<{name: string, value: number, missing: boolean}>;
      calculated_total: number;
    };
    stator_clearance?: {
      clearance: number;
      message: string;
    };
    extracted: any;
  } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState('');
  const [extracted, setExtracted] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [supplements, setSupplements] = useState<Record<string, string>>({});

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 加载泵壳模板和配件数据 ──
  useEffect(() => {
    getAllTemplates().then(setTemplates).catch(() => {});
    getAllParts().then(setAllParts).catch(() => {});
  }, []);

  // ── 模板选择联动 ──
  const handleTemplateSelect = useCallback((tpl: PumpShellTemplate | null) => {
    setSelectedTemplate(tpl);
    if (!tpl) {
      setTemplateHint('');
      return;
    }

    const newForm = {
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

        // 花板轴承 → 上轴承
        if (name.includes('花板') && name.includes('轴承')) {
          const bearing = model.startsWith('6') ? model : '6' + model;
          newForm.upper_bearing = bearing;
          hints.push(`上轴承${bearing}`);
        }
        // 油缸轴承 → 下轴承
        if (name.includes('油缸') && name.includes('轴承')) {
          const bearing = model.startsWith('6') ? model : '6' + model;
          newForm.lower_bearing = bearing;
          hints.push(`下轴承${bearing}`);
        }
        // 机械油封 → 油封孔径
        if (name.includes('机械油封') || (name.includes('机封') && !name.includes('骨架'))) {
          const firstNum = model.split('*')[0].trim();
          const dia = parseFloat(firstNum);
          if (!isNaN(dia)) {
            newForm.oil_seal_dia = String(dia);
            hints.push(`油封孔径${dia}mm`);
          }
        }
      }

      // 不锈钢机筒开档计算：从 parts 表找泵壳零件的 remark
      const shellModel = tpl.shell_model;
      const shellPart = allParts.find(p => p.model === shellModel && p.category === '泵壳');
      if (shellPart && shellPart.notes) {
        try {
          const meta: PumpShellMeta = JSON.parse(shellPart.notes);
          if (meta.isStainless && meta.barrelLength && meta.openFactor != null) {
            const span = meta.barrelLength - meta.openFactor;
            newForm.bearing_span = String(span);
            hints.push(`开档${span}mm (${meta.barrelLength}-${meta.openFactor})`);
          }
        } catch { /* remark 不是 JSON，忽略 */ }
      }
    } catch { /* parts_json 解析失败 */ }

    setForm(prev => ({ ...prev, ...newForm }));
    setFormMode(true); // 自动切换到表单模式
    setTemplateHint(hints.length > 0 ? `已从 ${tpl.shell_model} 模板自动带入：${hints.join('、')}` : '');
  }, [allParts]);

  // ── 加载出图历史 ──
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/rotor/history`, { credentials: 'include' });
      if (res.ok) setHistory(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── 轮询出图状态 ──
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setJobStatus({ status: 'processing' });

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/rotor/status/${jobId}`, { credentials: 'include' });
        const data: JobStatus = await res.json();
        if (cancelled) return;
        setJobStatus(data);
        if (data.status === 'success' || data.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          loadHistory();
        }
      } catch (e) {
        // 网络暂时抖动，继续轮询
      }
    }, 2000);

    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId, loadHistory]);

  const submitChat = useCallback(async (message: string, force = false, sups?: Record<string, number>) => {
    setError('');
    setNlLoading(true);
    setJobId(null);
    setJobStatus(null);

    try {
      const body: any = { message, force };
      if (sups && Object.keys(sups).length > 0) body.supplements = sups;
      const res = await fetch(`${API_BASE}/api/rotor/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (data.status === 'warning') {
        setWarning({ 
          missing_length: data.missing_length,
          stator_clearance: data.stator_clearance,
          extracted: data.extracted
        });
        setExtracted(data.extracted);
      } else if (data.status === 'success') {
        setJobId(data.jobId);
        setExtracted(data.extracted);
        setWarning(null);
        // 延迟刷新历史（等出图完成后会自动刷新）
        setTimeout(loadHistory, 2000);
      } else if (data.status === 'need_params') {
        setError('参数不足: ' + data.message);
        setExtracted(data.extracted);
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

    // 定子规格简写展开："12-160" → "转子直径61，转子片数160片"
    fullMessage = fullMessage.replace(/(\d+\.?\d*)-(\d+)/g, (_match, spec, pieces) => {
      const rotorDia = STATOR_TO_ROTOR[spec];
      if (rotorDia) {
        return `转子直径${rotorDia}，转子片数${pieces}片`;
      }
      return _match; // 未知规格，保留原文
    });

    // 如果选了模板，把模板带入的参数拼到消息前面
    if (selectedTemplate) {
      const prefixParts: string[] = [];
      if (form.upper_bearing) prefixParts.push(`上轴承${form.upper_bearing.replace('6', '')}`);
      if (form.lower_bearing) prefixParts.push(`下轴承${form.lower_bearing.replace('6', '')}`);
      if (form.oil_seal_dia) prefixParts.push(`油封孔径${form.oil_seal_dia}`);
      if (form.bearing_span) prefixParts.push(`开档${form.bearing_span}`);
      if (prefixParts.length > 0) {
        fullMessage = prefixParts.join('，') + '，' + fullMessage;
      }
    }
    submitChat(fullMessage);
  };

  const handleWarningConfirm = () => {
    // 将弹窗中用户填入的补充参数转为数字传给后端
    const sups: Record<string, number> = {};
    if (warning?.missing_length) {
      for (const [k, v] of Object.entries(supplements)) {
        const num = parseFloat(v);
        if (!isNaN(num) && num > 0) sups[k] = num;
      }
    }
    setWarning(null);
    setSupplements({});
    submitChat(nlInput, true, sups);
  };

  const handleWarningCancel = () => {
    setWarning(null);
    setError('已取消。请调整 定位(stack_offset) 后重试。');
  };

  const handleFormSubmit = () => {
    // 拼成自然语言让后端走同一条路
    const parts: string[] = [];
    if (form.upper_bearing) parts.push(`上轴承${form.upper_bearing.replace('6', '')}`);
    if (form.lower_bearing) parts.push(`下轴承${form.lower_bearing.replace('6', '')}`);
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

    if (parts.length === 0) {
      setError('请至少填写一项参数');
      return;
    }

    const msg = parts.join('，');
    setNlInput(msg);
    submitChat(msg);
  };

  const updateForm = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <Box sx={{ p: 3, maxWidth: 1000, mx: 'auto' }}>
      <Typography variant="h4" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
        <BuildIcon fontSize="large" color="primary" />
        转子出图系统
      </Typography>

      {/* ── 泵壳模板关联 ── */}
      <Paper sx={{ p: 2, mb: 2, bgcolor: 'background.default' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <LinkIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2">关联泵壳模板（可选）</Typography>
        </Box>
        <Autocomplete
          size="small"
          options={templates}
          getOptionLabel={(o) => o.shell_model + (o.description ? ` - ${o.description}` : '')}
          value={selectedTemplate}
          onChange={(_, v) => handleTemplateSelect(v)}
          renderInput={(params) => <TextField {...params} placeholder="选择泵壳模板，自动带入轴承/油封/开档参数" />}
          isOptionEqualToValue={(o, v) => o.Id === v.Id}
        />
      </Paper>

      {/* ── 模板联动提示 ── */}
      {templateHint && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setTemplateHint('')}>
          {templateHint}
        </Alert>
      )}

      {/* ── 模式切换 ── */}
      <Box sx={{ mb: 3, display: 'flex', gap: 1 }}>
        <Chip label="语音/文字指令" color={!formMode ? 'primary' : 'default'} onClick={() => setFormMode(false)} />
        <Chip label="表单填参" color={formMode ? 'primary' : 'default'} onClick={() => setFormMode(true)} />
      </Box>

      {/* ── 自然语言输入 ── */}
      {!formMode && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
            用自然语言描述转子参数，例如："上轴承202，下轴承203，转子片数160片，定位30，开档150"
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              fullWidth
              value={nlInput}
              onChange={e => setNlInput(e.target.value)}
              placeholder="请输入转子参数..."
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleNlSubmit(); } }}
              disabled={nlLoading}
            />
            <Button variant="contained" onClick={handleNlSubmit} disabled={nlLoading || !nlInput.trim()}
              startIcon={nlLoading ? <CircularProgress size={20} /> : <SendIcon />}>
              出图
            </Button>
          </Box>
        </Paper>
      )}

      {/* ── 表单模式 ── */}
      {formMode && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <TextField select fullWidth label="上轴承" value={form.upper_bearing}
                onChange={e => updateForm('upper_bearing', e.target.value)} size="small">
                {BEARING_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField select fullWidth label="下轴承" value={form.lower_bearing}
                onChange={e => updateForm('lower_bearing', e.target.value)} size="small">
                {BEARING_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth label="转子片数" type="number" value={form.piece_count}
                onChange={e => updateForm('piece_count', e.target.value)} size="small" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth label="转子直径" type="number" value={form.rotor_dia}
                onChange={e => updateForm('rotor_dia', e.target.value)} size="small" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth label="开档/轴承间距" type="number" value={form.bearing_span}
                onChange={e => updateForm('bearing_span', e.target.value)} size="small" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth label="叠片定位" type="number" value={form.stack_offset}
                onChange={e => updateForm('stack_offset', e.target.value)} size="small"
                error={!!warning} helperText={warning ? '请调整此值' : ''} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth label="油封孔径" type="number" value={form.oil_seal_dia}
                onChange={e => updateForm('oil_seal_dia', e.target.value)} size="small" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth label="叶轮孔径" type="number" value={form.impeller_dia}
                onChange={e => updateForm('impeller_dia', e.target.value)} size="small" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth label="叶轮开档" type="number" value={form.impeller_span}
                onChange={e => updateForm('impeller_span', e.target.value)} size="small" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth label="叶轮厚度" type="number" value={form.impeller_depth}
                onChange={e => updateForm('impeller_depth', e.target.value)} size="small" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth label="螺丝长度" type="number" value={form.thread_length}
                onChange={e => updateForm('thread_length', e.target.value)} size="small" />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField fullWidth label="螺纹直径" type="number" value={form.thread_dia}
                onChange={e => updateForm('thread_dia', e.target.value)} size="small" />
            </Grid>
          </Grid>
          <Button variant="contained" sx={{ mt: 2 }} onClick={handleFormSubmit}
            disabled={nlLoading} startIcon={nlLoading ? <CircularProgress size={20} /> : <BuildIcon />}>
            生成图纸
          </Button>
        </Paper>
      )}

      {/* ── 错误提示 ── */}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* ── 提取结果预览 ── */}
      {extracted && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>AI 提取参数:</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {Object.entries(extracted).filter(([k, v]) => v != null && k !== 'reply').map(([k, v]) => (
              <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" />
            ))}
          </Box>
        </Paper>
      )}

      {/* ── 出图进度 ── */}
      {jobStatus && (
        <Paper sx={{ p: 3, mb: 2 }}>
          {jobStatus.status === 'processing' && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CircularProgress size={24} />
                <Typography>正在生成转子图纸，FreeCAD 渲染中...</Typography>
              </Box>
              <LinearProgress />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                通常需要 20-40 秒，请稍候
              </Typography>
            </Box>
          )}
          {jobStatus.status === 'success' && (
            <Box>
              <Alert severity="success" icon={<CheckIcon />} sx={{ mb: 2 }}>
                转子图纸生成完成！
              </Alert>
              <Button variant="contained" color="success" startIcon={<PdfIcon />}
                href={`${API_BASE}${jobStatus.fileUrl}`} target="_blank">
                下载 PDF 图纸
              </Button>
            </Box>
          )}
          {jobStatus.status === 'failed' && (
            <Alert severity="error" icon={<ErrorIcon />}>
              出图失败: {jobStatus.error}
            </Alert>
          )}
        </Paper>
      )}

      {/* ── 出图历史 ── */}
      {history.length > 0 && (
        <Paper sx={{ p: 2, mt: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <HistoryIcon color="primary" />
            <Typography variant="h6">出图历史</Typography>
            <IconButton size="small" onClick={loadHistory}><RefreshIcon fontSize="small" /></IconButton>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>时间</TableCell>
                  <TableCell>指令</TableCell>
                  <TableCell>参数</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((row: any) => {
                  const params = (() => { try { return JSON.parse(row.fc_params_json || '{}'); } catch { return {}; } })();
                  const paramChips = Object.entries(params)
                    .filter(([, v]) => v != null)
                    .map(([k, v]) => `${k}:${v}`)
                    .join(', ');
                  return (
                    <TableRow key={row.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                        {row.created_at ? new Date(row.created_at).toLocaleString('zh-CN') : '-'}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.nl_input || '-'}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'text.secondary' }}>
                        {paramChips || '-'}
                      </TableCell>
                      <TableCell>
                        {row.status === 'success' && <Chip label="成功" color="success" size="small" />}
                        {row.status === 'failed' && <Tooltip title={row.error || ''}><Chip label="失败" color="error" size="small" /></Tooltip>}
                        {row.status === 'processing' && <Chip label="进行中" color="warning" size="small" />}
                      </TableCell>
                      <TableCell align="right">
                        {row.status === 'success' && row.file_url && (
                          <IconButton size="small" color="primary" component="a"
                            href={`${API_BASE}${row.file_url}`} target="_blank">
                            <PdfIcon fontSize="small" />
                          </IconButton>
                        )}
                        <IconButton size="small" color="error" onClick={async () => {
                          if (!confirm('确定删除此记录？')) return;
                          await fetch(`${API_BASE}/api/rotor/history/${row.id}`, { method: 'DELETE', credentials: 'include' });
                          loadHistory();
                        }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* ── 警告/确认弹窗 ── */}
      <Dialog open={!!warning} onClose={handleWarningCancel} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningIcon color="warning" /> 
          安全与参数校验警告
        </DialogTitle>
        <DialogContent>
          {warning?.missing_length && (
            <Box sx={{ mb: warning?.stator_clearance ? 3 : 0 }}>
              <Typography variant="body1" sx={{ mb: 2, fontWeight: 'bold' }}>
                1. 总长度参数不完整
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                以下参数未提供，可在下方直接补全（否则按 0 计算，导致总长标注错误）：
              </Typography>
              
              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                {warning.missing_length.missing_params.map(p => (
                  <Grid item xs={6} key={p.key}>
                    <TextField
                      fullWidth size="small" type="number"
                      label={p.name}
                      placeholder="未提供"
                      value={supplements[p.key] || ''}
                      onChange={e => setSupplements(prev => ({ ...prev, [p.key]: e.target.value }))}
                      InputProps={{ endAdornment: <Typography variant="caption" color="text.secondary">mm</Typography> }}
                    />
                  </Grid>
                ))}
              </Grid>

              <Typography variant="body2" sx={{ mb: 1, fontWeight: 'bold' }}>总长预览：</Typography>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {warning.missing_length.components.map(c => {
                    const supVal = c.missing ? parseFloat(supplements[warning.missing_length?.missing_params.find(m => m.name === c.name)?.key || ''] || '0') : c.value;
                    return c.name + '(' + (c.missing && !supplements[warning.missing_length?.missing_params.find(m => m.name === c.name)?.key || ''] ? '?' : supVal) + ')';
                  }).join(' + ')}
                  {' = '}
                  {(() => {
                    const t = warning.missing_length!.components.reduce((sum, c) => {
                      if (c.missing) {
                        const k = warning.missing_length!.missing_params.find(m => m.name === c.name)?.key || '';
                        return sum + (parseFloat(supplements[k] || '0') || 0);
                      }
                      return sum + c.value;
                    }, 0);
                    const allFilled = warning.missing_length!.missing_params.every(p => parseFloat(supplements[p.key] || '0') > 0);
                    return <span style={{ fontWeight: 'bold', color: allFilled ? 'green' : 'red' }}>{t}mm</span>;
                  })()}
                </Typography>
              </Paper>
            </Box>
          )}

          {warning?.stator_clearance && (
            <Box>
              <Typography variant="body1" sx={{ mb: 1, fontWeight: 'bold', mt: warning?.missing_length ? 2 : 0, pt: warning?.missing_length ? 2 : 0, borderTop: warning?.missing_length ? '1px dashed #ccc' : 'none' }}>
                {warning?.missing_length ? '2. ' : ''}定子距花板安全风险
              </Typography>
              <Alert severity="error" icon={false}>
                {warning.stator_clearance.message}
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setWarning(null); setSupplements({}); }} color="inherit">
            取消
          </Button>
          <Button onClick={handleWarningConfirm} color="warning" variant="contained">
            我知道风险，继续出图
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
