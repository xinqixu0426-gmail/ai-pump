import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Paper,
  Typography,
  Alert,
  Box,
  CircularProgress,
  TextField,
  Button,
  Grid,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Divider
} from '@mui/material';
import {
  Save as SaveIcon,
  Add as AddIcon
} from '@mui/icons-material';
import { Part, RecipePart } from '../types';
import { getAllParts, createRecipe } from '../utils/api';
import { buildPartsIndex, calculateRecipeCost } from '../utils/costCalculator';
import RecipePartRow from '../components/RecipePartRow';

// 必备配件配置
const REQUIRED_PARTS = [
  { key: 'pumpShell', name: '泵壳' },
  { key: 'plateBearing', name: '花板轴承' },
  { key: 'cylinderBearing', name: '油缸轴承' },
  { key: 'mechanicalSeal', name: '机械油封' },
  { key: 'skeletonSeal', name: '骨架油封' },
  { key: 'rotor', name: '线圈转子' }
];

interface PartSelection {
  model: string;
  supplier: string;
  qty: number;
}

// 必备配件名称 -> key 的映射
const REQUIRED_NAME_TO_KEY: Record<string, string> = {};
REQUIRED_PARTS.forEach(({ key, name }) => {
  REQUIRED_NAME_TO_KEY[name] = key;
});

