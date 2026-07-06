import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Paper, Typography, Alert, Box, CircularProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, Tooltip, Button, Dialog,
  DialogTitle, DialogContent, DialogContentText, DialogActions, Chip, Collapse,
  Tab, Tabs, useMediaQuery, useTheme
} from '@mui/material';
import {
  Info as InfoIcon, Trash2 as DeleteIcon, RefreshCw as RefreshIcon,
  Plus as AddIcon, Copy as CopyIcon, Edit3 as EditIcon,
  Package as TemplateIcon, FileText as FileIcon, ScrollText as RecipeIcon, Wrench as PartIcon,
} from 'lucide-react';
import { PumpModelVariant, Recipe, CostResult } from '../types';
import { deleteRecipe, calculateCost, getAllModelVariants, getCopperPrice } from '../utils/api';
import { useAppStore } from '../utils/store';
import { buildRecipeListData, formatRecipeEntryTime, RecipeCopperRisk, RecipeListData } from '../utils/recipeListRules';
import RecipeDetailModal from '../components/RecipeDetailModal';
import TemplateSection from '../components/TemplateSection';
import ModelVariantSection from '../components/ModelVariantSection';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { colors, gradients } from '../utils/theme';

function copperRiskStyle(level: RecipeCopperRisk['level']) {
  if (level === 'critical') return { color: '#b91c1c', borderColor: '#fca5a5', bgcolor: '#fef2f2' };
  if (level === 'review') return { color: '#c2410c', borderColor: '#fdba74', bgcolor: '#fff7ed' };
  if (level === 'watch') return { color: '#a16207', borderColor: '#fde68a', bgcolor: '#fefce8' };
  if (level === 'missing') return { color: '#64748b', borderColor: '#cbd5e1', bgcolor: '#f8fafc' };
  return { color: '#047857', borderColor: '#a7f3d0', bgcolor: '#ecfdf5' };
}

function CopperRiskChip({ risk }: { risk?: RecipeCopperRisk }) {
  if (!risk) return <Typography variant="body2" color="text.disabled">-</Typography>;

  const title = [
    risk.detail,
    risk.savedCopperPricePerKg ? `保存铜价：¥${(risk.savedCopperPricePerKg * 1000).toLocaleString('zh-CN')}/吨` : '',
    risk.currentCopperPricePerKg ? `当前铜价：¥${(risk.currentCopperPricePerKg * 1000).toLocaleString('zh-CN')}/吨` : '',
  ].filter(Boolean).join('\n');

  return (
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{title}</Box>}>
      <Chip
        label={risk.label}
        size="small"
        variant="outlined"
        sx={{ ...copperRiskStyle(risk.level), fontWeight: 700, maxWidth: 240 }}
      />
    </Tooltip>
  );
}

