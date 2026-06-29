import {
  Box, Paper, Typography, IconButton, Tooltip, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, CircularProgress
} from '@mui/material';
import {
  Clock as HistoryIcon,
  RefreshCw as RefreshIcon,
  Trash2 as DeleteIcon,
  FileDown as PdfIcon,
  Printer as PrintIcon,
  Link2 as LinkIcon,
  Copy as CopyIcon,
  Edit3 as RenameIcon
} from 'lucide-react';
import { useState } from 'react';
import { proxyRequest } from '../../utils/api';

interface RotorHistoryTableProps {
  history: any[];
  loadHistory: () => void;
  handlePrint: (jobId: string) => void;
  printing: boolean;
  API_BASE: string;
  onLinkClick: (row: any) => void;
  linking: boolean;
  onReuseParams: (row: any) => void;
}

const PARAM_LABELS: Record<string, string> = {
  piece_count: '片数',
  rotor_dia: '转子',
  bearing_span: '开档',
  stack_offset: '定位',
  upper_bearing_dia: '上轴承孔',
  lower_bearing_dia: '下轴承孔',
  oil_seal_dia: '油封孔',
  impeller_dia: '叶轮孔',
  impeller_depth: '叶轮厚',
  thread_dia: '螺纹',
  thread_length: '螺丝长',
  bearing_to_impeller: '叶轮开档',
};

