import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Grid,
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
  Button,
  TextField,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  Card,
  CardContent,
  Switch,
  FormControlLabel,
  Collapse,
  InputAdornment,
  Fade,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Calculate as CalculateIcon,
  TrendingUp as TrendingUpIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  CurrencyExchange as CurrencyIcon,
  Cable as CableIcon,
  Save as SaveIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import PageHeader from '../components/PageHeader';
import { colors } from '../utils/theme';
import { useAppStore } from '../utils/store';

const API_BASE = '';

interface CoilRecord {
  Id: number;
  规格: string;
  单价: string;
  片数: string;
  默认线重: string;
  铜价基数: string;
  线圈加工费: string;
  转子加工费: string;
  成本: string;
  默认电容_uf: string | null;
  默认线径: string | null;
  CreatedAt?: string;
  UpdatedAt?: string;
}

interface CopperPriceInfo {
  livePrice: number;
  livePricePerKg: string;
  dbPrice: string;
  lastUpdate: string | null;
}

interface CalcResult {
  spec: string;
  sheets: number;
  unitPrice: number;
  wireWeight: number;
  copperBase: number;
  coilFee: number;
  rotorFee: number;
  wireGauge: string | null;
  capacitor: string | null;
  totalCost: number;
  formula: string;
  source: string;
  isCustomWireWeight: boolean;
}

interface CoilFormData {
  规格: string;
  单价: string;
  片数: string;
  默认线重: string;
  铜价基数: string;
  线圈加工费: string;
  转子加工费: string;
  默认电容_uf: string;
  默认线径: string;
}

const emptyForm: CoilFormData = {
  规格: '', 单价: '', 片数: '', 默认线重: '', 铜价基数: '',
  线圈加工费: '', 转子加工费: '', 默认电容_uf: '', 默认线径: ''
};

