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
    { id: nextRowId.current++, name: '鑺辨澘杞存壙', model: '', qty: 1, supplier: '' },
    { id: nextRowId.current++, name: '娌圭几杞存壙', model: '', qty: 1, supplier: '' },
    { id: nextRowId.current++, name: '鏈烘娌瑰皝', model: '', qty: 1, supplier: '' },
    { id: nextRowId.current++, name: '楠ㄦ灦娌瑰皝', model: '', qty: 1, supplier: '' },
  ];
}

function defaultShellComponentRows(nextRowId: React.MutableRefObject<number>): ShellComponentFormRow[] {
  return ['涓婂附', '鏈虹瓛', '鑺辨澘', '娌圭几', '娉靛ご', '鍙惰疆', '搴曞骇', '娉曞叞'].map(name => ({
    id: nextRowId.current++,
    name,
    model: '',
    qty: name === '鏈虹瓛' ? 15 : 1,
    unitCost: 0,
    pricingMode: name === '鏈虹瓛' ? 'lengthCm' : 'fixed',
    included: name !== '娉曞叞',
    optional: name === '娉曞叞',
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

  // 鈹€鈹€ 娉靛３鍨嬪彿鍒楄〃 鈹€鈹€
  const shellModels = useMemo(() => {
    const set = new Set<string>();
    parts.forEach(p => { 
      if (['娉典綋', '澹充綋', '娉靛３'].includes(p.category) && p.model) {
        set.add(p.model);
      }
    });
    return Array.from(set).sort();
  }, [parts]);

  // 鈹€鈹€ 闆朵欢鍨嬪彿鍘婚噸鍒楄〃 鈹€鈹€
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
    if (!modelStr) { setError('娉靛３鍨嬪彿涓嶈兘涓虹┖'); return; }

    // 闃叉閲嶅鍒涘缓妯℃澘锛堝鎴风鏍￠獙锛?
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
      setError('缁勪欢鏄庣粏妯″紡鑷冲皯闇€瑕佷竴涓鍏ユ垚鏈殑娉靛３缁勪欢');
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
    } catch (err) { setError(err instanceof Error ? err.message : '淇濆瓨澶辫触'); }
    finally { setTplSaving(false); }
  };

  const confirmDeleteTpl = async () => {
    if (tplDeleteId === null) return;
    try { await deleteTemplate(tplDeleteId); setTplDeleteId(null); await fetchTemplates(true); }
    catch (err) { setError(err instanceof Error ? err.message : '鍒犻櫎澶辫触'); setTplDeleteId(null); }
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
            娉靛３妯℃澘
          </Typography>
          <Chip label={`${templates.length} 套`} size="small" sx={{ mr: 1, fontWeight: 600, fontSize: '0.7rem' }} />
          <Button
            variant="text" size="small" startIcon={<AddIcon size={18} />}
            onClick={(e) => { e.stopPropagation(); openCreateTpl(); }}
            sx={{ mr: 1, fontSize: '0.75rem', color: '#7c3aed' }}
          >
            鏂板缓
          </Button>
          {tplExpanded ? <ExpandLessIcon size={20} color="#9ca3af" /> : <ExpandMoreIcon size={20} color="#9ca3af" />}
        </Box>

        <Collapse in={tplExpanded}>
          <Box sx={{ p: 2 }}>
            {templates.length === 0 ? (
              <Box textAlign="center" py={3} color="text.disabled">
                <Typography variant="body2">杩樻病鏈夋车澹虫ā鏉匡紝鐐瑰嚮涓婃柟"鏂板缓"鍒涘缓</Typography>
              </Box>
            ) : (
              <>
                <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <TextField
                    value={tplQuery}
                    onChange={(e) => setTplQuery(e.target.value)}
                    placeholder="鎼滅储鍨嬪彿 / 鎻忚堪 / 閰嶄欢"
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
                          <TableCell sx={{ width: 150 }}>鍨嬪彿</TableCell>
                          <TableCell sx={{ minWidth: 160 }}>璇存槑</TableCell>
                          <TableCell sx={{ width: 120 }}>褰曞叆鏃堕棿</TableCell>
                          <TableCell>娉靛３鎴愭湰</TableCell>
                          <TableCell>鍥哄畾閰嶄欢</TableCell>
                          <TableCell align="right" sx={{ width: 96 }}>宸ユ椂宸ヨ祫</TableCell>
                          <TableCell align="center" sx={{ width: 96 }}>鎿嶄綔</TableCell>
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
                                  label={`${costMode === 'bundle' ? '鏁村' : '缁勪欢'} 楼${shellCost.toFixed(2)}`}
                                  size="small"
                                  color={costMode === 'bundle' ? 'primary' : 'success'}
                                  sx={{ height: 22, fontSize: '0.72rem' }}
                                />
                                {costMode === 'components' && shellComponents.slice(0, 3).map((c, i) => (
                                  <Chip
                                    key={`${c.name}-${i}`}
                                    label={`${c.name} 楼${Number(c.unitCost || 0).toFixed(2)}${c.pricingMode === 'lengthCm' ? '/cm' : ''}`}
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
                                  <Tooltip key={`${p.name}-${p.model}-${i}`} title={`${p.name}${p.qty > 1 ? ` 脳${p.qty}` : ''}`}>
                                    <Chip
                                      label={`${p.name} ${p.model}${p.qty > 1 ? ` 脳${p.qty}` : ''}`}
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
                                  楼{laborCost.toFixed(2)}
                                </Typography>
                              ) : (
                                <Typography variant="body2" color="text.disabled">-</Typography>
                              )}
                            </TableCell>
                            <TableCell align="center">
                              <Tooltip title="缂栬緫">
                                <IconButton size="small" aria-label="缂栬緫娉靛３妯℃澘" color="warning" onClick={() => openEditTpl(tpl)}>
                                  <EditIcon size={16} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="鍒犻櫎">
                                <IconButton size="small" aria-label="鍒犻櫎娉靛３妯℃澘" color="error" onClick={() => setTplDeleteId(tpl.Id)}>
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

      {/* 妯℃澘缂栬緫瀵硅瘽妗?*/}
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

      {/* 妯℃澘鍒犻櫎纭 */}
      <Dialog open={tplDeleteId !== null} onClose={() => setTplDeleteId(null)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent><Typography>确定要删除此泵壳模板吗？如果有配方引用此模板将无法删除。</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setTplDeleteId(null)}>鍙栨秷</Button>
          <Button color="error" variant="contained" onClick={confirmDeleteTpl}>纭鍒犻櫎</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
