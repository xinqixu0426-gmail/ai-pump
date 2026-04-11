import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Paper, Typography, Alert, Box, CircularProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, Tooltip, Button, Dialog,
  DialogTitle, DialogContent, DialogContentText, DialogActions, Chip, Collapse, Fade,
} from '@mui/material';
import {
  Info as InfoIcon, Delete as DeleteIcon, Refresh as RefreshIcon,
  Add as AddIcon, ContentCopy as CopyIcon, Edit as EditIcon,
  Inventory as TemplateIcon,
} from '@mui/icons-material';
import { Recipe, RecipePart, CostResult } from '../types';
import { deleteRecipe } from '../utils/api';
import { useAppStore } from '../utils/store';
import { buildPartsIndex, calculateRecipeCost } from '../utils/costCalculator';
import RecipeDetailModal from '../components/RecipeDetailModal';
import TemplateSection from '../components/TemplateSection';
import PageHeader from '../components/PageHeader';
import { gradients } from '../utils/theme';

export default function RecipesPage() {
  const navigate = useNavigate();
  const { recipes, parts, templates, fetchParts, fetchRecipes, fetchTemplates } = useAppStore();
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
      const overview = recipeParts.map(p => `${p.model}×${p.qty}`).join(', ') || '-';
      const costResult = calculateRecipeCost(recipeParts, partsCache, partsByModel, recipe.saved_total_cost);
      map.set(recipe.Id, { overview, cost: `¥${costResult.totalCost}`, costResult });
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
    }}});
  };

  const confirmDeleteRecipe = async () => {
    if (deleteTarget === null) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    try { await deleteRecipe(id); await fetchRecipes(true); }
    catch { setError('删除失败'); }
  };

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

      {/* ━━━ 泵壳模板区（子组件） ━━━ */}
      <TemplateSection templates={templates} parts={parts} fetchTemplates={fetchTemplates} setError={setError} />

      {/* ━━━ 配方列表区 ━━━ */}
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
          <Button onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button onClick={confirmDeleteRecipe} color="error" variant="contained">删除</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