export default function CoilRotorPage() {
  const { showSnackbar } = useAppStore();
  const [coils, setCoils] = useState<CoilRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 铜价
  const [copperPrice, setCopperPrice] = useState<CopperPriceInfo | null>(null);
  const [copperLoading, setCopperLoading] = useState(false);
  const [copperUpdating, setCopperUpdating] = useState(false);

  // 表单弹窗
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<CoilFormData>(emptyForm);

  // 计算器
  const [calcSpec, setCalcSpec] = useState('');
  const [calcSheets, setCalcSheets] = useState('');
  const [calcWireWeight, setCalcWireWeight] = useState('');
  const [useCustomWireWeight, setUseCustomWireWeight] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  // 展开/折叠的规格分组
  const [expandedSpecs, setExpandedSpecs] = useState<Set<string>>(new Set());

  // 加载数据
  const loadCoils = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/coils`);
      const json = await res.json();
      if (json.success) {
        setCoils(json.data);
        // 默认展开所有规格
        const specs = new Set(json.data.map((c: CoilRecord) => c.规格));
        setExpandedSpecs(specs as Set<string>);
      } else {
        setError('加载线圈数据失败');
      }
    } catch (err) {
      setError('加载线圈数据失败: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCopperPrice = useCallback(async () => {
    try {
      setCopperLoading(true);
      const res = await fetch(`${API_BASE}/api/copper-price`);
      const json = await res.json();
      if (json.success) {
        setCopperPrice(json.data);
      }
    } catch (err) {
      console.error('获取铜价失败:', err);
    } finally {
      setCopperLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCoils();
    loadCopperPrice();
  }, [loadCoils, loadCopperPrice]);

  // 按规格分组
  const groupedCoils = useMemo(() => {
    const groups: Record<string, CoilRecord[]> = {};
    coils.forEach(c => {
      if (!groups[c.规格]) groups[c.规格] = [];
      groups[c.规格].push(c);
    });
    // 每组按片数排序
    Object.values(groups).forEach(g => g.sort((a, b) => parseInt(a.片数) - parseInt(b.片数)));
    return groups;
  }, [coils]);

  // 可用规格列表
  const specOptions = useMemo(() => Object.keys(groupedCoils).sort(), [groupedCoils]);

  // 切换展开
  const toggleSpec = (spec: string) => {
    setExpandedSpecs(prev => {
      const next = new Set(prev);
      if (next.has(spec)) next.delete(spec);
      else next.add(spec);
      return next;
    });
  };

  // 铜价更新
  const handleCopperUpdate = async () => {
    try {
      setCopperUpdating(true);
      const res = await fetch(`${API_BASE}/api/copper-price/update`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        showSnackbar(`铜价更新成功`, 'success');
        await loadCoils();
        await loadCopperPrice();
      } else {
        setError('铜价更新失败: ' + json.error);
      }
    } catch (err) {
      setError('铜价更新失败: ' + (err as Error).message);
    } finally {
      setCopperUpdating(false);
    }
  };

  // CRUD
  const handleAdd = () => {
    setEditingId(null);
    // 预填铜价基数
    setFormData({
      ...emptyForm,
      铜价基数: copperPrice?.dbPrice || copperPrice?.livePricePerKg || ''
    });
    setDialogOpen(true);
  };

  const handleEdit = (coil: CoilRecord) => {
    setEditingId(coil.Id);
    setFormData({
      规格: coil.规格 || '',
      单价: coil.单价 || '',
      片数: coil.片数 || '',
      默认线重: coil.默认线重 || '',
      铜价基数: coil.铜价基数 || '',
      线圈加工费: coil.线圈加工费 || '',
      转子加工费: coil.转子加工费 || '',
      默认电容_uf: coil.默认电容_uf || '',
      默认线径: coil.默认线径 || ''
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      const url = editingId
        ? `${API_BASE}/api/coils/${editingId}`
        : `${API_BASE}/api/coils`;
      const method = editingId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const json = await res.json();
      if (json.success) {
        showSnackbar(editingId ? '记录已保存' : '添加成功', 'success');
        setDialogOpen(false);
        await loadCoils();
      } else {
        setError(json.error || '保存失败');
      }
    } catch (err) {
      setError('保存失败: ' + (err as Error).message);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const handleDelete = (id: number) => {
    setDeleteTarget(id);
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    try {
      const res = await fetch(`${API_BASE}/api/coils/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        showSnackbar('记录已删除', 'info');
        await loadCoils();
      } else {
        setError('删除失败');
      }
    } catch (err) {
      setError('删除失败: ' + (err as Error).message);
    }
  };

  // 成本计算
  const handleCalculate = async () => {
    if (!calcSpec || !calcSheets) {
      setError('请选择规格并输入片数');
      return;
    }
    try {
      setCalcLoading(true);
      const body: Record<string, unknown> = {
        spec: calcSpec,
        sheets: parseInt(calcSheets)
      };
      if (useCustomWireWeight && calcWireWeight) {
        body.wireWeight = parseFloat(calcWireWeight);
      }
      const res = await fetch(`${API_BASE}/api/coils/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (json.success) {
        setCalcResult(json.data);
        showSnackbar(`成本计算完成: ¥${json.data.totalCost.toFixed(2)}`, 'success');
      } else {
        setError(json.error || '计算失败');
      }
    } catch (err) {
      setError('计算失败: ' + (err as Error).message);
    } finally {
      setCalcLoading(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="⚡ 线圈转子"
        subtitle="定子线圈成本试算与数据管理"
        actions={
          <Tooltip title="刷新数据">
            <span>
              <IconButton onClick={loadCoils} disabled={loading}>
                {loading ? <CircularProgress size={20} /> : <RefreshIcon />}
              </IconButton>
            </span>
          </Tooltip>
        }
      />

      {/* 通知 */}
      <Collapse in={!!error}>
        <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>
      </Collapse>

      <Grid container spacing={3}>

      {/* 铜价监控卡片 */}
      <Grid item xs={12}>
        <Paper sx={{
          p: 3, borderRadius: 3,
          bgcolor: colors.amber.bg,
          border: `1px solid ${colors.amber.border}`,
          borderLeft: `3px solid ${colors.amber.main}`,
          position: 'relative',
          overflow: 'hidden'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <CurrencyIcon sx={{ fontSize: 36, color: colors.amber.text }} />
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="subtitle2" sx={{ color: colors.amber.text, fontWeight: 600 }}>
                实时铜价监控
              </Typography>
              {copperLoading ? (
                <CircularProgress size={20} />
              ) : copperPrice ? (
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
                  <Typography variant="h4" sx={{ fontWeight: 800, color: 'text.primary' }}>
                    ¥{Number(copperPrice.livePrice).toLocaleString()}
                  </Typography>
                  <Typography variant="body2" sx={{ color: colors.amber.text }}>元/吨</Typography>
                  <Chip
                    label={`${copperPrice.livePricePerKg} 元/千克`}
                    size="small"
                    sx={{ bgcolor: colors.amber.main, color: 'white', fontWeight: 700 }}
                  />
                  <Divider orientation="vertical" flexItem sx={{ borderColor: colors.amber.border }} />
                  <Typography variant="body2" sx={{ color: colors.amber.text }}>
                    数据库铜价基数: <strong>{copperPrice.dbPrice}</strong> 元/千克
                  </Typography>
                  {copperPrice.dbPrice !== copperPrice.livePricePerKg && (
                    <Chip
                      icon={<TrendingUpIcon />}
                      label="需要同步"
                      size="small"
                      color="warning"
                      variant="outlined"
                    />
                  )}
                </Box>
              ) : (
                <Typography color="text.secondary">加载中...</Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="刷新铜价">
                <IconButton onClick={loadCopperPrice} sx={{ color: colors.amber.text }}>
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
              <Button
                variant="contained"
                startIcon={copperUpdating ? <CircularProgress size={16} color="inherit" /> : <CurrencyIcon />}
                onClick={handleCopperUpdate}
                disabled={copperUpdating}
                sx={{
                  bgcolor: 'primary.main',
                  '&:hover': { bgcolor: 'primary.dark' },
                  fontWeight: 700,
                  whiteSpace: 'nowrap'
                }}
              >
                {copperUpdating ? '更新中...' : '同步铜价到数据库'}
              </Button>
            </Box>
          </Box>
        </Paper>
      </Grid>

      {/* 左侧：成本计算器 */}
      <Grid item xs={12} md={4}>
        <Paper elevation={0} sx={{ p: 3, borderRadius: 3, position: 'sticky', top: 20 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <CalculateIcon color="primary" />
            <Typography variant="h6" color="primary" sx={{ fontWeight: 700 }}>
              成本试算
            </Typography>
          </Box>

          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>定子规格</InputLabel>
            <Select
              value={calcSpec}
              label="定子规格"
              onChange={e => setCalcSpec(e.target.value)}
            >
              {specOptions.map(spec => (
                <MenuItem key={spec} value={spec}>
                  规格 {spec} ({groupedCoils[spec]?.length}种片数)
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            fullWidth size="small" label="片数"
            type="number"
            value={calcSheets}
            onChange={e => setCalcSheets(e.target.value)}
            sx={{ mb: 2 }}
            helperText={calcSpec && groupedCoils[calcSpec] ?
              `可选: ${groupedCoils[calcSpec].map(c => c.片数).join(', ')} (其他片数自动插值)` : ''}
          />

          <FormControlLabel
            control={
              <Switch
                checked={useCustomWireWeight}
                onChange={e => setUseCustomWireWeight(e.target.checked)}
                size="small"
              />
            }
            label={<Typography variant="body2">客户指定线重</Typography>}
            sx={{ mb: 1 }}
          />

          <Collapse in={useCustomWireWeight}>
            <TextField
              fullWidth size="small" label="客户线重"
              type="number"
              value={calcWireWeight}
              onChange={e => setCalcWireWeight(e.target.value)}
              sx={{ mb: 2 }}
              InputProps={{
                endAdornment: <InputAdornment position="end">kg</InputAdornment>
              }}
            />
          </Collapse>

          <Button
            fullWidth variant="contained"
            startIcon={calcLoading ? <CircularProgress size={16} color="inherit" /> : <CalculateIcon />}
            onClick={handleCalculate}
            disabled={calcLoading || !calcSpec || !calcSheets}
            sx={{ mb: 2, fontWeight: 700 }}
          >
            计算成本
          </Button>

          {/* 计算结果 */}
          {calcResult && (
            <Card variant="outlined" sx={{
              bgcolor: colors.green.bg,
              border: '1px solid #86efac',
              animation: 'fadeIn 0.3s ease'
            }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" color="success.dark">计算结果</Typography>
                  <Chip
                    label={calcResult.source}
                    size="small"
                    color={calcResult.source === '精确匹配' ? 'success' : 'info'}
                    variant="outlined"
                  />
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 800, color: colors.green.text, mb: 1 }}>
                  ¥{calcResult.totalCost.toFixed(2)}
                </Typography>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" component="div" sx={{
                  fontFamily: 'monospace',
                  bgcolor: colors.slate.bg,
                  p: 1,
                  borderRadius: 1,
                  lineHeight: 1.8,
                  fontSize: '0.75rem'
                }}>
                  <Box component="span" sx={{ color: 'primary.main' }}>单价</Box> {calcResult.unitPrice} × <Box component="span" sx={{ color: 'primary.main' }}>片数</Box> {calcResult.sheets} = {(calcResult.unitPrice * calcResult.sheets).toFixed(2)}<br />
                  <Box component="span" sx={{ color: 'primary.main' }}>线重</Box> {calcResult.wireWeight} × <Box component="span" sx={{ color: 'primary.main' }}>铜价</Box> {calcResult.copperBase} = {(calcResult.wireWeight * calcResult.copperBase).toFixed(2)}
                  {calcResult.isCustomWireWeight && <Chip label="客户指定" size="small" sx={{ ml: 0.5, height: 16, fontSize: '0.65rem' }} color="warning" />}<br />
                  <Box component="span" sx={{ color: 'text.secondary' }}>线圈加工费</Box>: {calcResult.coilFee}<br />
                  <Box component="span" sx={{ color: 'text.secondary' }}>转子加工费</Box>: {calcResult.rotorFee}
                </Typography>
                {calcResult.wireGauge && (
                  <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>
                    默认线径: {calcResult.wireGauge}
                    {calcResult.capacitor && ` | 默认电容: ${calcResult.capacitor}μF`}
                  </Typography>
                )}
              </CardContent>
            </Card>
          )}
        </Paper>
      </Grid>

      {/* 右侧：线圈数据管理 */}
      <Grid item xs={12} md={8}>
        <Paper elevation={0} sx={{ p: 3, borderRadius: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <CableIcon sx={{ mr: 1, color: colors.purple.main }} />
            <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700, color: colors.purple.main }}>
              线圈转子数据管理
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleAdd}
              size="small"
              sx={{ ml: 1, fontWeight: 600 }}
            >
              新增记录
            </Button>
          </Box>

          {/* 按规格分组显示 */}
          {Object.entries(groupedCoils).sort(([a], [b]) => a.localeCompare(b)).map(([spec, records], idx) => (
            <Fade key={spec} in timeout={300 + idx * 100}>
              <Box sx={{ mb: 2 }}>
              <Box
                onClick={() => toggleSpec(spec)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: colors.slate.light,
                  '&:hover': { bgcolor: colors.slate.hover },
                  transition: 'background 0.2s'
                }}
              >
                {expandedSpecs.has(spec) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                <Typography variant="subtitle1" sx={{ fontWeight: 700, ml: 1, flexGrow: 1 }}>
                  规格 {spec}
                </Typography>
                <Chip label={`单价 ¥${records[0].单价}`} size="small" variant="outlined" sx={{ mr: 1 }} />
                <Chip label={`${records.length} 种片数`} size="small" color="primary" variant="outlined" />
              </Box>

              <Collapse in={expandedSpecs.has(spec)}>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>片数</TableCell>
                        <TableCell>默认线重</TableCell>
                        <TableCell>铜价基数</TableCell>
                        <TableCell>线圈加工费</TableCell>
                        <TableCell>转子加工费</TableCell>
                        <TableCell>成本</TableCell>
                        <TableCell>线径</TableCell>
                        <TableCell>电容</TableCell>
                        <TableCell align="right">操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {records.map(coil => (
                        <TableRow key={coil.Id} hover sx={{
                          '&:hover': { bgcolor: colors.purple.bg }
                        }}>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {coil.片数}
                            </Typography>
                          </TableCell>
                          <TableCell>{coil.默认线重} kg</TableCell>
                          <TableCell>{coil.铜价基数}</TableCell>
                          <TableCell>¥{coil.线圈加工费}</TableCell>
                          <TableCell>¥{coil.转子加工费}</TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 700, color: colors.green.dark }}>
                              ¥{parseFloat(coil.成本).toFixed(2)}
                            </Typography>
                          </TableCell>
                          <TableCell>{coil.默认线径 || '-'}</TableCell>
                          <TableCell>{coil.默认电容_uf ? `${coil.默认电容_uf}μF` : '-'}</TableCell>
                          <TableCell align="right">
                            <IconButton size="small" onClick={() => handleEdit(coil)} color="primary">
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" onClick={() => handleDelete(coil.Id)} color="error">
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Collapse>
            </Box>
            </Fade>
          ))}

          {coils.length === 0 && !loading && (
            <Box sx={{ textAlign: 'center', py: 6, color: 'text.disabled' }}>
              <CableIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
              <Typography>暂无线圈数据</Typography>
            </Box>
          )}
        </Paper>
      </Grid>

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {editingId ? '编辑线圈记录' : '新增线圈记录'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={6}>
              <TextField
                fullWidth size="small" label="规格 *"
                value={formData.规格}
                onChange={e => setFormData(p => ({ ...p, 规格: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth size="small" label="片数 *"
                type="number"
                value={formData.片数}
                onChange={e => setFormData(p => ({ ...p, 片数: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth size="small" label="单价"
                type="number"
                value={formData.单价}
                onChange={e => setFormData(p => ({ ...p, 单价: e.target.value }))}
                InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth size="small" label="默认线重"
                type="number"
                value={formData.默认线重}
                onChange={e => setFormData(p => ({ ...p, 默认线重: e.target.value }))}
                InputProps={{ endAdornment: <InputAdornment position="end">kg</InputAdornment> }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth size="small" label="铜价基数"
                type="number"
                value={formData.铜价基数}
                onChange={e => setFormData(p => ({ ...p, 铜价基数: e.target.value }))}
                InputProps={{ endAdornment: <InputAdornment position="end">元/千克</InputAdornment> }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth size="small" label="线圈加工费"
                type="number"
                value={formData.线圈加工费}
                onChange={e => setFormData(p => ({ ...p, 线圈加工费: e.target.value }))}
                InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth size="small" label="转子加工费"
                type="number"
                value={formData.转子加工费}
                onChange={e => setFormData(p => ({ ...p, 转子加工费: e.target.value }))}
                InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth size="small" label="默认线径"
                value={formData.默认线径}
                onChange={e => setFormData(p => ({ ...p, 默认线径: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth size="small" label="默认电容 (μF)"
                type="number"
                value={formData.默认电容_uf}
                onChange={e => setFormData(p => ({ ...p, 默认电容_uf: e.target.value }))}
                InputProps={{ endAdornment: <InputAdornment position="end">μF</InputAdornment> }}
              />
            </Grid>
          </Grid>

          {/* 实时成本预览 */}
          {formData.单价 && formData.片数 && (
            <Box sx={{ mt: 2, p: 1.5, bgcolor: colors.green.bg, borderRadius: 1, border: `1px solid ${colors.green.border}` }}>
              <Typography variant="caption" color="success.dark">
                预估成本: ¥{(
                  parseFloat(formData.单价 || '0') * parseInt(formData.片数 || '0') +
                  parseFloat(formData.默认线重 || '0') * parseFloat(formData.铜价基数 || '0') +
                  parseFloat(formData.线圈加工费 || '0') +
                  parseFloat(formData.转子加工费 || '0')
                ).toFixed(2)}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} startIcon={<CloseIcon />}>取消</Button>
          <Button variant="contained" onClick={handleSave} startIcon={<SaveIcon />} sx={{ fontWeight: 600 }}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>删除线圈记录</DialogTitle>
        <DialogContent>
          <DialogContentText>确定要删除这条线圈记录吗？此操作不可撤销。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button onClick={confirmDelete} color="error" variant="contained">删除</Button>
        </DialogActions>
      </Dialog>
      </Grid>
    </Box>
  );
}
