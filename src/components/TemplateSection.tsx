import { useState, useMemo, useRef } from 'react';
import {
  Paper, Typography, Box, Collapse, Chip, IconButton, Button,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import {
  Trash2 as DeleteIcon, Plus as AddIcon, Edit3 as EditIcon,
  Package as TemplateIcon, ChevronDown as ExpandMoreIcon,
  ChevronUp as ExpandLessIcon,
} from 'lucide-react';
import { PumpShellTemplate, TemplatePart, Part } from '../types';
import { createTemplate, updateTemplate, deleteTemplate } from '../utils/api';
import TemplateFormDialog, { PartFormRow } from './TemplateFormDialog';

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
  const [assemblyWage, setAssemblyWage] = useState(0);
  const [packingWage, setPackingWage] = useState(0);

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

  const openCreateTpl = () => {
    setEditingTpl(null);
    setShellModel(''); setTplDescription('');
    setAssemblyWage(0); setPackingWage(0);
    setPartRows([
      { id: nextRowId.current++, name: '花板轴承', model: '', qty: 1, supplier: '' },
      { id: nextRowId.current++, name: '油缸轴承', model: '', qty: 1, supplier: '' },
      { id: nextRowId.current++, name: '机械油封', model: '', qty: 1, supplier: '' },
      { id: nextRowId.current++, name: '骨架油封', model: '', qty: 1, supplier: '' },
    ]);
    setTplDialogOpen(true);
  };

  const openEditTpl = (tpl: PumpShellTemplate) => {
    setEditingTpl(tpl); setShellModel(tpl.shellModel); setTplDescription(tpl.description || '');
    setAssemblyWage(tpl.assemblyWage || 0); setPackingWage(tpl.packingWage || 0);
    try {
      const parsed: TemplatePart[] = JSON.parse(tpl.partsJson || '[]');
      setPartRows(parsed.map(p => ({ id: nextRowId.current++, name: p.name, model: p.model, qty: p.qty, supplier: p.supplier || '' })));
    } catch { setPartRows([]); }
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
    const pJson: TemplatePart[] = validRows.map(r => ({ name: r.name, model: r.model.trim(), qty: r.qty, supplier: r.supplier || '' }));
    setTplSaving(true);
    try {
      if (editingTpl) {
        await updateTemplate(editingTpl.Id, { shellModel: shellModel.trim(), description: tplDescription.trim(), partsJson: JSON.stringify(pJson), assemblyWage: assemblyWage, packingWage: packingWage });
      } else {
        await createTemplate({ shellModel: shellModel.trim(), description: tplDescription.trim(), partsJson: JSON.stringify(pJson), assemblyWage: assemblyWage, packingWage: packingWage, paintingWage: null });
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
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)', xl: 'repeat(4, 1fr)' } }}>
                {templates.map(tpl => {
                  let tplParts: TemplatePart[] = [];
                  try { tplParts = JSON.parse(tpl.partsJson || '[]'); } catch { /* */ }
                  const laborCost = (tpl.assemblyWage || 0) + (tpl.packingWage || 0);
                  return (
                    <Paper key={tpl.Id} variant="outlined" sx={{
                      p: 2, pb: 2.5, borderRadius: 2, transition: 'all 0.2s', position: 'relative', overflow: 'hidden',
                      '&:hover': { borderColor: '#a855f7', boxShadow: '0 4px 20px rgba(124,58,237,0.1)', transform: 'translateY(-2px)' }
                    }}>
                      <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '4px', background: 'linear-gradient(90deg, #7c3aed, #ec4899)' }} />
                      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2} pb={1} sx={{ borderBottom: '1px dashed', borderColor: 'divider' }}>
                        <Box>
                          <Typography variant="subtitle2" fontWeight={800} sx={{ color: '#7c3aed', fontSize: '1rem', mb: 0.5 }}>{tpl.shellModel}</Typography>
                          {tpl.description && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{tpl.description}</Typography>}
                          <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }} title={tpl.CreatedAt ? new Date(tpl.CreatedAt).toLocaleString('zh-CN', { hour12: false }) : '-'}>
                            录入：{formatEntryTime(tpl.CreatedAt)}
                          </Typography>
                        </Box>
                        <Box display="flex" gap={0.5}>
                          <IconButton size="small" aria-label="编辑泵壳模板" sx={{ bgcolor: 'action.hover' }} onClick={() => openEditTpl(tpl)}><EditIcon size={16} /></IconButton>
                          <IconButton size="small" aria-label="删除泵壳模板" sx={{ bgcolor: 'error.main', color: 'white', '&:hover': { bgcolor: 'error.dark' } }} onClick={() => setTplDeleteId(tpl.Id)}><DeleteIcon size={16} /></IconButton>
                        </Box>
                      </Box>

                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 2 }}>
                        {tplParts.map((p, i) => (
                          <Box key={i} display="flex" alignItems="center" gap={1} sx={{ flexWrap: 'wrap' }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', width: 60, flexShrink: 0 }}>{p.name}</Typography>
                            <Chip label={p.model} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                            {p.qty > 1 && <Typography variant="caption" fontWeight={600} color="primary.main">×{p.qty}</Typography>}
                          </Box>
                        ))}
                      </Box>

                      {laborCost > 0 && (
                        <Box sx={{ bgcolor: 'rgba(124,58,237,0.04)', borderRadius: 2, p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" color="text.secondary">工时工资</Typography>
                          <Typography variant="body2" sx={{ color: 'warning.main', fontWeight: 700, fontFamily: 'monospace' }}>
                            ¥{laborCost.toFixed(2)}
                          </Typography>
                        </Box>
                      )}
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