export default function RecipesPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const location = useLocation();
  const navigationState = location.state as { openRecipeId?: number } | null;
  const consumedNavigationRef = useRef<string | null>(null);
  const { recipes, parts, templates, fetchParts, fetchRecipes, fetchTemplates, showSnackbar } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState<{ recipe: Recipe; costResult: CostResult } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'recipes' | 'templates' | 'variants'>('recipes');
  const [variants, setVariants] = useState<PumpModelVariant[]>([]);

  // P1-4: 配方成本改用后端 API，消除前后端双写
  const [recipeData, setRecipeData] = useState<Map<number, RecipeListData>>(new Map());
  const [currentCopperPricePerKg, setCurrentCopperPricePerKg] = useState<number | null>(null);

  // ── 数据加载 ──
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [, , , variantData, copperPrice] = await Promise.all([
        fetchRecipes(),
        fetchParts(),
        fetchTemplates(),
        getAllModelVariants(),
        getCopperPrice().catch(() => null),
      ]);
      setVariants(variantData);
      const dbCopper = Number(copperPrice?.dbPrice || 0);
      const liveCopper = Number(copperPrice?.livePricePerKg || 0);
      setCurrentCopperPricePerKg(dbCopper > 0 ? dbCopper : (liveCopper > 0 ? liveCopper : null));
      setError('');
    } catch { setError('加载数据失败'); }
    finally { setLoading(false); }
  }, [fetchRecipes, fetchParts, fetchTemplates]);

  const reloadVariants = useCallback(async () => {
    setVariants(await getAllModelVariants());
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── 模板名称映射 ──
  const tplNameMap = useMemo(() => {
    const m = new Map<number, string>();
    templates.forEach(t => m.set(t.Id, t.shellModel));
    return m;
  }, [templates]);

  // ── 配方成本（后端批量计算） ──
  useEffect(() => {
    if (recipes.length === 0) { setRecipeData(new Map()); return; }
    let cancelled = false;
    (async () => {
      const map = new Map<number, RecipeListData>();
      for (const recipe of recipes) {
        map.set(recipe.Id, await buildRecipeListData(recipe, calculateCost, currentCopperPricePerKg));
      }
      if (!cancelled) setRecipeData(map);
    })();
    return () => { cancelled = true; };
  }, [recipes, currentCopperPricePerKg]);

  // ── 配方操作 ──
  useEffect(() => {
    if (!navigationState?.openRecipeId || consumedNavigationRef.current === location.key) return;
    const target = recipes.find(recipe => recipe.Id === Number(navigationState.openRecipeId));
    const data = target ? recipeData.get(target.Id) : null;
    if (!target || !data) return;

    setSelectedRecipe({ recipe: target, costResult: data.costResult });
    consumedNavigationRef.current = location.key;
    navigate(location.pathname, { replace: true, state: null });
  }, [navigationState?.openRecipeId, recipes, recipeData, location.key, location.pathname, navigate]);

  const handleViewDetail = (recipe: Recipe) => {
    const data = recipeData.get(recipe.Id);
    if (data) setSelectedRecipe({ recipe, costResult: data.costResult });
  };

  const handleClone = (recipe: Recipe) => {
    navigate('/recipe-form', { state: { cloneFrom: {
      name: recipe.name + '-副本', spec: recipe.spec, partsJson: recipe.partsJson,
      templateId: recipe.templateId, coilSpec: recipe.coilSpec, coilSheets: recipe.coilSheets, coilMaterial: recipe.coilMaterial,
      hasFloat: recipe.hasFloat, floatWire: recipe.floatWire, floatAccessoryType: recipe.floatAccessoryType,
      hasCable: recipe.hasCable, cableLength: recipe.cableLength, cableWire: recipe.cableWire, cableAccessoryType: recipe.cableAccessoryType,
      boxType: recipe.boxType, extraPartsJson: recipe.extraPartsJson, packingPartsJson: recipe.packingPartsJson,
      modelVariantId: recipe.modelVariantId,
      customBarrelLength: recipe.customBarrelLength,
      impellerModel: recipe.impellerModel,
      impellerThickness: recipe.impellerThickness,
      impellerDiameter: recipe.impellerDiameter,
      impellerBladeCount: recipe.impellerBladeCount,
      technicalDataJson: recipe.technicalDataJson,
      assemblyWage: recipe.assemblyWage, packingWage: recipe.packingWage, paintingWage: recipe.paintingWage,
      surfaceTreatmentMode: recipe.surfaceTreatmentMode,
      surfaceTreatmentCost: recipe.surfaceTreatmentCost,
      managementFee: recipe.managementFee,
    }}});
  };

  const handleEdit = (recipe: Recipe) => {
    navigate('/recipe-form', { state: { editFrom: {
      Id: recipe.Id, name: recipe.name, spec: recipe.spec, partsJson: recipe.partsJson,
      templateId: recipe.templateId, coilSpec: recipe.coilSpec, coilSheets: recipe.coilSheets, coilMaterial: recipe.coilMaterial,
      hasFloat: recipe.hasFloat, floatWire: recipe.floatWire, floatAccessoryType: recipe.floatAccessoryType,
      hasCable: recipe.hasCable, cableLength: recipe.cableLength, cableWire: recipe.cableWire, cableAccessoryType: recipe.cableAccessoryType,
      boxType: recipe.boxType, extraPartsJson: recipe.extraPartsJson, packingPartsJson: recipe.packingPartsJson,
      assemblyWage: recipe.assemblyWage, packingWage: recipe.packingWage, paintingWage: recipe.paintingWage,
      surfaceTreatmentMode: recipe.surfaceTreatmentMode,
      surfaceTreatmentCost: recipe.surfaceTreatmentCost,
      managementFee: recipe.managementFee,
      customBarrelLength: recipe.customBarrelLength,
      modelVariantId: recipe.modelVariantId,
      impellerModel: recipe.impellerModel,
      impellerThickness: recipe.impellerThickness,
      impellerDiameter: recipe.impellerDiameter,
      impellerBladeCount: recipe.impellerBladeCount,
      technicalDataJson: recipe.technicalDataJson,
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
        subtitle="管理泵壳模板、常用配置与客户配方"
        actions={
          <>
            <Tooltip title="刷新数据">
              <span>
                <IconButton aria-label="刷新数据" onClick={loadData} disabled={loading}>
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
        <StatCard label="常用配置" value={variants.length} subtitle="模板+线圈参数预设" icon={<RecipeIcon size={22} />} gradient={gradients.recipes} delay={1} />
        <StatCard label="零件种类" value={parts.length} subtitle="可选配件库" icon={<PartIcon size={22} />} gradient={gradients.parts} delay={2} />
      </Box>

      <Collapse in={!!error}>
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>{error}</Alert>
      </Collapse>

      <Paper elevation={0} sx={{ mb: 2, borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <Tabs
          value={activeTab}
          onChange={(_, value) => setActiveTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 1, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Tab value="templates" label={`泵壳模板 (${templates.length})`} />
          <Tab value="variants" label={`常用配置 (${variants.length})`} />
          <Tab value="recipes" label={`配方列表 (${recipes.length})`} />
        </Tabs>
      </Paper>

      {activeTab === 'templates' && (
        <TemplateSection templates={templates} parts={parts} fetchTemplates={fetchTemplates} setError={setError} />
      )}

      {activeTab === 'variants' && (
        <ModelVariantSection variants={variants} templates={templates} reload={reloadVariants} setError={setError} />
      )}

      {activeTab === 'recipes' && (
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
              const tplName = recipe.templateId ? tplNameMap.get(recipe.templateId) || '-' : '-';
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
                  <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
                    录入时间：{formatRecipeEntryTime(recipe.CreatedAt)}
                  </Typography>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5}>
                    <Typography variant="body2" color="text.secondary">总成本</Typography>
                    <Typography variant="body2" fontWeight={700} color="primary.main">{data?.cost || '-'}</Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5}>
                    <Typography variant="body2" color="text.secondary">铜价预警</Typography>
                    <CopperRiskChip risk={data?.copperRisk} />
                  </Box>
                  <Box display="flex" justifyContent="flex-end" gap={0.5}>
                    <IconButton size="small" color="warning" aria-label="编辑配方" onClick={(e) => { e.stopPropagation(); handleEdit(recipe); }}><EditIcon size={18} /></IconButton>
                    <IconButton size="small" color="primary" aria-label="复制配方" onClick={(e) => { e.stopPropagation(); handleClone(recipe); }}><CopyIcon size={18} /></IconButton>
                    <IconButton size="small" color="error" aria-label="删除配方" onClick={(e) => { e.stopPropagation(); setDeleteTarget(recipe.Id); }}><DeleteIcon size={18} /></IconButton>
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
                  <TableCell>录入时间</TableCell>
                  <TableCell>铜价预警</TableCell>
                  <TableCell>总成本</TableCell>
                  <TableCell align="center" sx={{ width: '200px' }}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recipes.map((recipe) => {
                  const data = recipeData.get(recipe.Id);
                  const tplName = recipe.templateId ? tplNameMap.get(recipe.templateId) || '-' : '-';
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
                      <TableCell title={recipe.CreatedAt ? new Date(recipe.CreatedAt).toLocaleString('zh-CN', { hour12: false }) : '-'}>
                        {formatRecipeEntryTime(recipe.CreatedAt)}
                      </TableCell>
                      <TableCell>
                        <CopperRiskChip risk={data?.copperRisk} />
                      </TableCell>
                      <TableCell>{data?.cost || '-'}</TableCell>
                      <TableCell align="center">
                        <Tooltip title="详情"><IconButton size="small" color="info" aria-label="查看配方详情" onClick={() => handleViewDetail(recipe)}><InfoIcon size={18} /></IconButton></Tooltip>
                        <Tooltip title="编辑"><IconButton size="small" color="warning" aria-label="编辑配方" onClick={() => handleEdit(recipe)}><EditIcon size={18} /></IconButton></Tooltip>
                        <Tooltip title="复制"><IconButton size="small" color="primary" aria-label="复制配方" onClick={() => handleClone(recipe)}><CopyIcon size={18} /></IconButton></Tooltip>
                        <Tooltip title="删除"><IconButton size="small" color="error" aria-label="删除配方" onClick={() => setDeleteTarget(recipe.Id)}><DeleteIcon size={18} /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
      )}

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
