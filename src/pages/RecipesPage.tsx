import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Paper, Typography, Alert, Box, CircularProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, IconButton, Tooltip, Button, Dialog,
  DialogTitle, DialogContent, DialogContentText, DialogActions, Chip, Collapse,
  Tab, Tabs, useMediaQuery, useTheme, TextField, InputAdornment, FormControl,
  InputLabel, Select, MenuItem, Checkbox,
} from '@mui/material';
import {
  Info as InfoIcon, Trash2 as DeleteIcon, RefreshCw as RefreshIcon,
  Plus as AddIcon, Copy as CopyIcon, Edit3 as EditIcon,
  Package as TemplateIcon, FileText as FileIcon, ScrollText as RecipeIcon, Wrench as PartIcon,
  Search as SearchIcon, GitCompare as CompareIcon,
} from 'lucide-react';
import { PumpModelVariant, Recipe, CostResult, RecipePart } from '../types';
import { deleteRecipe, calculateCost, getAllModelVariants, getCopperPrice } from '../utils/api';
import { useAppStore } from '../utils/store';
import { buildRecipeListData, formatRecipeEntryTime, parseRecipePartsJson, RecipeCopperRisk, RecipeListData } from '../utils/recipeListRules';
import RecipeDetailModal from '../components/RecipeDetailModal';
import TemplateSection from '../components/TemplateSection';
import ModelVariantSection from '../components/ModelVariantSection';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { colors, gradients } from '../utils/theme';
import { entityCreatedAt, entityId } from '../utils/entityFields';

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

type ComparePartRow = {
  key: string;
  label: string;
  leftQty: number;
  rightQty: number;
  leftSubtotal: number;
  rightSubtotal: number;
  leftModel: string;
  rightModel: string;
  changed: boolean;
};

function moneyText(value?: number | string) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? `¥${number.toFixed(2)}` : '-';
}

function partCompareKey(part: RecipePart) {
  return `${part.name || part.model}||${part.model || ''}||${part.supplier || ''}`;
}

function partSubtotal(part?: RecipePart) {
  return Number(part?.snapshotPrice || 0) * Number(part?.qty || 0);
}