function pickParam(params: Record<string, unknown>, key: string) {
  const value = params[key];
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

function formatParamValue(key: string, value: string) {
  if (key === 'piece_count') return `${value}片`;
  if (key === 'rotor_dia') return `Φ${value}`;
  if (key === 'thread_dia') return `M${value}`;
  return value;
}

function buildKeyParamChips(params: Record<string, unknown>) {
  const primaryKeys = ['piece_count', 'rotor_dia', 'bearing_span', 'stack_offset'];
  const chips = primaryKeys
    .map(key => {
      const value = pickParam(params, key);
      return value ? { key, label: `${PARAM_LABELS[key]} ${formatParamValue(key, value)}` } : null;
    })
    .filter(Boolean) as Array<{ key: string; label: string }>;

  const upperBearing = pickParam(params, 'upper_bearing_dia');
  const lowerBearing = pickParam(params, 'lower_bearing_dia');
  if (upperBearing || lowerBearing) {
    chips.push({ key: 'bearings', label: `轴承孔 ${upperBearing || '-'} / ${lowerBearing || '-'}` });
  }

  const oilSeal = pickParam(params, 'oil_seal_dia');
  if (oilSeal) chips.push({ key: 'oil_seal_dia', label: `油封孔 ${oilSeal}` });

  return chips.slice(0, 6);
}

function fullParamText(params: Record<string, unknown>) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${PARAM_LABELS[key] || key}: ${value}`)
    .join('，');
}

function sanitizePdfName(value: string) {
  const clean = String(value || '').trim().replace(/[\\/:*?"<>|]/g, '_');
  return `${clean || '转子图纸'}.pdf`;
}

export default function RotorHistoryTable({
  history, loadHistory, handlePrint, printing, API_BASE, onLinkClick, linking, onReuseParams
}: RotorHistoryTableProps) {
  const [renameRow, setRenameRow] = useState<any>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  if (history.length === 0) return null;

  const openRename = (row: any) => {
    setRenameRow(row);
    setRenameValue(row.drawing_name || '');
  };

  const submitRename = async () => {
    if (!renameRow) return;
    setRenaming(true);
    try {
      await proxyRequest(`/api/rotor/history/${renameRow.id}/name`, {
        method: 'PATCH',
        body: JSON.stringify({ drawingName: renameValue.trim() })
      });
      await loadHistory();
      setRenameRow(null);
    } finally {
      setRenaming(false);
    }
  };

  return (
    <Paper elevation={0} sx={{ p: 2, mt: 3, borderRadius: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <HistoryIcon size={24} style={{ color: '#2563eb' }} />
        <Typography variant="h6">出图历史</Typography>
        <IconButton size="small" aria-label="刷新出图历史" onClick={loadHistory}><RefreshIcon size={18} /></IconButton>
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>时间</TableCell>
              <TableCell>图纸名称</TableCell>
              <TableCell>参数</TableCell>
              <TableCell>关联型号</TableCell>
              <TableCell>状态</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {history.map((row: any) => {
              const params = (() => { try { return JSON.parse(row.fc_params_json || '{}'); } catch { return {}; } })();
              const keyParamChips = buildKeyParamChips(params);
              const paramEntries = Object.entries(params).filter(([, v]) => v != null && v !== '');
              const fullParams = fullParamText(params);
              return (
                <TableRow key={row.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                    {row.created_at ? new Date(row.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem', fontWeight: row.drawing_name ? 700 : 400 }}>
                      {row.drawing_name || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', maxWidth: 360 }}>
                      {keyParamChips.map(chip => (
                        <Chip color="primary" key={chip.key} label={chip.label} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.72rem', fontWeight: 600 }} />
                      ))}
                      {paramEntries.length > keyParamChips.length && (
                        <Tooltip title={fullParams}>
                          <Chip label="完整参数" size="small" variant="filled" sx={{ height: 22, fontSize: '0.72rem' }} />
                        </Tooltip>
                      )}
                      {keyParamChips.length === 0 && <span style={{ color: '#aaa', fontSize: '0.75rem' }}>-</span>}
                    </Box>
                  </TableCell>
                  <TableCell>
                    {row.linked_pump_model ? (
                      <Chip label={row.linked_pump_model} size="small" color="secondary" sx={{ height: 22, fontSize: '0.75rem', fontWeight: 600 }} />
                    ) : (
                      <span style={{ color: '#aaa', fontSize: '0.75rem' }}>-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.status === 'success' && <Chip label="成功" color="success" size="small" />}
                    {row.status === 'failed' && <Tooltip title={row.error || ''}><Chip label="失败" color="error" size="small" /></Tooltip>}
                    {row.status === 'processing' && <Chip label="进行中" color="warning" size="small" />}
                  </TableCell>
                  <TableCell align="right">
                    {row.status === 'success' && row.file_url && (
                      <>
                        <Tooltip title="复用参数">
                          <IconButton size="small" color="primary"
                            aria-label="复用参数"
                            onClick={() => onReuseParams(row)}>
                            <CopyIcon size={18} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="重命名图纸">
                          <IconButton size="small" color="primary"
                            aria-label="重命名图纸"
                            onClick={() => openRename(row)}>
                            <RenameIcon size={18} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="下载 PDF">
                          <IconButton size="small" color="primary" component="a"
                            aria-label="下载 PDF"
                            href={`${API_BASE}${row.file_url}`}
                            download={sanitizePdfName(row.drawing_name)}>
                            <PdfIcon size={18} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="打印">
                          <IconButton size="small" color="primary" disabled={printing}
                            aria-label="打印图纸"
                            onClick={() => handlePrint(row.job_id)}>
                            <PrintIcon size={18} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip title="关联图纸对象">
                      <IconButton size="small" color="secondary" disabled={linking}
                        aria-label="关联图纸对象"
                        onClick={() => onLinkClick(row)}>
                        <LinkIcon size={18} />
                      </IconButton>
                    </Tooltip>
                    <IconButton size="small" color="error" aria-label="删除出图记录" onClick={async () => {
                      if (!confirm('确定删除此记录？')) return;
                      await proxyRequest(`/api/rotor/history/${row.id}`, { method: 'DELETE' });
                      loadHistory();
                    }}>
                      <DeleteIcon size={18} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Dialog open={!!renameRow} onClose={() => setRenameRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>重命名图纸</DialogTitle>
        <DialogContent sx={{ pt: 2.5 }}>
          <TextField
            fullWidth
            autoFocus
            label="图纸名称"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder="例如 V750转子-160片"
            size="small"
            sx={{ mt: 1.5 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameRow(null)} disabled={renaming}>取消</Button>
          <Button variant="contained" onClick={submitRename} disabled={renaming} startIcon={renaming ? <CircularProgress size={16} /> : undefined}>保存</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
