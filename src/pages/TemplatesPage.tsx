import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Paper, Typography, Box, Button, TextField, Table, TableHead,
  TableBody, TableRow, TableCell, IconButton, Chip, Dialog,
  DialogTitle, DialogContent, DialogActions, Alert, CircularProgress,
  Tooltip, Divider, Autocomplete,
} from '@mui/material';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  Save as SaveIcon, Close as CloseIcon, Inventory as TemplateIcon,
} from '@mui/icons-material';
import { PumpShellTemplate, TemplatePart } from '../types';
import { createTemplate, updateTemplate, deleteTemplate } from '../utils/api';
import { useAppStore } from '../utils/store';

interface PartFormRow {
  id: number;
  name: string;
  model: string;
  qty: number;
}

let nextRowId = 1;

export default function TemplatesPage() {
  const { templates, fetchTemplates, parts, fetchParts } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<PumpShellTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // 表单状态
  const [shellModel, setShellModel] = useState('');
  const [description, setDescription] = useState('');
  const [partRows, setPartRows] = useState<PartFormRow[]>([]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      await Promise.all([fetchTemplates(), fetchParts()]);
    } catch {
      setError('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [fetchTemplates, fetchParts]);

  useEffect(() => { loadData(); }, [loadData]);

  // 去重的零件型号列表（供 Autocomplete）
  const uniqueModels = useMemo(() => {
    const set = new Set<string>();
    parts.forEach(p => { if (p.model) set.add(p.model); });
    return Array.from(set).sort();
  }, [parts]);

  // 查零件实时价格
  const getPrice = useCallback((model: string): number => {
    const candidates = parts.filter(p => p.model.trim() === model.trim());
    if (candidates.length === 0) return 0;
    return candidates.reduce((min, c) => c.price < min.price ? c : min, candidates[0]).price;
  }, [parts]);

  const openCreateDialog = () => {
    setEditingTpl(null);
    setShellModel('');
    setDescription('');
    setPartRows([
      { id: nextRowId++, name: '泵壳', model: '', qty: 1 },
      { id: nextRowId++, name: '花板轴承', model: '', qty: 1 },
      { id: nextRowId++, name: '油缸轴承', model: '', qty: 1 },
      { id: nextRowId++, name: '机械油封', model: '', qty: 1 },
      { id: nextRowId++, name: '骨架油封', model: '', qty: 1 },
    ]);
    setDialogOpen(true);
  };

  const openEditDialog = (tpl: PumpShellTemplate) => {
    setEditingTpl(tpl);
    setShellModel(tpl.shell_model);
    setDescription(tpl.description || '');
    try {
      const parsed: TemplatePart[] = JSON.parse(tpl.parts_json || '[]');
      setPartRows(parsed.map(p => ({ id: nextRowId++, name: p.name, model: p.model, qty: p.qty })));
    } catch {
      setPartRows([]);
    }
    setDialogOpen(true);
  };

  const handleAddRow = () => {
    setPartRows(prev => [...prev, { id: nextRowId++, name: '', model: '', qty: 1 }]);
  };

  const handleRowChange = (id: number, field: keyof Omit<PartFormRow, 'id'>, value: string | number) => {
    setPartRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleRemoveRow = (id: number) => {
    setPartRows(prev => prev.filter(r => r.id !== id));
  };

  const handleSave = async () => {
    if (!shellModel.trim()) { setError('泵壳型号不能为空'); return; }
    const validRows = partRows.filter(r => r.model.trim());
    if (validRows.length === 0) { setError('至少需要一个配件'); return; }

    const partsJson: TemplatePart[] = validRows.map(r => ({ name: r.name, model: r.model.trim(), qty: r.qty }));
    setSaving(true);
    try {
      if (editingTpl) {
        await updateTemplate(editingTpl.Id, {
          shell_model: shellModel.trim(),
          description: description.trim(),
          parts_json: JSON.stringify(partsJson),
        });
      } else {
        await createTemplate({
          shell_model: shellModel.trim(),
          description: description.trim(),
          parts_json: JSON.stringify(partsJson),
        });
      }
      setDialogOpen(false);
      await fetchTemplates(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTemplate(id);
      setDeleteConfirmId(null);
      await fetchTemplates(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setDeleteConfirmId(null);
    }
  };

  // 计算模板总成本
  const calcTemplateCost = (tpl: PumpShellTemplate): number => {
    try {
      const tplParts: TemplatePart[] = JSON.parse(tpl.parts_json || '[]');
      return tplParts.reduce((sum, p) => sum + getPrice(p.model) * p.qty, 0);
    } catch { return 0; }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" py={8}><CircularProgress /></Box>;
  }

  return (
    <Box>
      {/* 页面标题 */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <TemplateIcon sx={{ fontSize: 28, color: '#7c3aed' }} />
          <Typography variant="h5" fontWeight={800} sx={{ letterSpacing: 0.5 }}>
            泵壳模板管理
          </Typography>
          <Chip label={`${templates.length} 套`} size="small" sx={{ fontWeight: 600 }} />
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateDialog}
          sx={{ background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)', fontWeight: 700 }}>
          新建模板
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* 模板列表 */}
      {templates.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <TemplateIcon sx={{ fontSize: 64, color: '#d4d4d8', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>还没有泵壳模板</Typography>
          <Typography variant="body2" color="text.disabled" mb={3}>
            创建泵壳模板，定义每个泵壳型号的固定配件清单
          </Typography>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={openCreateDialog}>
            创建第一个模板
          </Button>
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' } }}>
          {templates.map(tpl => {
            let tplParts: TemplatePart[] = [];
            try { tplParts = JSON.parse(tpl.parts_json || '[]'); } catch { /* */ }
            const cost = calcTemplateCost(tpl);

            return (
              <Paper key={tpl.Id} sx={{
                p: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider',
                transition: 'all 0.2s', '&:hover': { borderColor: '#a855f7', boxShadow: '0 4px 20px rgba(124,58,237,0.1)' }
              }}>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1.5}>
                  <Box>
                    <Typography variant="h6" fontWeight={700} sx={{ color: '#7c3aed' }}>
                      {tpl.shell_model}
                    </Typography>
                    {tpl.description && (
                      <Typography variant="caption" color="text.secondary">{tpl.description}</Typography>
                    )}
                  </Box>
                  <Box display="flex" gap={0.5}>
                    <Tooltip title="编辑">
                      <IconButton size="small" onClick={() => openEditDialog(tpl)}><EditIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    <Tooltip title="删除">
                      <IconButton size="small" color="error" onClick={() => setDeleteConfirmId(tpl.Id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                <Divider sx={{ mb: 1.5 }} />

                {/* 配件列表 */}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1.5 }}>
                  {tplParts.map((p, i) => {
                    const price = getPrice(p.model);
                    return (
                      <Box key={i} display="flex" justifyContent="space-between" alignItems="center" sx={{ fontSize: '0.8rem' }}>
                        <Box display="flex" alignItems="center" gap={0.5}>
                          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 60 }}>{p.name}</Typography>
                          <Chip label={p.model} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                          {p.qty > 1 && <Typography variant="caption" color="text.disabled">×{p.qty}</Typography>}
                        </Box>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', color: price > 0 ? 'success.main' : 'error.main' }}>
                          ¥{(price * p.qty).toFixed(2)}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>

                {/* 总成本 */}
                <Box display="flex" justifyContent="space-between" alignItems="center"
                  sx={{ pt: 1, borderTop: '1px dashed', borderColor: 'divider' }}>
                  <Typography variant="caption" color="text.secondary">
                    {tplParts.length} 种配件
                  </Typography>
                  <Chip label={`¥${cost.toFixed(2)}`} size="small" color={cost > 0 ? 'success' : 'default'}
                    sx={{ fontWeight: 700, fontFamily: 'monospace' }} />
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}

      {/* 创建/编辑对话框 */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {editingTpl ? `编辑模板 — ${editingTpl.shell_model}` : '新建泵壳模板'}
          <IconButton onClick={() => setDialogOpen(false)}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent>
          <Box display="flex" gap={2} mb={2} mt={1}>
            <TextField label="泵壳型号" value={shellModel} onChange={e => setShellModel(e.target.value)}
              placeholder="如 V750" required size="small" sx={{ flex: 1 }} />
            <TextField label="描述(可选)" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="如 V750标准配件包" size="small" sx={{ flex: 2 }} />
          </Box>

          <Typography variant="subtitle2" fontWeight={700} mb={1} color="text.secondary">
            固定配件清单（只需填型号和数量，价格从零件表自动拉取）
          </Typography>

          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', width: 120 }}>配件名称</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>型号</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', width: 70 }}>数量</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', width: 80, textAlign: 'right' }}>实时单价</TableCell>
                <TableCell sx={{ width: 40 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {partRows.map(row => {
                const price = getPrice(row.model);
                return (
                  <TableRow key={row.id}>
                    <TableCell sx={{ py: 0.5 }}>
                      <TextField size="small" fullWidth value={row.name}
                        onChange={e => handleRowChange(row.id, 'name', e.target.value)}
                        placeholder="如 花板轴承" variant="standard"
                        inputProps={{ style: { fontSize: '0.85rem' } }} />
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <Autocomplete
                        freeSolo
                        disableClearable
                        options={uniqueModels}
                        value={row.model}
                        onChange={(_e, v) => handleRowChange(row.id, 'model', v || '')}
                        onInputChange={(_e, v) => handleRowChange(row.id, 'model', v || '')}
                        renderInput={(params) => (
                          <TextField {...params} size="small" fullWidth
                            placeholder="搜索或输入型号" variant="standard"
                            inputProps={{ ...params.inputProps, style: { fontSize: '0.85rem' } }} />
                        )}
                        sx={{ minWidth: 120 }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <TextField size="small" type="number" value={row.qty}
                        onChange={e => handleRowChange(row.id, 'qty', Math.max(1, parseInt(e.target.value) || 1))}
                        variant="standard" sx={{ width: 50 }}
                        inputProps={{ min: 1, style: { fontSize: '0.85rem', textAlign: 'center' } }} />
                    </TableCell>
                    <TableCell sx={{ py: 0.5, textAlign: 'right' }}>
                      <Typography variant="body2" sx={{
                        fontFamily: 'monospace', fontSize: '0.8rem',
                        color: row.model && price > 0 ? 'success.main' : (row.model ? 'error.main' : 'text.disabled')
                      }}>
                        {row.model ? `¥${price.toFixed(2)}` : '-'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <IconButton size="small" color="error" onClick={() => handleRemoveRow(row.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Button size="small" startIcon={<AddIcon />} onClick={handleAddRow} sx={{ mt: 1 }}>
            添加配件行
          </Button>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button variant="contained" startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
            onClick={handleSave} disabled={saving || !shellModel.trim()}>
            {editingTpl ? '更新' : '创建'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={deleteConfirmId !== null} onClose={() => setDeleteConfirmId(null)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>确定要删除此泵壳模板吗？如果有配方引用此模板将无法删除。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmId(null)}>取消</Button>
          <Button color="error" variant="contained" onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}>
            确认删除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