function buildPartCompareRows(left: RecipePart[], right: RecipePart[]): ComparePartRow[] {
  const map = new Map<string, { left?: RecipePart; right?: RecipePart }>();
  left.forEach(part => {
    const key = partCompareKey(part);
    map.set(key, { ...(map.get(key) || {}), left: part });
  });
  right.forEach(part => {
    const key = partCompareKey(part);
    map.set(key, { ...(map.get(key) || {}), right: part });
  });
  return Array.from(map.entries()).map(([key, pair]) => {
    const leftQty = Number(pair.left?.qty || 0);
    const rightQty = Number(pair.right?.qty || 0);
    const leftSubtotal = partSubtotal(pair.left);
    const rightSubtotal = partSubtotal(pair.right);
    return {
      key,
      label: pair.left?.name || pair.right?.name || pair.left?.model || pair.right?.model || '-',
      leftQty,
      rightQty,
      leftSubtotal,
      rightSubtotal,
      leftModel: pair.left?.model || '-',
      rightModel: pair.right?.model || '-',
      changed: leftQty !== rightQty || Math.abs(leftSubtotal - rightSubtotal) >= 0.01 || !pair.left || !pair.right,
    };
  }).filter(row => row.changed).sort((a, b) => Math.abs((b.rightSubtotal - b.leftSubtotal)) - Math.abs((a.rightSubtotal - a.leftSubtotal)));
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
  const [recipeQuery, setRecipeQuery] = useState('');
  const [recipeTemplateFilter, setRecipeTemplateFilter] = useState('');
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

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
    templates.forEach(t => m.set(entityId(t), t.shellModel));
    return m;
  }, [templates]);

  const filteredRecipes = useMemo(() => {
    const q = recipeQuery.trim().toLowerCase();
    return recipes.filter(recipe => {
      if (recipeTemplateFilter && String(recipe.templateId || '') !== recipeTemplateFilter) return false;
      if (!q) return true;
      const templateName = recipe.templateId ? tplNameMap.get(recipe.templateId) || '' : '';
      const data = recipeData.get(entityId(recipe));
      const text = [
        recipe.name,
        recipe.spec,
        templateName,
        recipe.coilSpec,
        recipe.coilSheets,
        recipe.coilMaterial,
        recipe.impellerModel,
        data?.copperRisk?.label,
        data?.copperRisk?.detail,
      ].join(' ').toLowerCase();
      return text.includes(q);
    });
  }, [recipes, recipeTemplateFilter, recipeQuery, tplNameMap, recipeData]);

  const compareRecipes = useMemo(() => (
    compareIds.map(id => recipes.find(recipe => entityId(recipe) === id)).filter(Boolean) as Recipe[]
  ), [compareIds, recipes]);

  const comparePartRows = useMemo(() => {
    if (compareRecipes.length !== 2) return [];
    return buildPartCompareRows(
      parseRecipePartsJson(compareRecipes[0].partsJson),
      parseRecipePartsJson(compareRecipes[1].partsJson),
    );
  }, [compareRecipes]);

  // ── 配方成本（后端批量计算） ──
  useEffect(() => {
    if (recipes.length === 0) { setRecipeData(new Map()); return; }
    let cancelled = false;
    (async () => {
      const map = new Map<number, RecipeListData>();
      for (const recipe of recipes) {
        map.set(entityId(recipe), await buildRecipeListData(recipe, calculateCost, currentCopperPricePerKg));
      }
      if (!cancelled) setRecipeData(map);
    })();
    return () => { cancelled = true; };
  }, [recipes, currentCopperPricePerKg]);

  // ── 配方操作 ──
  useEffect(() => {
    if (!navigationState?.openRecipeId || consumedNavigationRef.current === location.key) return;
    const target = recipes.find(recipe => entityId(recipe) === Number(navigationState.openRecipeId));
    const data = target ? recipeData.get(entityId(target)) : null;
    if (!target || !data) return;

    setSelectedRecipe({ recipe: target, costResult: data.costResult });
    consumedNavigationRef.current = location.key;
    navigate(location.pathname, { replace: true, state: null });
  }, [navigationState?.openRecipeId, recipes, recipeData, location.key, location.pathname, navigate]);

  const handleViewDetail = (recipe: Recipe) => {
    const data = recipeData.get(entityId(recipe));
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
      Id: entityId(recipe), name: recipe.name, spec: recipe.spec, partsJson: recipe.partsJson,
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

  const toggleCompareRecipe = (id: number) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(item => item !== id);
      return [...prev.slice(-1), id];
    });
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
      <Paper elevation={0} sx={{ borderRadius: 3, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <TemplateIcon size={24} style={{ marginRight: 8 }} color="rgba(34,197,94,1)" />
          <Typography variant="h6" fontWeight={700} color="success.main" sx={{ flexGrow: 1 }}>配方列表</Typography>
          {compareIds.length > 0 && (
            <Button size="small" variant="outlined" onClick={() => setCompareIds([])} sx={{ mr: 1, fontWeight: 700 }}>
              清空选择
            </Button>
          )}
          <Button
            size="small"
            variant="contained"
            startIcon={<CompareIcon size={16} />}
            disabled={compareIds.length !== 2}
            onClick={() => setCompareOpen(true)}
            sx={{ mr: 1, fontWeight: 700 }}
          >
            对比 {compareIds.length}/2
          </Button>
          <Chip label={`${filteredRecipes.length} / ${recipes.length}`} size="small" variant="outlined" sx={{ fontWeight: 700 }} />
        </Box>

        {recipes.length === 0 ? (
          <Box textAlign="center" py={6} color="text.secondary">
            <Typography variant="body2">暂无配方数据，点击右上角录入</Typography>
          </Box>
        ) : (
          <>
          <Box sx={{ p: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap', borderBottom: '1px solid', borderColor: 'divider' }}>
            <TextField
              value={recipeQuery}
              onChange={(e) => setRecipeQuery(e.target.value)}
              placeholder="搜索配方 / 规格 / 线圈 / 预警"
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
            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 220 } }}>
              <InputLabel>泵壳模板</InputLabel>
              <Select value={recipeTemplateFilter} label="泵壳模板" onChange={e => setRecipeTemplateFilter(e.target.value)}>
                <MenuItem value="">全部模板</MenuItem>
                {templates.map(template => (
                  <MenuItem key={entityId(template)} value={String(entityId(template))}>{template.shellModel}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          {filteredRecipes.length === 0 ? (
            <Box textAlign="center" py={6} color="text.secondary">
              <Typography variant="body2">没有匹配的配方</Typography>
            </Box>
          ) : isMobile ? (
          <Box p={2}>
            {filteredRecipes.map((recipe) => {
              const recipeId = entityId(recipe);
              const recipeCreatedAt = entityCreatedAt(recipe);
              const data = recipeData.get(recipeId);
              const tplName = recipe.templateId ? tplNameMap.get(recipe.templateId) || '-' : '-';
              return (
                <Paper
                  key={recipeId}
                  onClick={() => handleViewDetail(recipe)}
                  elevation={0}
                  sx={{ p: 2, mb: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', cursor: 'pointer' }}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                      <Checkbox
                        size="small"
                        checked={compareIds.includes(recipeId)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleCompareRecipe(recipeId)}
                        inputProps={{ 'aria-label': `选择对比 ${recipe.name}` }}
                      />
                      <Typography fontWeight={700} noWrap>{recipe.name}</Typography>
                    </Box>
                    {tplName !== '-' && (
                      <Chip label={tplName} size="small" variant="outlined"
                        sx={{ height: 22, fontSize: '0.7rem', borderColor: colors.purple.border, color: colors.purple.main }} />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
                    {recipe.spec || '无规格'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
                    录入时间：{formatRecipeEntryTime(recipeCreatedAt)}
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
                    <IconButton size="small" color="error" aria-label="删除配方" onClick={(e) => { e.stopPropagation(); setDeleteTarget(recipeId); }}><DeleteIcon size={18} /></IconButton>
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
                  <TableCell padding="checkbox">对比</TableCell>
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
                {filteredRecipes.map((recipe) => {
                  const recipeId = entityId(recipe);
                  const recipeCreatedAt = entityCreatedAt(recipe);
                  const data = recipeData.get(recipeId);
                  const tplName = recipe.templateId ? tplNameMap.get(recipe.templateId) || '-' : '-';
                  return (
                    <TableRow key={recipeId} hover sx={{ cursor: 'pointer' }} onDoubleClick={() => handleViewDetail(recipe)}>
                      <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          size="small"
                          checked={compareIds.includes(recipeId)}
                          onChange={() => toggleCompareRecipe(recipeId)}
                          inputProps={{ 'aria-label': `选择对比 ${recipe.name}` }}
                        />
                      </TableCell>
                      <TableCell>{recipe.name}</TableCell>
                      <TableCell>{recipe.spec || '-'}</TableCell>
                      <TableCell>
                        {tplName !== '-' ? (
                          <Chip label={tplName} size="small" variant="outlined"
                            sx={{ height: 22, fontSize: '0.7rem', borderColor: colors.purple.border, color: colors.purple.main }} />
                        ) : '-'}
                      </TableCell>
                      <TableCell title={recipeCreatedAt ? new Date(recipeCreatedAt).toLocaleString('zh-CN', { hour12: false }) : '-'}>
                        {formatRecipeEntryTime(recipeCreatedAt)}
                      </TableCell>
                      <TableCell>
                        <CopperRiskChip risk={data?.copperRisk} />
                      </TableCell>
                      <TableCell>{data?.cost || '-'}</TableCell>
                      <TableCell align="center">
                        <Tooltip title="详情"><IconButton size="small" color="info" aria-label="查看配方详情" onClick={() => handleViewDetail(recipe)}><InfoIcon size={18} /></IconButton></Tooltip>
                        <Tooltip title="编辑"><IconButton size="small" color="warning" aria-label="编辑配方" onClick={() => handleEdit(recipe)}><EditIcon size={18} /></IconButton></Tooltip>
                        <Tooltip title="复制"><IconButton size="small" color="primary" aria-label="复制配方" onClick={() => handleClone(recipe)}><CopyIcon size={18} /></IconButton></Tooltip>
                        <Tooltip title="删除"><IconButton size="small" color="error" aria-label="删除配方" onClick={() => setDeleteTarget(recipeId)}><DeleteIcon size={18} /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
          </>
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

      <Dialog open={compareOpen} onClose={() => setCompareOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>配方对比</DialogTitle>
        <DialogContent dividers>
          {compareRecipes.length !== 2 ? (
            <Typography color="text.secondary">请选择两个配方进行对比</Typography>
          ) : (
            <Box display="grid" gap={2}>
              <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 160 }}>项目</TableCell>
                      <TableCell>{compareRecipes[0].name}</TableCell>
                      <TableCell>{compareRecipes[1].name}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[
                      ['泵壳模板', compareRecipes[0].templateId ? tplNameMap.get(compareRecipes[0].templateId) || '-' : '-', compareRecipes[1].templateId ? tplNameMap.get(compareRecipes[1].templateId) || '-' : '-'],
                      ['规格', compareRecipes[0].spec || '-', compareRecipes[1].spec || '-'],
                      ['保存成本', moneyText(compareRecipes[0].savedTotalCost), moneyText(compareRecipes[1].savedTotalCost)],
                      ['当前列表成本', recipeData.get(entityId(compareRecipes[0]))?.cost || '-', recipeData.get(entityId(compareRecipes[1]))?.cost || '-'],
                      ['线圈', `${compareRecipes[0].coilSpec || '-'} / ${compareRecipes[0].coilSheets || '-'}片 / ${compareRecipes[0].coilMaterial || '-'}`, `${compareRecipes[1].coilSpec || '-'} / ${compareRecipes[1].coilSheets || '-'}片 / ${compareRecipes[1].coilMaterial || '-'}`],
                      ['机筒长度', compareRecipes[0].customBarrelLength ? `${compareRecipes[0].customBarrelLength} mm` : '-', compareRecipes[1].customBarrelLength ? `${compareRecipes[1].customBarrelLength} mm` : '-'],
                      ['叶轮', [compareRecipes[0].impellerModel, compareRecipes[0].impellerThickness && `${compareRecipes[0].impellerThickness}厚`, compareRecipes[0].impellerDiameter && `直径${compareRecipes[0].impellerDiameter}`, compareRecipes[0].impellerBladeCount && `${compareRecipes[0].impellerBladeCount}片`].filter(Boolean).join(' / ') || '-', [compareRecipes[1].impellerModel, compareRecipes[1].impellerThickness && `${compareRecipes[1].impellerThickness}厚`, compareRecipes[1].impellerDiameter && `直径${compareRecipes[1].impellerDiameter}`, compareRecipes[1].impellerBladeCount && `${compareRecipes[1].impellerBladeCount}片`].filter(Boolean).join(' / ') || '-'],
                      ['电缆', compareRecipes[0].hasCable ? `${compareRecipes[0].cableWire || '-'} / ${compareRecipes[0].cableLength || 0}m` : '不带', compareRecipes[1].hasCable ? `${compareRecipes[1].cableWire || '-'} / ${compareRecipes[1].cableLength || 0}m` : '不带'],
                      ['浮球', compareRecipes[0].hasFloat ? `${compareRecipes[0].floatWire || '-'} / ${compareRecipes[0].floatAccessoryType || 'standard'}` : '不带', compareRecipes[1].hasFloat ? `${compareRecipes[1].floatWire || '-'} / ${compareRecipes[1].floatAccessoryType || 'standard'}` : '不带'],
                    ].map(([label, left, right]) => (
                      <TableRow key={String(label)} sx={{ bgcolor: left !== right ? 'rgba(245,158,11,0.08)' : undefined }}>
                        <TableCell sx={{ fontWeight: 800 }}>{label}</TableCell>
                        <TableCell>{left}</TableCell>
                        <TableCell>{right}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box>
                <Typography variant="subtitle2" fontWeight={800} gutterBottom>BOM 差异</Typography>
                {comparePartRows.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">两个配方的 BOM 快照没有发现差异</Typography>
                ) : (
                  <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, maxHeight: 420 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>配件</TableCell>
                          <TableCell>{compareRecipes[0].name}</TableCell>
                          <TableCell>{compareRecipes[1].name}</TableCell>
                          <TableCell align="right">小计差额</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {comparePartRows.map(row => (
                          <TableRow key={row.key}>
                            <TableCell>
                              <Typography variant="body2" fontWeight={700}>{row.label}</Typography>
                              <Typography variant="caption" color="text.secondary">{row.leftModel === row.rightModel ? row.leftModel : `${row.leftModel} / ${row.rightModel}`}</Typography>
                            </TableCell>
                            <TableCell>数量 {row.leftQty || '-'}，{moneyText(row.leftSubtotal)}</TableCell>
                            <TableCell>数量 {row.rightQty || '-'}，{moneyText(row.rightSubtotal)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 800, color: row.rightSubtotal - row.leftSubtotal >= 0 ? 'error.main' : 'success.main' }}>
                              {row.rightSubtotal - row.leftSubtotal >= 0 ? '+' : ''}{moneyText(row.rightSubtotal - row.leftSubtotal)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompareOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
