import { useState, useEffect, useCallback } from 'react';
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
  ContentCopy as CopyIcon
} from '@mui/icons-material';
import { Recipe, Part, RecipePart, CostResult } from '../types';
import { getAllRecipes, getAllParts, deleteRecipe } from '../utils/api';
import { buildPartsIndex, calculateRecipeCost } from '../utils/costCalculator';
import RecipeDetailModal from '../components/RecipeDetailModal';

export default function RecipesPage() {
  const navigate = useNavigate();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
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
      const [recipesData, partsData] = await Promise.all([
        getAllRecipes(),
        getAllParts()
      ]);
      setRecipes(recipesData);
      setParts(partsData);
      setError('');
    } catch (err) {
      setError('加载数据失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 删除配方
  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要删除这个配方吗？')) return;

    try {
      await deleteRecipe(id);
      await loadData();
    } catch (err) {
      setError('删除失败');
      console.error(err);
    }
  };

  // 查看配方详情
  const handleViewDetail = (recipe: Recipe) => {
    const partsJson = recipe.配件JSON || recipe.parts_json || '[]';
    let recipeParts: RecipePart[] = [];
    try {
      recipeParts = JSON.parse(partsJson);
    } catch {
      recipeParts = [];
    }

    const { partsCache, partsByModel } = buildPartsIndex(parts);
    const costResult = calculateRecipeCost(recipeParts, partsCache, partsByModel, recipe.saved_total_cost);

    setSelectedRecipe({ recipe, costResult });
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
          name: (recipe.配方名称 || recipe.name || '') + '-副本',
          spec: recipe.规格 || recipe.spec || '',
          partsJson: recipe.配件JSON || recipe.parts_json || '[]'
        }
      }
    });
  };

  // 解析配件概览
  const getPartsOverview = (recipe: Recipe): string => {
    const partsJson = recipe.配件JSON || recipe.parts_json || '[]';
    try {
      const parts: RecipePart[] = JSON.parse(partsJson);
      return parts.map((p) => `${p.model}×${p.qty}`).join(', ');
    } catch {
      return '-';
    }
  };

  // 计算单个配方成本
  const getRecipeCost = (recipe: Recipe): string => {
    const partsJson = recipe.配件JSON || recipe.parts_json || '[]';
    let recipeParts: RecipePart[] = [];
    try {
      recipeParts = JSON.parse(partsJson);
    } catch {
      return '-';
    }

    const { partsCache, partsByModel } = buildPartsIndex(parts);
    const costResult = calculateRecipeCost(recipeParts, partsCache, partsByModel, recipe.saved_total_cost);
    return `¥${costResult.totalCost}`;
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
                <TableCell align="center" sx={{ width: '160px' }}>
                  操作
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recipes.map((recipe) => (
                <TableRow key={recipe.Id} hover>
                  <TableCell>{recipe.配方名称 || recipe.name}</TableCell>
                  <TableCell>{recipe.规格 || recipe.spec || '-'}</TableCell>
                  <TableCell
                    sx={{
                      maxWidth: '300px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={getPartsOverview(recipe)}
                  >
                    {getPartsOverview(recipe)}
                  </TableCell>
                  <TableCell>{getRecipeCost(recipe)}</TableCell>
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
              ))}
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
