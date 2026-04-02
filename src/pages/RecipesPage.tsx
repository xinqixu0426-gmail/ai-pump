import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Paper,
  Typography,
  Alert,
  Box,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  Button
} from '@mui/material';
import {
  Info as InfoIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Add as AddIcon,
  ContentCopy as CopyIcon,
  Edit as EditIcon
} from '@mui/icons-material';
import { Recipe, RecipePart, CostResult } from '../types';
import { deleteRecipe } from '../utils/api';
import { useAppStore } from '../utils/store';
import { buildPartsIndex, calculateRecipeCost } from '../utils/costCalculator';
import RecipeDetailModal from '../components/RecipeDetailModal';

export default function RecipesPage() {
  const navigate = useNavigate();
  const { recipes, parts, fetchParts, fetchRecipes } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState<{
    recipe: Recipe;
    costResult: CostResult;
  } | null>(null);

  // 加载数据
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      await Promise.all([fetchRecipes(), fetchParts()]);
      setError('');
    } catch (err) {
      setError('加载数据失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [fetchRecipes, fetchParts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 预计算所有配方的概览和成本（避免每帧重算）
  const recipeData = useMemo(() => {
    if (parts.length === 0) return new Map<number, { overview: string; cost: string; costResult: CostResult }>();
    const { partsCache, partsByModel } = buildPartsIndex(parts);
    const map = new Map<number, { overview: string; cost: string; costResult: CostResult }>();

    for (const recipe of recipes) {
      const partsJson = recipe.parts_json;
      let recipeParts: RecipePart[] = [];
      try { recipeParts = JSON.parse(partsJson); } catch { /* noop */ }

      const overview = recipeParts.map((p) => `${p.model}×${p.qty}`).join(', ') || '-';
      const costResult = calculateRecipeCost(recipeParts, partsCache, partsByModel, recipe.saved_total_cost);

      map.set(recipe.Id, { overview, cost: `¥${costResult.totalCost}`, costResult });
    }
    return map;
  }, [recipes, parts]);

  // 删除配方
  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要删除这个配方吗？')) return;

    try {
      await deleteRecipe(id);
      await fetchRecipes(true);
    } catch (err) {
      setError('删除失败');
      console.error(err);
    }
  };

  // 查看配方详情
  const handleViewDetail = (recipe: Recipe) => {
    const data = recipeData.get(recipe.Id);
    if (data) {
      setSelectedRecipe({ recipe, costResult: data.costResult });
    }
  };

  // 关闭详情弹窗
  const handleCloseDetail = () => {
    setSelectedRecipe(null);
  };

  // 复制配方
  const handleClone = (recipe: Recipe) => {
    navigate('/recipe-form', {
      state: {
        cloneFrom: {
          name: recipe.name + '-副本',
          spec: recipe.spec,
          partsJson: recipe.parts_json
        }
      }
    });
  };

  // 编辑配方
  const handleEdit = (recipe: Recipe) => {
    navigate('/recipe-form', {
      state: {
        editFrom: {
          id: recipe.Id,
          name: recipe.name,
          spec: recipe.spec,
          partsJson: recipe.parts_json
        }
      }
    });
  };

  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" color="success.main" sx={{ flexGrow: 1 }}>
          配方列表
        </Typography>
        {loading && <CircularProgress size={20} sx={{ mr: 1 }} />}
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => navigate('/recipe-form')}
          sx={{ mr: 1 }}
        >
          录入配方
        </Button>
        <Tooltip title="刷新">
          <IconButton onClick={loadData}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {recipes.length === 0 ? (
        <Box textAlign="center" py={4} color="text.secondary">
          暂无配方数据
        </Box>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                <TableCell>配方名称</TableCell>
                <TableCell>规格</TableCell>
                <TableCell>配件概览</TableCell>
                <TableCell>总成本</TableCell>
                <TableCell align="center" sx={{ width: '200px' }}>
                  操作
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recipes.map((recipe) => {
                const data = recipeData.get(recipe.Id);
                return (
                  <TableRow key={recipe.Id} hover sx={{ cursor: 'pointer' }} onDoubleClick={() => handleViewDetail(recipe)}>
                    <TableCell>{recipe.name}</TableCell>
                    <TableCell>{recipe.spec || '-'}</TableCell>
                    <TableCell
                      sx={{
                        maxWidth: '300px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                      title={data?.overview || '-'}
                    >
                      {data?.overview || '-'}
                    </TableCell>
                    <TableCell>{data?.cost || '-'}</TableCell>
                    <TableCell align="center">
                      <Tooltip title="详情">
                        <IconButton
                          size="small"
                          color="info"
                          onClick={() => handleViewDetail(recipe)}
                        >
                          <InfoIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="编辑">
                        <IconButton
                          size="small"
                          color="warning"
                          onClick={() => handleEdit(recipe)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="复制配方">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleClone(recipe)}
                        >
                          <CopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(recipe.Id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* 详情弹窗 */}
      {selectedRecipe && (
        <RecipeDetailModal
          recipe={selectedRecipe.recipe}
          costResult={selectedRecipe.costResult}
          parts={parts}
          onClose={handleCloseDetail}
          onStockUpdated={loadData}
        />
      )}
    </Paper>
  );
}
