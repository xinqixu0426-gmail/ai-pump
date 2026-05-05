import {
  Box, Paper, Typography, IconButton, Tooltip, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer
} from '@mui/material';
import {
  Clock as HistoryIcon,
  RefreshCw as RefreshIcon,
  Trash2 as DeleteIcon,
  FileDown as PdfIcon,
  Printer as PrintIcon,
  Link2 as LinkIcon
} from 'lucide-react';
import { proxyRequest } from '../../utils/api';

interface RotorHistoryTableProps {
  history: any[];
  loadHistory: () => void;
  handlePrint: (jobId: string) => void;
  printing: boolean;
  API_BASE: string;
  onLinkClick: (row: any) => void;
  linking: boolean;
}

export default function RotorHistoryTable({
  history, loadHistory, handlePrint, printing, API_BASE, onLinkClick, linking
}: RotorHistoryTableProps) {
  if (history.length === 0) return null;

  return (
    <Paper elevation={0} sx={{ p: 2, mt: 3, borderRadius: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <HistoryIcon size={24} style={{ color: '#2563eb' }} />
        <Typography variant="h6">出图历史</Typography>
        <IconButton size="small" onClick={loadHistory}><RefreshIcon size={18} /></IconButton>
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>时间</TableCell>
              <TableCell>指令</TableCell>
              <TableCell>参数</TableCell>
              <TableCell>关联型号</TableCell>
              <TableCell>状态</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {history.map((row: any) => {
              const params = (() => { try { return JSON.parse(row.fc_params_json || '{}'); } catch { return {}; } })();
              const paramEntries = Object.entries(params).filter(([, v]) => v != null);
              const displayParams = paramEntries.slice(0, 4);
              const hasMore = paramEntries.length > 4;
              return (
                <TableRow key={row.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                    {row.created_at ? new Date(row.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                  </TableCell>
                  <TableCell>
                    <Tooltip title={row.nl_input || ''}>
                      <Typography variant="body2" sx={{ maxWidth: 250, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.8rem' }}>
                        {row.nl_input || '-'}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', maxWidth: 300 }}>
                      {displayParams.map(([k, v]) => (
                        <Chip color="primary" key={k} label={`${k}:${v}`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                      ))}
                      {hasMore && (
                        <Tooltip title={paramEntries.map(([k, v]) => `${k}:${v}`).join(', ')}>
                          <Chip label={`+${paramEntries.length - 4}`} size="small" variant="filled" sx={{ height: 20, fontSize: '0.7rem' }} />
                        </Tooltip>
                      )}
                      {paramEntries.length === 0 && <span style={{ color: '#aaa', fontSize: '0.75rem' }}>-</span>}
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
                        <Tooltip title="下载 PDF">
                          <IconButton size="small" color="primary" component="a"
                            href={`${API_BASE}${row.file_url}`} target="_blank">
                            <PdfIcon size={18} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="打印">
                          <IconButton size="small" color="primary" disabled={printing}
                            onClick={() => handlePrint(row.job_id)}>
                            <PrintIcon size={18} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip title="关联订单型号">
                      <IconButton size="small" color="secondary" disabled={linking}
                        onClick={() => onLinkClick(row)}>
                        <LinkIcon size={18} />
                      </IconButton>
                    </Tooltip>
                    <IconButton size="small" color="error" onClick={async () => {
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
    </Paper>
  );
}
