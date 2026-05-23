import { useState, useMemo, useRef } from 'react';
import {
  Paper, Typography, Box, Collapse, Chip, IconButton, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, InputAdornment,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip,
} from '@mui/material';
import {
  Trash2 as DeleteIcon, Plus as AddIcon, Edit3 as EditIcon,
  Package as TemplateIcon, ChevronDown as ExpandMoreIcon,
  ChevronUp as ExpandLessIcon, Search as SearchIcon,
} from 'lucide-react';
import { PumpShellTemplate, TemplatePart, Part, ShellComponent } from '../types';
import { createTemplate, updateTemplate, deleteTemplate } from '../utils/api';
import TemplateFormDialog, { PartFormRow, ShellComponentFormRow } from './TemplateFormDialog';

interface Props {
  templates: PumpShellTemplate[];
  parts: Part[];
  fetchTemplates: (force?: boolean) => Promise<unknown>;
  setError: (msg: string) => void;
}

function formatEntryTime(value?: string): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface TemplateListItem {
  tpl: PumpShellTemplate;
  parts: TemplatePart[];
  shellComponents: ShellComponent[];
  shellCost: number;
  costMode: 'bundle' | 'components';
  laborCost: number;
  searchText: string;
}

function parseJsonArray<T>(value?: string): T[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function defaultFixedPartRows(nextRowId: React.MutableRefObject<number>): PartFormRow[] {
  return [
    { id: nextRowId.current++, name: '花板轴承', model: '', qty: 1, supplier: '' },
    { id: nextRowId.current++, name: '油缸轴承', model: '', qty: 1, supplier: '' },
    { id: nextRowId.current++, name: '机械油封', model: '', qty: 1, supplier: '' },
    { id: nextRowId.current++, name: '骨架油封', model: '', qty: 1, supplier: '' },
  ];
}

function defaultShellComponentRows(nextRowId: React.MutableRefObject<number>): ShellComponentFormRow[] {
  return ['上帽', '机筒', '花板', '油缸', '泵头', '叶轮', '底座', '法兰'].map(name => ({
    id: nextRowId.current++,
    name,
    model: '',
    qty: name === '机筒' ? 15 : 1,
    unitCost: 0,
    pricingMode: name === '机筒' ? 'lengthCm' : 'fixed',
    included: name !== '法兰',
    optional: name === '法兰',
    note: '',
  }));
}

export default function TemplateSection({ templates, parts, fetchTemplates, setError }: Props) {
  const nextRowId = useRef(1);
  const [tplExpanded, setTplExpanded] = useState(true);
  const [tplDialogOpen, setTplDialogOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<PumpShellTemplate | null>(null);
  const [tplSaving, setTplSaving] = useState(false);
  const [tplDeleteId, setTplDeleteId] = useState<number | null>(null);
  const [shellModel, setShellModel] = useState('');
  const [tplDescription, setTplDescription] = useState('');
  const [partRows, setPartRows] = useState<PartFormRow[]>([]);
  const [shellComponentRows, setShellComponentRows] = useState<ShellComponentFormRow[]>([]);
  const [assemblyWage, setAssemblyWage] = useState(0);
  const [packingWage, setPackingWage] = useState(0);
  const [costMode, setCostMode] = useState<'bundle' | 'components'>('components');
  const [bundleCost, setBundleCost] = useState(0);
  const [tplQuery, setTplQuery] = useState('');

  // ── 泵壳型号列表 ──
  const shellModels = useMemo(() => {
    const set = new Set<string>();
    parts.forEach(p => { 
      if (['泵体', '壳体', '泵壳'].includes(p.category) && p.model) {
        set.add(p.model);
      }
    });
    return Array.from(set).sort();
  }, [parts]);

  // ── 零件型号去重列表 ──
  const uniqueModels = useMemo(() => {
    const set = new Set<string>();
    parts.forEach(p => { if (p.model) set.add(p.model); });
    return Array.from(set).sort();
  }, [parts]);

  const templateRows = useMemo<TemplateListItem[]>(() => {
    return templates.map(tpl => {
      const tplParts = parseJsonArray<TemplatePart>(tpl.partsJson);
      const shellComponents = parseJsonArray<ShellComponent>(tpl.shellComponentsJson);
      const costMode = tpl.costMode === 'bundle' ? 'bundle' : 'components';
      const shellCost = costMode === 'bundle'
        ? Number(tpl.bundleCost || 0)
        : shellComponents.reduce((sum, c) => c.included === false ? sum : sum + Number(c.unitCost || 0) * Number(c.qty || 1), 0);
      const laborCost = (tpl.assemblyWage || 0) + (tpl.packingWage || 0);
      const partsText = tplParts.map(p => `${p.name} ${p.model}`).join(' ');
      const componentText = shellComponents.map(c => `${c.name} ${c.model || ''}`).join(' ');
      return {
        tpl,
        parts: tplParts,
        shellComponents,
        shellCost,
        costMode,
        laborCost,
        searchText: `${tpl.shellModel} ${tpl.description || ''} ${partsText} ${componentText}`.toLowerCase(),
      };
    });
  }, [templates]);

  const filteredTemplateRows = useMemo(() => {
    const q = tplQuery.trim().toLowerCase();
    if (!q) return templateRows;
    return templateRows.filter(row => row.searchText.includes(q));
  }, [templateRows, tplQuery]);

  const openCreateTpl = () => {
    setEditingTpl(null);
    setShellModel(''); setTplDescription('');
    setAssemblyWage(0); setPackingWage(0);
    setCostMode('components');
    setBundleCost(0);
    setPartRows(defaultFixedPartRows(nextRowId));
    setShellComponentRows(defaultShellComponentRows(nextRowId));
    setTplDialogOpen(true);
  };

  const openEditTpl = (tpl: PumpShellTemplate) => {
    setEditingTpl(tpl); setShellModel(tpl.shellModel); setTplDescription(tpl.description || '');
    setAssemblyWage(tpl.assemblyWage || 0); setPackingWage(tpl.packingWage || 0);
    setCostMode(tpl.costMode === 'bundle' ? 'bundle' : 'components');
    setBundleCost(tpl.bundleCost || 0);
    setPartRows(parseJsonArray<TemplatePart>(tpl.partsJson).map(p => ({ id: nextRowId.current++, name: p.name, model: p.model, qty: p.qty, supplier: p.supplier || '' })));
    const components = parseJsonArray<ShellComponent>(tpl.shellComponentsJson);
    setShellComponentRows(components.length > 0
      ? components.map(c => ({
          id: nextRowId.current++,
          name: c.name,
          model: c.model || '',
          qty: c.qty || 1,
          unitCost: c.unitCost || 0,
          pricingMode: c.pricingMode || 'fixed',
          included: c.included !== false,
          optional: !!c.optional,
          note: c.note || '',
        }))
      : defaultShellComponentRows(nextRowId));
    setTplDialogOpen(true);
  };

  const handleSaveTpl = async () => {
    const modelStr = shellModel.trim();
    if (!modelStr) { setError('泵壳型号不能为空'); return; }

    // 防止重复创建模板（客户端校验）
    if (!editingTpl && templates.some(t => t.shellModel === modelStr)) {
      setError(`泵壳型号 "${modelStr}" 已经配置过模板，请直接修改已有模板`);
      return;
    }
    if (editingTpl && templates.some(t => t.Id !== editingTpl.Id && t.shellModel === modelStr)) {
      setError(`泵壳型号 "${modelStr}" 已存在其他模板关联`);
      return;
    }

    const validRows = partRows.filter(r => r.model.trim());
    if (validRows.length === 0) { setError('至少需要一个配件'); return; }
    if (costMode === 'bundle' && bundleCost <= 0) { setError('请填写整套泵壳成本'); return; }
    const validComponents = shellComponentRows.filter(r => r.name.trim() && r.included !== false);
    if (costMode === 'components' && validComponents.length === 0) {
      setError('组件明细模式至少需要一个计入成本的泵壳组件');
      return;
    }
    const pJson: TemplatePart[] = validRows.map(r => ({ name: r.name, model: r.model.trim(), qty: r.qty, supplier: r.supplier || '' }));
    const cJson: ShellComponent[] = costMode === 'components'
      ? shellComponentRows
          .filter(r => r.name.trim())
          .map(r => ({
            name: r.name.trim(),
            model: r.model.trim(),
            qty: r.qty || 1,
            unitCost: r.unitCost || 0,
            pricingMode: r.pricingMode || 'fixed',
            included: r.included !== false,
            optional: !!r.optional,
            note: r.note || '',
          }))
      : [];
    setTplSaving(true);
    try {
      const payload = {
        shellModel: modelStr,
        description: tplDescription.trim(),
        partsJson: JSON.stringify(pJson),
        shellComponentsJson: JSON.stringify(cJson),
        assemblyWage,
        packingWage,
        costMode,
        bundleCost,
      };
      if (editingTpl) {
        await updateTemplate(editingTpl.Id, payload);
      } else {
        await createTemplate({ ...payload, paintingWage: null });
      }
      setTplDialogOpen(false);
      await fetchTemplates(true);
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
    finally { setTplSaving(false); }
  };

  const confirmDeleteTpl = async () => {
    if (tplDeleteId === null) return;
    try { await deleteTemplate(tplDeleteId); setTplDeleteId(null); await fetchTemplates(true); }
    catch (err) { setError(err instanceof Error ? err.message : '删除失败'); setTplDeleteId(null); }
  };



  return (
    <>
      <Paper elevation={0} sx={{ mb: 3, overflow: 'hidden', borderRadius: 3 }}>
        <Box
          onClick={() => setTplExpanded(!tplExpanded)}
          sx={{
            px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', cursor: 'pointer',
            background: 'linear-gradient(135deg, rgba(124,58,237,0.06) 0%, rgba(168,85,247,0.03) 100%)',
            borderBottom: tplExpanded ? '1px solid' : 'none', borderColor: 'divider',
            '&:hover': { bgcolor: 'rgba(124,58,237,0.08)' }, transition: 'all 0.2s',
          }}
        >
          <TemplateIcon size={22} color="#7c3aed" style={{ marginRight: 8 }} />
          <Typography variant="subtitle1" fontWeight={700} sx={{ flexGrow: 1, color: '#7c3aed' }}>
            泵壳模板
          </Typography>
          <Chip label={`${templates.length} 套`} size="small" sx={{ mr: 1, fontWeight: 600, fontSize: '0.7rem' }} />
          <Button
            variant="text" size="small" startIcon={<AddIcon size={18} />}
            onClick={(e) => { e.stopPropagation(); openCreateTpl(); }}
            sx={{ mr: 1, fontSize: '0.75rem', color: '#7c3aed' }}
          >
            新建
          </Button>
          {tplExpanded ? <ExpandLessIcon size={20} color="#9ca3af" /> : <ExpandMoreIcon size={20} color="#9ca3af" />}
        </Box>

        <Collapse in={tplExpanded}>
          <Box sx={{ p: 2 }}>
            {templates.length === 0 ? (
              <Box textAlign="center" py={3} color="text.disabled">
                <Typography variant="body2">还没有泵壳模板，点击上方"新建"创建</Typography>
              </Box>
            ) : (
              <>
                <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <TextField
                    value={tplQuery}
                    onChange={(e) => setTplQuery(e.target.value)}
                    placeholder="搜索型号 / 描述 / 配件"
                    size="small"
                    sx={{ width: { xs: '100%', sm: 320 } }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon size={16} />
                        </InputAdornment>
                      ),
                    }}
                  />
                  {tplQuery && (
                    <Chip
                      label={`${filteredTemplateRows.length} / ${templates.length}`}
                      size="small"
                      variant="outlined"
                      sx={{ fontWeight: 600 }}
                    />
                  )}
                </Box>

                {filteredTemplateRows.length === 0 ? (
                  <Box textAlign="center" py={3} color="text.secondary">
                    <Typography variant="body2">没有匹配的泵壳模板</Typography>
                  </Box>
                ) : (
                  <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, maxHeight: 560 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ width: 150 }}>型号</TableCell>
                          <TableCell sx={{ minWidth: 160 }}>说明</TableCell>
                          <TableCell sx={{ width: 120 }}>录入时间</TableCell>
                          <TableCell>泵壳成本</TableCell>
                          <TableCell>固定配件</TableCell>
                          <TableCell align="right" sx={{ width: 96 }}>工时工资</TableCell>
                          <TableCell align="center" sx={{ width: 96 }}>操作</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredTemplateRows.map(({ tpl, parts: tplParts, shellComponents, shellCost, costMode, laborCost }) => (
                          <TableRow key={tpl.Id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                            <TableCell>
                              <Typography variant="body2" fontWeight={800} sx={{ color: '#7c3aed' }}>
                                {tpl.shellModel}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ maxWidth: 220 }}>
                              <Typography
                                variant="body2"
                                color={tpl.description ? 'text.primary' : 'text.disabled'}
                                title={tpl.description || '-'}
                                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              >
                                {tpl.description || '-'}
                              </Typography>
                            </TableCell>
                            <TableCell title={tpl.CreatedAt ? new Date(tpl.CreatedAt).toLocaleString('zh-CN', { hour12: false }) : '-'}>
                              <Typography variant="body2" color="text.secondary">
                                {formatEntryTime(tpl.CreatedAt)}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, py: 0.25 }}>
                                <Chip
                                  label={`${costMode === 'bundle' ? '整套' : '组件'} ¥${shellCost.toFixed(2)}`}
                                  size="small"
                                  color={costMode === 'bundle' ? 'primary' : 'success'}
                                  sx={{ height: 22, fontSize: '0.72rem' }}
                                />
                                {costMode === 'components' && shellComponents.slice(0, 3).map((c, i) => (
                                  <Chip
                                    key={`${c.name}-${i}`}
                                    label={`${c.name} ¥${Number(c.unitCost || 0).toFixed(2)}${c.pricingMode === 'lengthCm' ? '/cm' : ''}`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ height: 22, maxWidth: 150, fontSize: '0.72rem', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                                  />
                                ))}
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, py: 0.25 }}>
                                {tplParts.length === 0 ? (
                                  <Typography variant="body2" color="text.disabled">-</Typography>
                                ) : tplParts.map((p, i) => (
                                  <Tooltip key={`${p.name}-${p.model}-${i}`} title={`${p.name}${p.qty > 1 ? ` ×${p.qty}` : ''}`}>
                                    <Chip
                                      label={`${p.name} ${p.model}${p.qty > 1 ? ` ×${p.qty}` : ''}`}
                                      size="small"
                                      variant="outlined"
                                      sx={{ height: 22, maxWidth: 180, fontSize: '0.72rem', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                                    />
                                  </Tooltip>
                                ))}
                              </Box>
                            </TableCell>
                            <TableCell align="right">
                              {laborCost > 0 ? (
                                <Typography variant="body2" sx={{ color: 'warning.main', fontWeight: 700, fontFamily: 'monospace' }}>
                                  ¥{laborCost.toFixed(2)}
                                </Typography>
                              ) : (
                                <Typography variant="body2" color="text.disabled">-</Typography>
                              )}
                            </TableCell>
                            <TableCell align="center">
                              <Tooltip title="编辑">
                                <IconButton size="small" aria-label="编辑泵壳模板" color="warning" onClick={() => openEditTpl(tpl)}>
                                  <EditIcon size={16} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="删除">
                                <IconButton size="small" aria-label="删除泵壳模板" color="error" onClick={() => setTplDeleteId(tpl.Id)}>
                                  <DeleteIcon size={16} />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </>
            )}
          </Box>
        </Collapse>
      </Paper>

      {/* 模板编辑对话框 */}
      <TemplateFormDialog
        open={tplDialogOpen}
        onClose={() => setTplDialogOpen(false)}
        editingTpl={editingTpl}
        shellModel={shellModel}
        setShellModel={setShellModel}
        tplDescription={tplDescription}
        setTplDescription={setTplDescription}
        partRows={partRows}
        setPartRows={setPartRows}
        shellComponentRows={shellComponentRows}
        setShellComponentRows={setShellComponentRows}
        parts={parts}
        shellModels={shellModels}
        uniqueModels={uniqueModels}
        tplSaving={tplSaving}
        onSave={handleSaveTpl}
        nextRowId={nextRowId}
        assemblyWage={assemblyWage}
        setAssemblyWage={setAssemblyWage}
        packingWage={packingWage}
        setPackingWage={setPackingWage}
        costMode={costMode}
        setCostMode={setCostMode}
        bundleCost={bundleCost}
        setBundleCost={setBundleCost}
      />

      {/* 模板删除确认 */}
      <Dialog open={tplDeleteId !== null} onClose={() => setTplDeleteId(null)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent><Typography>确定要删除此泵壳模板吗？如果有配方引用此模板将无法删除。</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setTplDeleteId(null)}>取消</Button>
          <Button color="error" variant="contained" onClick={confirmDeleteTpl}>确认删除</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
