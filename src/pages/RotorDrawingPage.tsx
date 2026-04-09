import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box, Paper, Typography, TextField, Button, Grid, MenuItem,
  Alert, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  CircularProgress, Chip, IconButton, Tooltip, LinearProgress,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer
} from '@mui/material';
import {
  Build as BuildIcon,
  Send as SendIcon,
  Mic as MicIcon,
  PictureAsPdf as PdfIcon,
  Warning as WarningIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Refresh as RefreshIcon,
  History as HistoryIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';

const API_BASE = import.meta.env.VITE_API_URL || '';

const BEARING_OPTIONS = [
  { value: '', label: '未指定' },
  { value: '6201', label: '6201 (孔径12mm)' },
  { value: '6202', label: '6202 (孔径15mm)' },
  { value: '6203', label: '6203 (孔径17mm)' },
  { value: '6204', label: '6204 (孔径20mm)' },
  { value: '6205', label: '6205 (孔径25mm)' },
];

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

  // ── 状态 ──
  const [warning, setWarning] = useState<{ message: string; extracted: any } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState('');
  const [extracted, setExtracted] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const submitChat = useCallback(async (message: string, force = false) => {
    setError('');
    setNlLoading(true);
    setJobId(null);
    setJobStatus(null);

    try {
      const res = await fetch(`${API_BASE}/api/rotor/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, force })
      });
      const data = await res.json();

      if (data.status === 'warning') {
        setWarning({ message: data.message, extracted: data.extracted });
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
    submitChat(nlInput);
  };

  const handleWarningConfirm = () => {
    setWarning(null);
    submitChat(nlInput, true);
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

      {/* ── 定子距花板警告弹窗 ── */}
      <Dialog open={!!warning} onClose={handleWarningCancel}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningIcon color="warning" /> 安全警告
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{warning?.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleWarningCancel} color="inherit">取消，重新设置定位</Button>
          <Button onClick={handleWarningConfirm} color="warning" variant="contained">我知道风险，继续出图</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
