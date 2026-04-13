import { useState, useMemo, useCallback, useRef } from 'react';
import {
  Paper, Typography, Box, Collapse, Chip, IconButton, Button,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import {
  Delete as DeleteIcon, Add as AddIcon, Edit as EditIcon,
  Inventory as TemplateIcon, ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';
import { PumpShellTemplate, TemplatePart, Part } from '../types';
import { createTemplate, updateTemplate, deleteTemplate } from '../utils/api';
import { getPriceByModelAndSupplier as _getPrice, getSuppliersByModel as _getSuppliersByModel } from '../utils/partHelpers';
import TemplateFormDialog, { PartFormRow } from './TemplateFormDialog';

interface Props {
  templates: PumpShellTemplate[];
  parts: Part[];
  fetchTemplates: (force?: boolean) => Promise<unknown>;
  setError: (msg: string) => void;
}

export default function TemplateSection({ templates, parts, fetchTemplates, setError }: Props) {
  const nextRowId = useRef(1);
  const [tplExpanded, setTplExpanded] = useState(true);
  const [tplDialogOpen, setTplDialogOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<PumpShellTemplate | null>(null);
  const [tplSaving, setTplSaving] = useState(false);
  const [tplDeleteId, setTplDeleteId] = useState<number | null>(null);
  const [shellModel, setShellModel] = useState('');
  const [shellSupplier, setShellSupplier] = useState('');
  const [tplDescription, setTplDescription] = useState('');
  const [partRows, setPartRows] = useState<PartFormRow[]>([]);
  const [assemblyWage, setAssemblyWage] = useState(0);
  const [packingWage, setPackingWage] = useState(0);
  const [paintingWage, setPaintingWage] = useState<number | null>(null);

  const getPriceByModelAndSupplier = useCallback(
    (model: string, supplier: string) => _getPrice(parts, model, supplier),
    [parts]
  );

  // ── 泵壳型号列表 (过滤掉已建模板的) ──
  const shellModels = useMemo(() => {
    const templateModels = new Set(templates.map(t => t.shell_model));
    const set = new Set<string>();
    parts.forEach(p => { 
      if (['泵体', '壳体', '泵壳'].includes(p.category) && p.model) {
        if (!templateModels.has(p.model) || (editingTpl && editingTpl.shell_model === p.model)) {
          set.add(p.model);
        }
      }
    });
    return Array.from(set).sort();
  }, [parts, templates, editingTpl]);

  // ── 零件型号去重列表 ──
  const uniqueModels = useMemo(() => {
    const set = new Set<string>();
    parts.forEach(p => { if (p.model) set.add(p.model); });
    return Array.from(set).sort();
  }, [parts]);

  const openCreateTpl = () => {
    setEditingTpl(null);
    setShellModel(''); setShellSupplier(''); setTplDescription('');
    setAssemblyWage(0); setPackingWage(0); setPaintingWage(null);
    setPartRows([
      { id: nextRowId.current++, name: '花板轴承', model: '', qty: 1, supplier: '' },
      { id: nextRowId.current++, name: '油缸轴承', model: '', qty: 1, supplier: '' },
      { id: nextRowId.current++, name: '机械油封', model: '', qty: 1, supplier: '' },
      { id: nextRowId.current++, name: '骨架油封', model: '', qty: 1, supplier: '' },
    ]);
    setTplDialogOpen(true);
  };

  const openEditTpl = (tpl: PumpShellTemplate) => {
    setEditingTpl(tpl); setShellModel(tpl.shell_model); setShellSupplier(''); setTplDescription(tpl.description || '');
    setAssemblyWage(tpl.assembly_wage || 0); setPackingWage(tpl.packing_wage || 0); setPaintingWage(tpl.painting_wage);
    try {
      const parsed: TemplatePart[] = JSON.parse(tpl.parts_json || '[]');
      setPartRows(parsed.map(p => ({ id: nextRowId.current++, name: p.name, model: p.model, qty: p.qty, supplier: p.supplier || '' })));
    } catch { setPartRows([]); }
    setTplDialogOpen(true);
  };

  const handleSaveTpl = async () => {
    const modelStr = shellModel.trim();
    if (!modelStr) { setError('泵壳型号不能为空'); return; }

    // 防止重复创建模板（客户端校验）
    if (!editingTpl && templates.some(t => t.shell_model === modelStr)) {
      setError(`泵壳型号 "${modelStr}" 已经配置过模板，请直接修改已有模板`);
      return;
    }
    if (editingTpl && templates.some(t => t.Id !== editingTpl.Id && t.shell_model === modelStr)) {
      setError(`泵壳型号 "${modelStr}" 已存在其他模板关联`);
      return;
    }

    const validRows = partRows.filter(r => r.model.trim());
    if (validRows.length === 0) { setError('至少需要一个配件'); return; }
    const pJson: TemplatePart[] = validRows.map(r => ({ name: r.name, model: r.model.trim(), qty: r.qty, supplier: r.supplier || '' }));
    setTplSaving(true);
    try {
      if (editingTpl) {
        await updateTemplate(editingTpl.Id, { shell_model: shellModel.trim(), description: tplDescription.trim(), parts_json: JSON.stringify(pJson), assembly_wage: assemblyWage, packing_wage: packingWage, painting_wage: paintingWage });
      } else {
        await createTemplate({ shell_model: shellModel.trim(), description: tplDescription.trim(), parts_json: JSON.stringify(pJson), assembly_wage: assemblyWage, packing_wage: packingWage, painting_wage: paintingWage });
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

  const calcTplCost = (tpl: PumpShellTemplate): number => {
    try {
      const p: TemplatePart[] = JSON.parse(tpl.parts_json || '[]');
      const partsCost = p.reduce((sum, x) => sum + getPriceByModelAndSupplier(x.model, x.supplier || '') * x.qty, 0);
      const laborCost = (tpl.assembly_wage || 0) + (tpl.packing_wage || 0) + (tpl.painting_wage || 0);
      return partsCost + laborCost;
    } catch { return 0; }
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
          <TemplateIcon sx={{ fontSize: 22, color: '#7c3aed', mr: 1 }} />
          <Typography variant="subtitle1" fontWeight={700} sx={{ flexGrow: 1, color: '#7c3aed' }}>
            泵壳模板
          </Typography>
          <Chip label={`${templates.length} 套`} size="small" sx={{ mr: 1, fontWeight: 600, fontSize: '0.7rem' }} />
          <Button
            variant="text" size="small" startIcon={<AddIcon />}
            onClick={(e) => { e.stopPropagation(); openCreateTpl(); }}
            sx={{ mr: 1, fontSize: '0.75rem', color: '#7c3aed' }}
          >
            新建
          </Button>
          {tplExpanded ? <ExpandLessIcon sx={{ color: 'text.disabled' }} /> : <ExpandMoreIcon sx={{ color: 'text.disabled' }} />}
        </Box>

        <Collapse in={tplExpanded}>
          <Box sx={{ p: 2 }}>
            {templates.length === 0 ? (
              <Box textAlign="center" py={3} color="text.disabled">
                <Typography variant="body2">还没有泵壳模板，点击上方"新建"创建</Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)', xl: 'repeat(4, 1fr)' } }}>
                {templates.map(tpl => {
                  let tplParts: TemplatePart[] = [];
                  try { tplParts = JSON.parse(tpl.parts_json || '[]'); } catch { /* */ }
                  const cost = calcTplCost(tpl);
                  return (
                    <Paper key={tpl.Id} variant="outlined" sx={{
                      p: 2, borderRadius: 2, transition: 'all 0.2s',
                      '&:hover': { borderColor: '#a855f7', boxShadow: '0 2px 12px rgba(124,58,237,0.08)' }
                    }}>
                      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                        <Box>
                          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#7c3aed' }}>{tpl.shell_model}</Typography>
                          {tpl.description && <Typography variant="caption" color="text.disabled">{tpl.description}</Typography>}
                        </Box>
                        <Box display="flex" gap={0.25}>
                          <IconButton size="small" onClick={() => openEditTpl(tpl)}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                          <IconButton size="small" color="error" onClick={() => setTplDeleteId(tpl.Id)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                        {tplParts.map((p, i) => {
                          const price = getPriceByModelAndSupplier(p.model, p.supplier || '');
                          return (
                            <Box key={i} display="flex" justifyContent="space-between" sx={{ fontSize: '0.75rem' }}>
                              <Box display="flex" gap={0.5} alignItems="center">
                                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 50 }}>{p.name}</Typography>
                                <Chip label={p.model} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                                {p.supplier && <Typography variant="caption" color="text.disabled">{p.supplier}</Typography>}
                                {p.qty > 1 && <Typography variant="caption" color="text.disabled">×{p.qty}</Typography>}
                              </Box>
                              <Typography variant="caption" sx={{ fontFamily: 'monospace', color: price > 0 ? 'success.main' : 'error.main' }}>
                                ¥{(price * p.qty).toFixed(2)}
                              </Typography>
                            </Box>
                          );
                        })}
                      </Box>
                      <Box display="flex" justifyContent="flex-end" mt={0.5} gap={0.5} flexWrap="wrap">
                        {(tpl.assembly_wage > 0 || tpl.packing_wage > 0 || (tpl.painting_wage != null && tpl.painting_wage > 0)) && (
                          <Chip label={`工资 ¥${((tpl.assembly_wage || 0) + (tpl.packing_wage || 0) + (tpl.painting_wage || 0)).toFixed(2)}`}
                            size="small" variant="outlined" color="warning"
                            sx={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.65rem' }} />
                        )}
                        <Chip label={`¥${cost.toFixed(2)}`} size="small" color={cost > 0 ? 'success' : 'default'}
                          sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.7rem' }} />
                      </Box>
                    </Paper>
                  );
                })}
              </Box>
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
        shellSupplier={shellSupplier}
        setShellSupplier={setShellSupplier}
        tplDescription={tplDescription}
        setTplDescription={setTplDescription}
        partRows={partRows}
        setPartRows={setPartRows}
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
        paintingWage={paintingWage}
        setPaintingWage={setPaintingWage}
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