export default function RecipeFormPage() {
  const location = useLocation();
  const cloneFrom = (location.state as { cloneFrom?: { name: string; spec: string; partsJson: string } })?.cloneFrom;
  const cloneApplied = useRef(false);

  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 配方基本信息
  const [recipeName, setRecipeName] = useState(cloneFrom?.name || '');
  const [recipeSpec, setRecipeSpec] = useState(cloneFrom?.spec || '');

  // 必备配件选择
  const [requiredSelections, setRequiredSelections] = useState<
    Record<string, PartSelection>
  >({
    pumpShell: { model: '', supplier: '', qty: 1 },
    plateBearing: { model: '', supplier: '', qty: 1 },
    cylinderBearing: { model: '', supplier: '', qty: 1 },
    mechanicalSeal: { model: '', supplier: '', qty: 1 },
    skeletonSeal: { model: '', supplier: '', qty: 1 },
    rotor: { model: '', supplier: '', qty: 1 }
  });

  // 选配配件
  const [optionalParts, setOptionalParts] = useState<
    Array<PartSelection & { id: number }>
  >([]);
  const nextOptionalId = useRef(1);

  // 实时成本预览
  const [costPreview, setCostPreview] = useState<{
    totalCost: string;
    itemCount: number;
  } | null>(null);

  // 加载零件数据
  const loadParts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAllParts();
      setParts(data);
      setError('');
    } catch (err) {
      setError('加载零件数据失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadParts();
  }, [loadParts]);

  // 复制配方时预填配件数据（等 parts 加载完再填，这样供应商联动才能正常工作）
  useEffect(() => {
    if (!cloneFrom || cloneApplied.current || parts.length === 0) return;
    cloneApplied.current = true;

    try {
      const cloneParts: RecipePart[] = JSON.parse(cloneFrom.partsJson);
      const newRequired: Record<string, PartSelection> = {
        pumpShell: { model: '', supplier: '', qty: 1 },
        plateBearing: { model: '', supplier: '', qty: 1 },
        cylinderBearing: { model: '', supplier: '', qty: 1 },
        mechanicalSeal: { model: '', supplier: '', qty: 1 },
        skeletonSeal: { model: '', supplier: '', qty: 1 },
        rotor: { model: '', supplier: '', qty: 1 }
      };
      const newOptional: Array<PartSelection & { id: number }> = [];

      cloneParts.forEach(cp => {
        const key = REQUIRED_NAME_TO_KEY[cp.name];
        if (key) {
          newRequired[key] = { model: cp.model, supplier: cp.supplier, qty: cp.qty };
        } else {
          newOptional.push({ id: nextOptionalId.current++, model: cp.model, supplier: cp.supplier, qty: cp.qty });
        }
      });

      setRequiredSelections(newRequired);
      setOptionalParts(newOptional);
    } catch (e) {
      console.error('复制配方解析失败', e);
    }
  }, [cloneFrom, parts]);

  // 计算实时成本
  useEffect(() => {
    const allParts: RecipePart[] = [];

    REQUIRED_PARTS.forEach(({ key, name }) => {
      const selection = requiredSelections[key];
      if (selection.model) {
        allParts.push({ model: selection.model, name, supplier: selection.supplier, qty: selection.qty });
      }
    });

    optionalParts.forEach((part) => {
      if (part.model) {
        allParts.push({ model: part.model, name: part.model, supplier: part.supplier, qty: part.qty });
      }
    });

    if (allParts.length > 0) {
      const { partsCache, partsByModel } = buildPartsIndex(parts);
      const result = calculateRecipeCost(allParts, partsCache, partsByModel);
      setCostPreview({ totalCost: result.totalCost, itemCount: result.itemCount });
    } else {
      setCostPreview(null);
    }
  }, [requiredSelections, optionalParts, parts]);

  // 获取某类别的零件型号列表
  const getModelsByCategory = (category: string): string[] => {
    const models = new Set<string>();
    parts.forEach((part) => {
      const partCategory = part.类别 || part.category || '';
      if (partCategory === category) {
        models.add(part.型号 || part.model || '');
      }
    });
    return Array.from(models).filter(Boolean).sort();
  };

  // 获取某型号的所有供应商
  const getSuppliersByModel = (model: string): string[] => {
    const suppliers = new Set<string>();
    parts.forEach((part) => {
      const partModel = part.型号 || part.model || '';
      if (partModel === model) {
        suppliers.add(part.供应商 || part.supplier || '');
      }
    });
    return Array.from(suppliers).filter(Boolean).sort();
  };

  // 获取某型号某供应商的价格（增加回退逻辑）
  const getPriceByModelAndSupplier = (model: string, supplier: string): number => {
    // 1. 尝试精确匹配 (model + supplier)
    const exactPart = parts.find((p) => (p.型号 || p.model) === model && (p.供应商 || p.supplier) === supplier);
    if (exactPart) return exactPart.单价 || exactPart.price || 0;

    // 2. 回退到型号匹配
    const modelPart = parts.find((p) => (p.型号 || p.model) === model);
    return modelPart?.单价 || modelPart?.price || 0;
  };

  // 更新必备配件选择
  const handleRequiredChange = (key: string, field: keyof PartSelection, value: string | number) => {
    setRequiredSelections((prev) => {
      const updated = { ...prev, [key]: { ...prev[key], [field]: value } };
      if (field === 'model') {
        updated[key].supplier = '';
      }
      return updated;
    });
  };

  // 添加选配配件
  const handleAddOptional = () => {
    setOptionalParts((prev) => [
      ...prev,
      { id: nextOptionalId.current++, model: '', supplier: '', qty: 1 }
    ]);
  };

  // 更新选配配件
  const handleOptionalChange = (id: number, field: keyof PartSelection, value: string | number) => {
    setOptionalParts((prev) =>
      prev.map((part) => {
        if (part.id === id) {
          const updated = { ...part, [field]: value };
          if (field === 'model') updated.supplier = '';
          return updated;
        }
        return part;
      })
    );
  };

  // 删除选配配件
  const handleRemoveOptional = (id: number) => {
    setOptionalParts((prev) => prev.filter((part) => part.id !== id));
  };

  // 提交配方
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!recipeName.trim()) {
      setError('请输入配方名称');
      return;
    }

    const recipeParts: RecipePart[] = [];

    REQUIRED_PARTS.forEach(({ key, name }) => {
      const selection = requiredSelections[key];
      if (selection.model) {
        const snapshotPrice = getPriceByModelAndSupplier(selection.model, selection.supplier);
        recipeParts.push({ model: selection.model, name, supplier: selection.supplier, qty: selection.qty, snapshotPrice });
      }
    });

    optionalParts.forEach((part) => {
      if (part.model) {
        const snapshotPrice = getPriceByModelAndSupplier(part.model, part.supplier);
        recipeParts.push({ model: part.model, name: part.model, supplier: part.supplier, qty: part.qty, snapshotPrice });
      }
    });

    if (recipeParts.length === 0) {
      setError('请至少选择一个配件');
      return;
    }

    try {
      await createRecipe({
        配方名称: recipeName,
        规格: recipeSpec,
        配件JSON: JSON.stringify(recipeParts)
      });

      setSuccess('配方录入成功！');
      setRecipeName('');
      setRecipeSpec('');
      setRequiredSelections({
        pumpShell: { model: '', supplier: '', qty: 1 },
        plateBearing: { model: '', supplier: '', qty: 1 },
        cylinderBearing: { model: '', supplier: '', qty: 1 },
        mechanicalSeal: { model: '', supplier: '', qty: 1 },
        skeletonSeal: { model: '', supplier: '', qty: 1 },
        rotor: { model: '', supplier: '', qty: 1 }
      });
      setOptionalParts([]);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('保存配方失败');
      console.error(err);
    }
  };

  // 表头
  const TableHeader = () => (
    <TableHead>
      <TableRow sx={{ bgcolor: 'grey.50' }}>
        <TableCell sx={{ py: 0.75, pl: 1.5, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 90 }}>配件</TableCell>
        <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>型号</TableCell>
        <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>供应商</TableCell>
        <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 70 }}>数量</TableCell>
        <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 72, textAlign: 'right' }}>单价</TableCell>
        <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 80, textAlign: 'right' }}>小计</TableCell>
        <TableCell sx={{ py: 0.75, width: 40 }} />
      </TableRow>
    </TableHead>
  );

  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" color="primary" sx={{ flexGrow: 1 }}>
          录入配方
        </Typography>
        {loading && <CircularProgress size={20} />}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Box component="form" onSubmit={handleSubmit}>
        {/* 基本信息 */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={6}>
            <TextField
              label="配方名称"
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
              placeholder="如：人民款370w-90机筒"
              required
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="规格"
              value={recipeSpec}
              onChange={(e) => setRecipeSpec(e.target.value)}
              placeholder="如：90-100"
              fullWidth
              size="small"
            />
          </Grid>
        </Grid>

        {/* 统一配件表格 */}
        <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
          <Table size="small" sx={{ tableLayout: 'auto' }}>
            <TableHeader />
            <TableBody>
              {/* 必备配件 */}
              <TableRow>
                <TableCell colSpan={7} sx={{ py: 0.5, px: 1.5, bgcolor: 'primary.50', borderBottom: 'none' }}>
                  <Typography variant="caption" fontWeight={700} color="primary.main" sx={{ letterSpacing: 1 }}>
                    ▸ 必备配件
                  </Typography>
                </TableCell>
              </TableRow>
              {REQUIRED_PARTS.map(({ key, name }) => (
                <RecipePartRow
                  key={key}
                  label={name}
                  selection={requiredSelections[key]}
                  models={getModelsByCategory(
                    name === '泵壳' ? '泵壳'
                      : name === '线圈转子' ? '线圈转子'
                      : name.includes('轴承') ? '轴承'
                      : name.includes('油封') ? '油封'
                      : '其他'
                  )}
                  getSuppliers={getSuppliersByModel}
                  getPrice={getPriceByModelAndSupplier}
                  onChange={(field, value) => handleRequiredChange(key, field, value)}
                  isRequired
                />
              ))}

              {/* 分隔 */}
              <TableRow>
                <TableCell colSpan={7} sx={{ p: 0 }}>
                  <Divider />
                </TableCell>
              </TableRow>

              {/* 选配配件标题行 */}
              <TableRow>
                <TableCell colSpan={7} sx={{ py: 0.5, px: 1.5, bgcolor: 'grey.50', borderBottom: 'none' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 1 }}>
                      ▸ 选配配件（{optionalParts.length} 项）
                    </Typography>
                    <Button
                      variant="text"
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={handleAddOptional}
                      sx={{ py: 0, minWidth: 'auto', fontSize: '0.75rem' }}
                    >
                      添加配件
                    </Button>
                  </Box>
                </TableCell>
              </TableRow>

              {/* 选配配件行 */}
              {optionalParts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ textAlign: 'center', py: 2, color: 'text.disabled', fontSize: '0.8rem' }}>
                    暂无选配配件，点击「添加配件」
                  </TableCell>
                </TableRow>
              ) : (
                optionalParts.map((part) => (
                  <RecipePartRow
                    key={part.id}
                    label="配件"
                    selection={part}
                    models={parts.map((p) => p.型号 || p.model || '').filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)}
                    getSuppliers={getSuppliersByModel}
                    getPrice={getPriceByModelAndSupplier}
                    onChange={(field, value) => handleOptionalChange(part.id, field, value)}
                    onDelete={() => handleRemoveOptional(part.id)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </Paper>

        {/* 成本预览 */}
        {costPreview && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <strong>成本预览：</strong>{costPreview.itemCount} 项配件
              </span>
              <Typography variant="h6" color="error">
                预估成本：¥{costPreview.totalCost}
              </Typography>
            </Box>
          </Alert>
        )}

        {/* 提交 */}
        <Button
          type="submit"
          variant="contained"
          size="large"
          startIcon={<SaveIcon />}
          fullWidth
        >
          保存配方
        </Button>
      </Box>
    </Paper>
  );
}
