import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Paper, Typography, Alert, Box, CircularProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, Tooltip, Button, Dialog,
  DialogTitle, DialogContent, DialogContentText, DialogActions, Chip, TextField,
  Autocomplete, Collapse, FormControl, Select, MenuItem, Fade,
} from '@mui/material';
import {
  Info as InfoIcon, Delete as DeleteIcon, Refresh as RefreshIcon,
  Add as AddIcon, ContentCopy as CopyIcon, Edit as EditIcon,
  Save as SaveIcon, Close as CloseIcon, Inventory as TemplateIcon,
  ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';
import { Recipe, RecipePart, CostResult, PumpShellTemplate, TemplatePart } from '../types';
import { deleteRecipe, createTemplate, updateTemplate, deleteTemplate } from '../utils/api';
import { useAppStore } from '../utils/store';
import { buildPartsIndex, calculateRecipeCost } from '../utils/costCalculator';
import RecipeDetailModal from '../components/RecipeDetailModal';
import PageHeader from '../components/PageHeader';
import { gradients } from '../utils/theme';

// ── 模板编辑行 ──
interface PartFormRow { id: number; name: string; model: string; qty: number; supplier: string; }

// 配件名称→类别映射(用于过滤型号下拉) ── 常量，提到组件外避免重建
const NAME_TO_CATEGORY: Record<string, string> = {
  '花板轴承': '轴承', '油缸轴承': '轴承', '轴承': '轴承',
  '机械油封': '机封', '骨架油封': '密封件', '油封': '密封件',
  '皮垫': '密封件', 'O型圈': '密封件',
  '螺丝': '紧固件', '螺栓': '紧固件', '螺母': '紧固件',
  '叶轮': '叶轮', '电容': '电子件',
};

export default function RecipesPage() {
  const navigate = useNavigate();
  const nextRowId = useRef(1);
  const { recipes, parts, templates, fetchParts, fetchRecipes, fetchTemplates } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── 配方相关 ──
  const [selectedRecipe, setSelectedRecipe] = useState<{ recipe: Recipe; costResult: CostResult } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  // ── 模板相关 ──
  const [tplExpanded, setTplExpanded] = useState(true);
  const [tplDialogOpen, setTplDialogOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<PumpShellTemplate | null>(null);
  const [tplSaving, setTplSaving] = useState(false);
  const [tplDeleteId, setTplDeleteId] = useState<number | null>(null);
  const [shellModel, setShellModel] = useState('');
  const [shellSupplier, setShellSupplier] = useState('');
  const [tplDescription, setTplDescription] = useState('');
  const [partRows, setPartRows] = useState<PartFormRow[]>([]);

  // ── 数据加载 ──
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      await Promise.all([fetchRecipes(), fetchParts(), fetchTemplates()]);
      setError('');
    } catch { setError('加载数据失败'); }
    finally { setLoading(false); }
  }, [fetchRecipes, fetchParts, fetchTemplates]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── 零件型号去重列表 ──
  const uniqueModels = useMemo(() => {
    const set = new Set<string>();
    parts.forEach(p => { if (p.model) set.add(p.model); });
    return Array.from(set).sort();
  }, [parts]);


  const getPriceByModelAndSupplier = useCallback((model: string, supplier: string): number => {
    const m1 = (model || '').trim();
    const s1 = (supplier || '').trim();
    const exactPart = parts.find(p => p.model.trim() === m1 && p.supplier.trim() === s1);
    if (exactPart && s1) return exactPart.price;
    const modelParts = parts.filter(p => p.model.trim() === m1);
    if (modelParts.length > 0) return modelParts.reduce((min, c) => c.price < min.price ? c : min, modelParts[0]).price;
    return 0;
  }, [parts]);


  const getCategoryFromName = useCallback((name: string): string | null => {
    if (!name) return null;
    const n = name.trim();
    if (NAME_TO_CATEGORY[n]) return NAME_TO_CATEGORY[n];
    // 模糊匹配：名称包含关键词
    for (const [key, cat] of Object.entries(NAME_TO_CATEGORY)) {
      if (n.includes(key)) return cat;
    }
    return null;
  }, []);

  const getModelsByCategory = useCallback((category: string | null): string[] => {
    if (!category) return uniqueModels;
    const set = new Set<string>();
    parts.forEach(p => { if (p.category === category && p.model) set.add(p.model); });
    return Array.from(set).sort();
  }, [parts, uniqueModels]);

  const getSuppliersByModel = useCallback((model: string): string[] => {
    const suppliers = new Set<string>();
    parts.forEach(p => { if (p.model.trim() === model.trim() && p.supplier) suppliers.add(p.supplier); });
    return Array.from(suppliers).filter(Boolean).sort();
  }, [parts]);

  // ── 泵壳型号列表（从泵体/壳体/泵壳类别获取） ──
  const shellModels = useMemo(() => {
    const set = new Set<string>();
    parts.forEach(p => {
      if (['泵体', '壳体', '泵壳'].includes(p.category) && p.model) set.add(p.model);
    });
    return Array.from(set).sort();
  }, [parts]);

  // ── 模板 → 名称映射 ──
  const tplNameMap = useMemo(() => {
    const m = new Map<number, string>();
    templates.forEach(t => m.set(t.Id, t.shell_model));
    return m;
  }, [templates]);

  // ── 配方成本预算 ──
  const recipeData = useMemo(() => {
    if (parts.length === 0) return new Map<number, { overview: string; cost: string; costResult: CostResult }>();
    const { partsCache, partsByModel } = buildPartsIndex(parts);
    const map = new Map<number, { overview: string; cost: string; costResult: CostResult }>();
    for (const recipe of recipes) {
      let recipeParts: RecipePart[] = [];
      try { recipeParts = JSON.parse(recipe.parts_json); } catch { /* */ }
      const overview = recipeParts.map(p => `${p.model}×${p.qty}`).join(', ') || '-';
      const costResult = calculateRecipeCost(recipeParts, partsCache, partsByModel, recipe.saved_total_cost);
      map.set(recipe.Id, { overview, cost: `¥${costResult.totalCost}`, costResult });
    }
    return map;
  }, [recipes, parts]);

  // ══════════════════════════════════════
  //  配方操作
  // ══════════════════════════════════════
  const handleViewDetail = (recipe: Recipe) => {
    const data = recipeData.get(recipe.Id);
    if (data) setSelectedRecipe({ recipe, costResult: data.costResult });
  };

  const handleClone = (recipe: Recipe) => {
    navigate('/recipe-form', { state: { cloneFrom: {
      name: recipe.name + '-副本', spec: recipe.spec, partsJson: recipe.parts_json,
      template_id: recipe.template_id, coil_spec: recipe.coil_spec, coil_sheets: recipe.coil_sheets,
      has_float: recipe.has_float, float_wire: recipe.float_wire,
      has_cable: recipe.has_cable, cable_length: recipe.cable_length, cable_wire: recipe.cable_wire,
      box_type: recipe.box_type, extra_parts_json: recipe.extra_parts_json,
    }}});
  };

  const handleEdit = (recipe: Recipe) => {
    navigate('/recipe-form', { state: { editFrom: {
      id: recipe.Id, name: recipe.name, spec: recipe.spec, partsJson: recipe.parts_json,
      template_id: recipe.template_id, coil_spec: recipe.coil_spec, coil_sheets: recipe.coil_sheets,
      has_float: recipe.has_float, float_wire: recipe.float_wire,
      has_cable: recipe.has_cable, cable_length: recipe.cable_length, cable_wire: recipe.cable_wire,
      box_type: recipe.box_type, extra_parts_json: recipe.extra_parts_json,
    }}});
  };

  const confirmDeleteRecipe = async () => {
    if (deleteTarget === null) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    try { await deleteRecipe(id); await fetchRecipes(true); }
    catch { setError('删除失败'); }
  };

  // ══════════════════════════════════════
  //  模板操作
  // ══════════════════════════════════════
  const openCreateTpl = () => {
    setEditingTpl(null);
    setShellModel(''); setShellSupplier(''); setTplDescription('');
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
    try {
      const parsed: TemplatePart[] = JSON.parse(tpl.parts_json || '[]');
      setPartRows(parsed.map(p => ({ id: nextRowId.current++, name: p.name, model: p.model, qty: p.qty, supplier: p.supplier || '' })));
    } catch { setPartRows([]); }
    setTplDialogOpen(true);
  };

  const handleRowChange = (id: number, field: keyof Omit<PartFormRow, 'id'>, value: string | number) => {
    setPartRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, [field]: value };
      // 切换型号时清空供应商
      if (field === 'model') updated.supplier = '';
      return updated;
    }));
  };

  const handleSaveTpl = async () => {
    if (!shellModel.trim()) { setError('泵壳型号不能为空'); return; }
    const validRows = partRows.filter(r => r.model.trim());
    if (validRows.length === 0) { setError('至少需要一个配件'); return; }
    const pJson: TemplatePart[] = validRows.map(r => ({ name: r.name, model: r.model.trim(), qty: r.qty, supplier: r.supplier || '' }));
    setTplSaving(true);
    try {
      if (editingTpl) {
        await updateTemplate(editingTpl.Id, { shell_model: shellModel.trim(), description: tplDescription.trim(), parts_json: JSON.stringify(pJson) });
      } else {
        await createTemplate({ shell_model: shellModel.trim(), description: tplDescription.trim(), parts_json: JSON.stringify(pJson) });
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
      return p.reduce((sum, x) => sum + getPriceByModelAndSupplier(x.model, x.supplier || '') * x.qty, 0);
    } catch { return 0; }
  };

  // ══════════════════════════════════════
  //  渲染
  // ══════════════════════════════════════
  if (loading) {
    return <Box display="flex" justifyContent="center" py={8}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <PageHeader
        title="📝 配方管理"
        subtitle="管理泵壳模板与配方BOM"
        actions={
          <>
            <Tooltip title="刷新数据">
              <span>
                <IconButton onClick={loadData} disabled={loading}>
                  {loading ? <CircularProgress size={20} /> : <RefreshIcon />}
                </IconButton>
              </span>
            </Tooltip>
            <Button variant="contained" size="small" startIcon={<AddIcon />}
              onClick={() => navigate('/recipe-form')}
              sx={{ fontWeight: 700, boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)' }}>
              录入配方
            </Button>
          </>
        }
      />

      {/* KPI 统计 */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        {[
          { label: '模板数量', value: templates.length, sub: '泵壳配置模板', gradient: gradients.orders },
          { label: '配方数量', value: recipes.length, sub: '已录入配方', gradient: gradients.recipes },
          { label: '零件种类', value: parts.length, sub: '可选配件库', gradient: gradients.parts },
        ].map((item, idx) => (
          <Fade key={item.label} in timeout={400 + idx * 100}>
            <Paper elevation={0} sx={{
              p: 2, borderRadius: 3, flex: 1, position: 'relative', overflow: 'hidden',
              transition: 'all 0.25s',
              '&:hover': { transform: 'translateY(-3px)', boxShadow: '0 8px 24px rgba(0,0,0,0.07)' },
              '&::before': { content: '""', position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: item.gradient },
            }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}
                sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.68rem' }}>
                {item.label}
              </Typography>
              <Typography variant="h5" fontWeight={800} sx={{ letterSpacing: -0.5, mt: 0.3 }}>{item.value}</Typography>
              <Typography variant="caption" color="text.secondary">{item.sub}</Typography>
            </Paper>
          </Fade>
        ))}
      </Box>

      <Collapse in={!!error}>
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>{error}</Alert>
      </Collapse>

      {/* ━━━━━━━━━━━━━━━━━━ 泵壳模板区 ━━━━━━━━━━━━━━━━━━ */}
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
                      <Box display="flex" justifyContent="flex-end" mt={0.5}>
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

      {/* ━━━━━━━━━━━━━━━━━━ 配方列表区 ━━━━━━━━━━━━━━━━━━ */}
      <Paper elevation={0} sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
          <TemplateIcon sx={{ mr: 1, color: 'success.main' }} />
          <Typography variant="h6" fontWeight={700} color="success.main" sx={{ flexGrow: 1 }}>配方列表</Typography>
          <Chip label={`共 ${recipes.length} 个`} size="small" variant="outlined" sx={{ fontWeight: 600 }} />
        </Box>

        {recipes.length === 0 ? (
          <Box textAlign="center" py={6} color="text.secondary">
            <Typography variant="body2">暂无配方数据，点击右上角录入</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
                  <TableCell>配方名称</TableCell>
                  <TableCell>规格</TableCell>
                  <TableCell>泵壳模板</TableCell>
                  <TableCell>配件概览</TableCell>
                  <TableCell>总成本</TableCell>
                  <TableCell align="center" sx={{ width: '200px' }}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recipes.map((recipe) => {
                  const data = recipeData.get(recipe.Id);
                  const tplName = recipe.template_id ? tplNameMap.get(recipe.template_id) || '-' : '-';
                  return (
                    <TableRow key={recipe.Id} hover sx={{ cursor: 'pointer' }} onDoubleClick={() => handleViewDetail(recipe)}>
                      <TableCell>{recipe.name}</TableCell>
                      <TableCell>{recipe.spec || '-'}</TableCell>
                      <TableCell>
                        {tplName !== '-' ? (
                          <Chip label={tplName} size="small" variant="outlined"
                            sx={{ height: 22, fontSize: '0.7rem', borderColor: '#a855f7', color: '#7c3aed' }} />
                        ) : '-'}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={data?.overview || '-'}>
                        {data?.overview || '-'}
                      </TableCell>
                      <TableCell>{data?.cost || '-'}</TableCell>
                      <TableCell align="center">
                        <Tooltip title="详情"><IconButton size="small" color="info" onClick={() => handleViewDetail(recipe)}><InfoIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="编辑"><IconButton size="small" color="warning" onClick={() => handleEdit(recipe)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="复制"><IconButton size="small" color="primary" onClick={() => handleClone(recipe)}><CopyIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="删除"><IconButton size="small" color="error" onClick={() => setDeleteTarget(recipe.Id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* ── 配方详情弹窗 ── */}
      {selectedRecipe && (
        <RecipeDetailModal recipe={selectedRecipe.recipe} costResult={selectedRecipe.costResult}
          parts={parts} onClose={() => setSelectedRecipe(null)} onStockUpdated={loadData} />
      )}

      {/* ── 配方删除确认 ── */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>删除配方</DialogTitle>
        <DialogContent><DialogContentText>确定要删除这个配方吗？此操作不可撤销。</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button onClick={confirmDeleteRecipe} color="error" variant="contained">删除</Button>
        </DialogActions>
      </Dialog>

      {/* ── 模板编辑对话框 ── */}
      <Dialog open={tplDialogOpen} onClose={() => setTplDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {editingTpl ? `编辑模板 — ${editingTpl.shell_model}` : '新建泵壳模板'}
          <IconButton onClick={() => setTplDialogOpen(false)}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent>
          <Box display="flex" gap={2} mb={2} mt={1}>
            <Autocomplete
              freeSolo
              disableClearable
              options={shellModels}
              value={shellModel}
              onChange={(_e, v) => { setShellModel(v || ''); setShellSupplier(''); }}
              onInputChange={(_e, v) => { setShellModel(v || ''); }}
              sx={{ flex: 1 }}
              renderInput={(params) => (
                <TextField {...params} label="泵壳型号" placeholder="搜索或输入泵壳型号"
                  required size="small" />
              )}
            />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <Select
                value={shellSupplier}
                onChange={e => setShellSupplier(e.target.value)}
                displayEmpty
                sx={{ fontSize: '0.85rem' }}
              >
                <MenuItem value="">
                  <em style={{ fontSize: '0.8rem', color: '#aaa' }}>泵壳供应商</em>
                </MenuItem>
                {(shellModel ? getSuppliersByModel(shellModel) : (() => {
                  const s = new Set<string>();
                  parts.forEach(p => {
                    if (['泵体', '壳体', '泵壳'].includes(p.category) && p.supplier) s.add(p.supplier);
                  });
                  if (s.size === 0) parts.forEach(p => { if (p.supplier) s.add(p.supplier); });
                  return Array.from(s).sort();
                })()).map(s => (
                  <MenuItem key={s} value={s} sx={{ fontSize: '0.85rem' }}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField label="描述(可选)" value={tplDescription} onChange={e => setTplDescription(e.target.value)}
              placeholder="如 V750标准配件包" size="small" sx={{ flex: 2 }} />
          </Box>

          <Typography variant="subtitle2" fontWeight={700} mb={1} color="text.secondary">
            固定配件清单（填写型号、供应商和数量，价格从零件表自动拉取）
          </Typography>

          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', width: 100 }}>配件名称</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>型号</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', minWidth: 120 }}>供应商</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', width: 60 }}>数量</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', width: 80, textAlign: 'right' }}>实时单价</TableCell>
                <TableCell sx={{ width: 40 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {partRows.map(row => {
                const rowCat = getCategoryFromName(row.name);
                const filteredModels = getModelsByCategory(rowCat);
                const rowSuppliers = row.model ? getSuppliersByModel(row.model) : [];
                const price = row.model ? getPriceByModelAndSupplier(row.model, row.supplier) : 0;
                return (
                  <TableRow key={row.id}>
                    <TableCell sx={{ py: 0.5 }}>
                      <TextField size="small" fullWidth value={row.name}
                        onChange={e => handleRowChange(row.id, 'name', e.target.value)}
                        placeholder="如 花板轴承" variant="standard"
                        inputProps={{ style: { fontSize: '0.85rem' } }} />
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <Autocomplete freeSolo disableClearable options={filteredModels} value={row.model}
                        onChange={(_e, v) => handleRowChange(row.id, 'model', v || '')}
                        onInputChange={(_e, v) => handleRowChange(row.id, 'model', v || '')}
                        renderInput={(params) => (
                          <TextField {...params} size="small" fullWidth
                            placeholder={rowCat ? `搜索${rowCat}型号` : '搜索或输入型号'}
                            variant="standard"
                            inputProps={{ ...params.inputProps, style: { fontSize: '0.85rem' } }} />
                        )}
                        sx={{ minWidth: 120 }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <FormControl fullWidth size="small" disabled={!row.model || rowSuppliers.length === 0}>
                        <Select
                          value={row.supplier}
                          onChange={e => handleRowChange(row.id, 'supplier', e.target.value)}
                          displayEmpty
                          variant="standard"
                          sx={{ fontSize: '0.85rem' }}
                        >
                          <MenuItem value="">
                            <em style={{ fontSize: '0.75rem', color: '#aaa' }}>{rowSuppliers.length === 0 ? '—' : '选择供应商'}</em>
                          </MenuItem>
                          {rowSuppliers.map(s => (
                            <MenuItem key={s} value={s} sx={{ fontSize: '0.85rem' }}>{s}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
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
                      <IconButton size="small" color="error" onClick={() => setPartRows(prev => prev.filter(r => r.id !== row.id))}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Button size="small" startIcon={<AddIcon />}
            onClick={() => setPartRows(prev => [...prev, { id: nextRowId.current++, name: '', model: '', qty: 1, supplier: '' }])}
            sx={{ mt: 1 }}>
            添加配件行
          </Button>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setTplDialogOpen(false)}>取消</Button>
          <Button variant="contained" startIcon={tplSaving ? <CircularProgress size={16} /> : <SaveIcon />}
            onClick={handleSaveTpl} disabled={tplSaving || !shellModel.trim()}>
            {editingTpl ? '更新' : '创建'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── 模板删除确认 ── */}
      <Dialog open={tplDeleteId !== null} onClose={() => setTplDeleteId(null)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent><Typography>确定要删除此泵壳模板吗？如果有配方引用此模板将无法删除。</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setTplDeleteId(null)}>取消</Button>
          <Button color="error" variant="contained" onClick={confirmDeleteTpl}>确认删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
