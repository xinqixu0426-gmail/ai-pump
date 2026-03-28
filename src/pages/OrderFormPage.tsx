import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Paper,
  Typography,
  Box,
  Button,
  TextField,
  Stepper,
  Step,
  StepLabel,
  Autocomplete,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Alert,
  CircularProgress,
  Divider,
  InputAdornment,
  Tooltip,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  ArrowForward as NextIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { Recipe, Part, RecipePart } from '../types';
import { getAllRecipes, getAllParts } from '../utils/api';
import {
  createEmptyOrder,
  createOrderItem,
  buildPurchaseList,
  buildTodos,
  saveOrder,
} from '../utils/orderStore';

const STEPS = ['基本信息', '添加型号', '预览采购清单', '确认提交'];

export default function OrderFormPage() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);

  // ── 数据加载 ──────────────────────────
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [allParts, setAllParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [r, p] = await Promise.all([getAllRecipes(), getAllParts()]);
      setRecipes(r);
      setAllParts(p);
    } catch {
      setError('加载配方/零件数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Step 1 状态 ──────────────────────
  const [customerName, setCustomerName] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [remark, setRemark] = useState('');

  // ── Step 2 状态 ──────────────────────
  interface DraftItem {
    id: string;
    recipeId?: number;
    recipeName: string;
    spec?: string;
    qty: number;
    partsJson: string;
  }
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [addQty, setAddQty] = useState(1);

  const addRecipeToOrder = () => {
    if (!selectedRecipe) return;
    const partsJson = selectedRecipe.配件JSON || selectedRecipe.parts_json || '[]';
    const item = createOrderItem(
      selectedRecipe.配方名称 || selectedRecipe.name || '',
      partsJson,
      addQty,
      selectedRecipe.Id,
      selectedRecipe.规格 || selectedRecipe.spec
    );
    setDraftItems((prev) => [...prev, item]);
    setSelectedRecipe(null);
    setAddQty(1);
  };

  const removeItem = (id: string) => setDraftItems((prev) => prev.filter((i) => i.id !== id));
  const updateItemQty = (id: string, qty: number) =>
    setDraftItems((prev) => prev.map((i) => (i.id === id ? { ...i, qty: Math.max(1, qty) } : i)));

  // ── Step 3: 采购清单预览 ─────────────
  const purchaseList = buildPurchaseList(draftItems, allParts);
  const todos = buildTodos(purchaseList);
  const needCount = purchaseList.filter((p) => p.needToBuy > 0).length;

  // ── Step 4: 提交 ─────────────────────
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const order = createEmptyOrder(customerName, remark || undefined, contractNo || undefined);
      order.items = draftItems;
      order.purchaseList = purchaseList;
      order.todos = todos;
      saveOrder(order);
      navigate('/orders');
    } catch {
      setError('保存订单失败');
      setSubmitting(false);
    }
  };

  // ── 步骤验证 ─────────────────────────
  const canNext = () => {
    if (activeStep === 0) return customerName.trim().length > 0;
    if (activeStep === 1) return draftItems.length > 0;
    return true;
  };

  const recipeOptions = recipes.map((r) => ({
    label: `${r.配方名称 || r.name || ''} ${r.规格 || r.spec ? `[${r.规格 || r.spec}]` : ''}`,
    recipe: r,
  }));

  return (
    <Paper elevation={2} sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
      {/* 标题 */}
      <Box display="flex" alignItems="center" mb={3} gap={1}>
        <IconButton onClick={() => navigate('/orders')} size="small">
          <BackIcon />
        </IconButton>
        <Typography variant="h6">新建订单</Typography>
      </Box>

      {/* 步骤条 */}
      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {loading && <Box textAlign="center" py={3}><CircularProgress /></Box>}

      {/* ── Step 0: 基本信息 ── */}
      {!loading && activeStep === 0 && (
        <Box sx={{ maxWidth: 480 }}>
          <TextField
            label="客户名称"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            fullWidth
            required
            sx={{ mb: 2 }}
            placeholder="如：张工、华东水务公司"
          />
          <TextField
            label="合同号"
            value={contractNo}
            onChange={(e) => setContractNo(e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
            placeholder="如：HT-2026-001"
          />
          <TextField
            label="备注（可选）"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            fullWidth
            multiline
            rows={2}
            placeholder="交货日期、特殊要求等"
          />
        </Box>
      )}

      {/* ── Step 1: 添加型号 ── */}
      {!loading && activeStep === 1 && (
        <Box>
          {/* 添加配方区 */}
          <Box
            sx={{
              p: 2,
              mb: 3,
              border: '1px dashed',
              borderColor: 'primary.light',
              borderRadius: 2,
              backgroundColor: 'primary.50',
            }}
          >
            <Typography variant="subtitle2" mb={1.5} color="primary">
              从已有配方中选择
            </Typography>
            <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
              <Autocomplete
                options={recipeOptions}
                value={recipeOptions.find((o) => o.recipe.Id === selectedRecipe?.Id) ?? null}
                onChange={(_, v) => setSelectedRecipe(v?.recipe ?? null)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="搜索配方"
                    InputProps={{
                      ...params.InputProps,
                      startAdornment: (
                        <>
                          <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                          {params.InputProps.startAdornment}
                        </>
                      ),
                    }}
                  />
                )}
                sx={{ width: 320 }}
                noOptionsText="无匹配配方"
              />
              <TextField
                size="small"
                label="生产数量"
                type="number"
                value={addQty}
                onChange={(e) => setAddQty(Math.max(1, Number(e.target.value)))}
                inputProps={{ min: 1 }}
                sx={{ width: 120 }}
                InputProps={{ endAdornment: <InputAdornment position="end">台</InputAdornment> }}
              />
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={addRecipeToOrder}
                disabled={!selectedRecipe}
              >
                加入订单
              </Button>
            </Box>
          </Box>

          {/* 型号列表 */}
          {draftItems.length === 0 ? (
            <Box textAlign="center" py={3} color="text.secondary">
              请先添加型号
            </Box>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'grey.100' }}>
                    <TableCell>型号/配方名称</TableCell>
                    <TableCell>规格</TableCell>
                    <TableCell>零件数</TableCell>
                    <TableCell align="center">生产数量</TableCell>
                    <TableCell align="center">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {draftItems.map((item) => {
                    let partCount = 0;
                    try { partCount = (JSON.parse(item.partsJson) as RecipePart[]).length; } catch { /* */ }
                    return (
                      <TableRow key={item.id} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{item.recipeName}</TableCell>
                        <TableCell>{item.spec || '-'}</TableCell>
                        <TableCell>{partCount} 种</TableCell>
                        <TableCell align="center">
                          <TextField
                            size="small"
                            type="number"
                            value={item.qty}
                            onChange={(e) => updateItemQty(item.id, Number(e.target.value))}
                            inputProps={{ min: 1, style: { textAlign: 'center', width: 60 } }}
                            InputProps={{ endAdornment: <InputAdornment position="end">台</InputAdornment> }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Tooltip title="移除">
                            <IconButton size="small" color="error" onClick={() => removeItem(item.id)}>
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
        </Box>
      )}

      {/* ── Step 2: 预览采购清单 ── */}
      {!loading && activeStep === 2 && (
        <Box>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <Typography variant="subtitle1" fontWeight={700}>采购汇总清单</Typography>
            {needCount > 0 ? (
              <Chip
                icon={<WarningIcon />}
                label={`${needCount} 种零件需采购`}
                color="warning"
                size="small"
              />
            ) : (
              <Chip icon={<CheckIcon />} label="库存全部充足" color="success" size="small" />
            )}
          </Box>

          <TableContainer sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: 'grey.100' }}>
                  <TableCell>型号</TableCell>
                  <TableCell>名称</TableCell>
                  <TableCell>供应商</TableCell>
                  <TableCell align="right">需要总量</TableCell>
                  <TableCell align="right">当前库存</TableCell>
                  <TableCell align="right">需采购</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {purchaseList.map((p) => (
                  <TableRow
                    key={`${p.model}|${p.supplier}`}
                    sx={{
                      backgroundColor: p.needToBuy > 0
                        ? 'rgba(239,68,68,0.05)'
                        : 'rgba(34,197,94,0.03)',
                    }}
                  >
                    <TableCell>{p.model}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.supplier}</TableCell>
                    <TableCell align="right">{p.totalQty}</TableCell>
                    <TableCell align="right">{p.currentStock}</TableCell>
                    <TableCell align="right">
                      {p.needToBuy > 0 ? (
                        <Typography variant="body2" color="error.main" fontWeight={700}>
                          {p.needToBuy}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="success.main">✓</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {todos.length > 0 && (
            <>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle2" mb={1.5} color="warning.dark">
                📋 采购 To-Do（保存后可逐条打勾）
              </Typography>
              {todos.map((todo) => (
                <Box
                  key={todo.id}
                  sx={{
                    p: 1.5,
                    mb: 1,
                    borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: 'warning.light',
                    backgroundColor: 'rgba(251,191,36,0.06)',
                  }}
                >
                  <Typography variant="body2" fontWeight={500}>
                    ☐ {todo.description}
                  </Typography>
                </Box>
              ))}
            </>
          )}
        </Box>
      )}

      {/* ── Step 3: 确认提交 ── */}
      {!loading && activeStep === 3 && (
        <Box sx={{ maxWidth: 480 }}>
          <Alert severity="info" sx={{ mb: 2 }}>
            请确认订单信息，提交后会保存到本地，可在订单管理页查看。
          </Alert>
          <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Typography variant="body2" mb={1}><b>客户：</b>{customerName}</Typography>
            {contractNo && <Typography variant="body2" mb={1}><b>合同号：</b>{contractNo}</Typography>}
            {remark && <Typography variant="body2" mb={1}><b>备注：</b>{remark}</Typography>}
            <Typography variant="body2" mb={1}><b>型号数：</b>{draftItems.length} 个</Typography>
            <Typography variant="body2" mb={1}>
              <b>需采购零件：</b>
              {needCount > 0 ? (
                <Chip label={`${needCount} 种`} size="small" color="warning" sx={{ ml: 0.5 }} />
              ) : (
                <Chip label="库存充足" size="small" color="success" sx={{ ml: 0.5 }} />
              )}
            </Typography>
          </Box>
        </Box>
      )}

      {/* ── 导航按钮 ── */}
      {!loading && (
        <Box display="flex" justifyContent="space-between" mt={4}>
          <Button
            variant="outlined"
            startIcon={<BackIcon />}
            onClick={() => setActiveStep((s) => s - 1)}
            disabled={activeStep === 0}
          >
            上一步
          </Button>
          {activeStep < STEPS.length - 1 ? (
            <Button
              variant="contained"
              endIcon={<NextIcon />}
              onClick={() => setActiveStep((s) => s + 1)}
              disabled={!canNext()}
            >
              下一步
            </Button>
          ) : (
            <Button
              variant="contained"
              color="success"
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <CheckIcon />}
              onClick={handleSubmit}
              disabled={submitting}
            >
              提交订单
            </Button>
          )}
        </Box>
      )}
    </Paper>
  );
}
