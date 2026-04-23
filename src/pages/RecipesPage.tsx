import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Paper, Typography, Alert, Box, CircularProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, Tooltip, Button, Dialog,
  DialogTitle, DialogContent, DialogContentText, DialogActions, Chip, Collapse,
  useMediaQuery, useTheme
} from '@mui/material';
import {
  Info as InfoIcon, Trash2 as DeleteIcon, RefreshCw as RefreshIcon,
  Plus as AddIcon, Copy as CopyIcon, Edit3 as EditIcon,
  Package as TemplateIcon, FileText as FileIcon, ScrollText as RecipeIcon, Wrench as PartIcon,
} from 'lucide-react';
import { Recipe, RecipePart, CostResult } from '../types';
import { deleteRecipe } from '../utils/api';
import { useAppStore } from '../utils/store';
import { buildPartsIndex, calculateRecipeCost } from '../utils/costCalculator';
import RecipeDetailModal from '../components/RecipeDetailModal';
import TemplateSection from '../components/TemplateSection';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { colors, gradients } from '../utils/theme';

export default function RecipesPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const { recipes, parts, templates, fetchParts, fetchRecipes, fetchTemplates, showSnackbar } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState<{ recipe: Recipe; costResult: CostResult } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

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

  // ── 模板名称映射 ──
  const tplNameMap = useMemo(() => {
    const m = new Map<number, string>();
    templates.forEach(t => m.set(t.Id, t.shell_model));
    return m;
  }, [templates]);

  // ── 配方成本 ──
  const recipeData = useMemo(() => {
    if (parts.length === 0) return new Map<number, { overview: string; cost: string; costResult: CostResult }>();
    const { partsCache, partsByModel } = buildPartsIndex(parts);
    const map = new Map<number, { overview: string; cost: string; costResult: CostResult }>();
    for (const recipe of recipes) {
      let recipeParts: RecipePart[] = [];
      try { recipeParts = JSON.parse(recipe.parts_json); } catch { /* */ }
      const validParts = recipeParts.filter(p => p && p.model);
      const overview = validParts.length > 0
        ? validParts.map(p => `${p.model}×${p.qty ?? 1}`).join(', ')
        : '-';
      const costResult = calculateRecipeCost(validParts, partsCache, partsByModel, recipe.saved_total_cost);
      const costNum = parseFloat(costResult.totalCost);
      map.set(recipe.Id, {
        overview,
        cost: isNaN(costNum) ? '¥0.00' : `¥${costResult.totalCost}`,
        costResult,
      });
    }
    return map;
  }, [recipes, parts]);

  // ── 配方操作 ──
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
      assembly_wage: recipe.assembly_wage, packing_wage: recipe.packing_wage, painting_wage: recipe.painting_wage,
      management_fee: recipe.management_fee,
    }}});
  };

  const handleEdit = (recipe: Recipe) => {
    navigate('/recipe-form', { state: { editFrom: {
      id: recipe.Id, name: recipe.name, spec: recipe.spec, partsJson: recipe.parts_json,
      template_id: recipe.template_id, coil_spec: recipe.coil_spec, coil_sheets: recipe.coil_sheets,
      has_float: recipe.has_float, float_wire: recipe.float_wire,
      has_cable: recipe.has_cable, cable_length: recipe.cable_length, cable_wire: recipe.cable_wire,
      box_type: recipe.box_type, extra_parts_json: recipe.extra_parts_json,
      assembly_wage: recipe.assembly_wage, packing_wage: recipe.packing_wage, painting_wage: recipe.painting_wage,
      management_fee: recipe.management_fee,
    }}});
  };

  const confirmDeleteRecipe = async () => {
    if (deleteTarget === null) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    try { await deleteRecipe(id); await fetchRecipes(true); showSnackbar('配方已删除', 'info'); }
    catch { setError('删除失败'); }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" py={8}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <PageHeader
        title="配方管理"
        subtitle="管理泵壳模板与配方BOM"
        actions={
          <>
            <Tooltip title="刷新数据">
              <span>
                <IconButton onClick={loadData} disabled={loading}>
                  {loading ? <CircularProgress size={20} /> : <RefreshIcon size={20} />}
                </IconButton>
              </span>
            </Tooltip>
            <Button variant="contained" size="small" startIcon={<AddIcon size={18} />}
              onClick={() => navigate('/recipe-form')}
              sx={{ fontWeight: 700, boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)' }}>
              录入配方
            </Button>
          </>
        }
      />

      {/* KPI 统计 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2, mb: 3 }}>
        <StatCard label="模板数量" value={templates.length} subtitle="泵壳配置模板" icon={<FileIcon size={22} />} gradient={gradients.orders} delay={0} />
        <StatCard label="配方数量" value={recipes.length} subtitle="已录入配方" icon={<RecipeIcon size={22} />} gradient={gradients.recipes} delay={1} />
        <StatCard label="零件种类" value={parts.length} subtitle="可选配件库" icon={<PartIcon size={22} />} gradient={gradients.parts} delay={2} />
      </Box>

      <Collapse in={!!error}>
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>{error}</Alert>
      </Collapse>

      {/* ━━━ 泵壳模板区（子组件） ━━━ */}
      <TemplateSection templates={templates} parts={parts} fetchTemplates={fetchTemplates} setError={setError} />

      {/* ━━━ 配方列表区 ━━━ */}
      <Paper elevation={0} sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
          <TemplateIcon size={24} style={{ marginRight: 8 }} color="rgba(34,197,94,1)" />
          <Typography variant="h6" fontWeight={700} color="success.main" sx={{ flexGrow: 1 }}>配方列表</Typography>
          <Chip label={`共 ${recipes.length} 个`} size="small" variant="outlined" sx={{ fontWeight: 600 }} />
        </Box>

        {recipes.length === 0 ? (
          <Box textAlign="center" py={6} color="text.secondary">
            <Typography variant="body2">暂无配方数据，点击右上角录入</Typography>
          </Box>
        ) : isMobile ? (
          <Box p={2}>
            {recipes.map((recipe) => {
              const data = recipeData.get(recipe.Id);
              const tplName = recipe.template_id ? tplNameMap.get(recipe.template_id) || '-' : '-';
              return (
                <Paper
                  key={recipe.Id}
                  onClick={() => handleViewDetail(recipe)}
                  elevation={0}
                  sx={{ p: 2, mb: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', cursor: 'pointer' }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography fontWeight={700}>{recipe.name}</Typography>
                    {tplName !== '-' && (
                      <Chip label={tplName} size="small" variant="outlined"
                        sx={{ height: 22, fontSize: '0.7rem', borderColor: colors.purple.border, color: colors.purple.main }} />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
                    {recipe.spec || '无规格'}
                  </Typography>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5}>
                    <Typography variant="body2" color="text.secondary">总成本</Typography>
                    <Typography variant="body2" fontWeight={700} color="primary.main">{data?.cost || '-'}</Typography>
                  </Box>
                  <Box display="flex" justifyContent="flex-end" gap={0.5}>
                    <IconButton size="small" color="warning" onClick={(e) => { e.stopPropagation(); handleEdit(recipe); }}><EditIcon size={18} /></IconButton>
                    <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); handleClone(recipe); }}><CopyIcon size={18} /></IconButton>
                    <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); setDeleteTarget(recipe.Id); }}><DeleteIcon size={18} /></IconButton>
                  </Box>
                </Paper>
              );
            })}
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
                            sx={{ height: 22, fontSize: '0.7rem', borderColor: colors.purple.border, color: colors.purple.main }} />
                        ) : '-'}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={data?.overview || '-'}>
                        {data?.overview || '-'}
                      </TableCell>
                      <TableCell>{data?.cost || '-'}</TableCell>
                      <TableCell align="center">
                        <Tooltip title="详情"><IconButton size="small" color="info" onClick={() => handleViewDetail(recipe)}><InfoIcon size={18} /></IconButton></Tooltip>
                        <Tooltip title="编辑"><IconButton size="small" color="warning" onClick={() => handleEdit(recipe)}><EditIcon size={18} /></IconButton></Tooltip>
                        <Tooltip title="复制"><IconButton size="small" color="primary" onClick={() => handleClone(recipe)}><CopyIcon size={18} /></IconButton></Tooltip>
                        <Tooltip title="删除"><IconButton size="small" color="error" onClick={() => setDeleteTarget(recipe.Id)}><DeleteIcon size={18} /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* 配方详情弹窗 */}
      {selectedRecipe && (
        <RecipeDetailModal recipe={selectedRecipe.recipe} costResult={selectedRecipe.costResult}
          parts={parts} onClose={() => setSelectedRecipe(null)} onStockUpdated={loadData} />
      )}

      {/* 配方删除确认 */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>删除配方</DialogTitle>
        <DialogContent><DialogContentText>确定要删除这个配方吗？此操作不可撤销。</DialogContentText></DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button onClick={confirmDeleteRecipe} color="error" variant="contained">删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
