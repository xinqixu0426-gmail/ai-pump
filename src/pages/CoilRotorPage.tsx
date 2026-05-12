import { useState, useEffect, useMemo } from 'react';
import {
  Grid, Paper, Typography, Alert, Box, CircularProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Button, TextField, Chip, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  FormControl, InputLabel, Select, MenuItem, Divider, Card, CardContent,
  Switch, FormControlLabel, Collapse, InputAdornment, Fade, Autocomplete
} from '@mui/material';
import {
  Plus as AddIcon, Edit3 as EditIcon, Trash2 as DeleteIcon, RefreshCw as RefreshIcon,
  Calculator as CalculateIcon, TrendingUp as TrendingUpIcon,
  ChevronDown as ExpandMoreIcon, ChevronUp as ExpandLessIcon,
  CircleDollarSign as CurrencyIcon, Cable as CableIcon, Save as SaveIcon, X as CloseIcon
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { colors } from '../utils/theme';
import { useAppStore } from '../utils/store';
import { useCoilForm, CoilRecord, DEFAULT_COIL_MATERIAL, MATERIAL_UNIT_PRICE_DEFAULTS, coilGroupKey, splitCoilGroupKey } from '../hooks/useCoilForm';
import { proxyRequest } from '../utils/api';

interface CalcResult {
  spec: string;
  material: string;
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

export default function CoilRotorPage() {
  const { showSnackbar } = useAppStore();
  const {
    coils, loading, error, setError,
    copperPrice, copperLoading, copperUpdating, handleCopperUpdate,
    groupedCoils, expandedSpecs, setExpandedSpecs, loadCoils, loadCopperPrice,
    dialogOpen, setDialogOpen, editingId, formData, setFormData,
    deleteTarget, setDeleteTarget, handleAdd, handleEdit, handleSave, confirmDelete,
    autoFillFromSpec, updateSpecPrice
  } = useCoilForm();

  // 规格级单价编辑状态
  const [editingSpec, setEditingSpec] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState('');

  const [calcSpec, setCalcSpec] = useState('');
  const [calcMaterial, setCalcMaterial] = useState(DEFAULT_COIL_MATERIAL);
  const [calcSheets, setCalcSheets] = useState('');
  const [calcWireWeight, setCalcWireWeight] = useState('');
  const [useCustomWireWeight, setUseCustomWireWeight] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  useEffect(() => { loadCoils(); loadCopperPrice(); }, [loadCoils, loadCopperPrice]);

  const specOptions = useMemo(() => Array.from(new Set(coils.map(c => c.spec))).sort(), [coils]);
  const materialOptions = useMemo(() => {
    const values = Array.from(new Set([DEFAULT_COIL_MATERIAL, '冷轧800', ...coils.map(c => c.material || DEFAULT_COIL_MATERIAL)]));
    return values.filter(Boolean);
  }, [coils]);
  const calcMaterialOptions = useMemo(() => {
    if (!calcSpec) return materialOptions;
    const values = Array.from(new Set(coils.filter(c => c.spec === calcSpec).map(c => c.material || DEFAULT_COIL_MATERIAL)));
    return values.length > 0 ? values : materialOptions;
  }, [calcSpec, coils, materialOptions]);
  const calcRecords = useMemo(() => (
    calcSpec ? coils.filter(c => c.spec === calcSpec && (c.material || DEFAULT_COIL_MATERIAL) === calcMaterial) : []
  ), [calcMaterial, calcSpec, coils]);

  useEffect(() => {
    if (!calcSpec || calcMaterialOptions.includes(calcMaterial)) return;
    setCalcMaterial(calcMaterialOptions[0] || DEFAULT_COIL_MATERIAL);
  }, [calcMaterial, calcMaterialOptions, calcSpec]);

  const toggleSpec = (spec: string) => {
    setExpandedSpecs(prev => {
      const next = new Set(prev);
      if (next.has(spec)) next.delete(spec); else next.add(spec);
      return next;
    });
  };

  const selectSpec = (spec: string, material = calcMaterial) => {
    setCalcSpec(spec);
    const availableMaterials = Array.from(new Set(coils.filter(c => c.spec === spec).map(c => c.material || DEFAULT_COIL_MATERIAL)));
    const nextMaterial = availableMaterials.includes(material) ? material : (availableMaterials[0] || material || DEFAULT_COIL_MATERIAL);
    setCalcMaterial(nextMaterial);
    setExpandedSpecs(prev => new Set([...prev, coilGroupKey(spec, nextMaterial)]));
  };

  const handleCalculate = async () => {
    if (!calcSpec || !calcSheets) { setError('请选择规格并输入片数'); return; }
    try {
      setCalcLoading(true);
      const body: Record<string, unknown> = { spec: calcSpec, material: calcMaterial, sheets: parseInt(calcSheets) };
      if (useCustomWireWeight && calcWireWeight) body.wireWeight = parseFloat(calcWireWeight);
      const json = await proxyRequest<{ success: boolean; data: CalcResult; error?: string }>('/api/coils/calculate', {
        method: 'POST', body: JSON.stringify(body)
      });
      if (json.success) {
        setCalcResult(json.data); showSnackbar(`成本计算完成: ¥${json.data.totalCost.toFixed(2)}`, 'success');
      } else setError(json.error || '计算失败');
    } catch (err) { setError('计算失败: ' + (err as Error).message); }
    finally { setCalcLoading(false); }
  };

  return (
    <Box>
      <PageHeader
        title="线圈转子" subtitle="定子线圈成本试算与数据管理"
        actions={<Tooltip title="刷新数据"><span><IconButton aria-label="刷新数据" onClick={loadCoils} disabled={loading}>{loading ? <CircularProgress size={20} /> : <RefreshIcon size={20} />}</IconButton></span></Tooltip>}
      />

      <Collapse in={!!error}><Alert severity="error" onClose={() => setError('')} sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert></Collapse>

      <Grid container spacing={3}>
      <Grid item xs={12}>
        <Paper sx={{ p: 3, borderRadius: 3, bgcolor: colors.amber.bg, border: `1px solid ${colors.amber.border}`, borderLeft: `3px solid ${colors.amber.main}`, position: 'relative', overflow: 'hidden' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <CurrencyIcon size={36} color={colors.amber.text} />
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="subtitle2" sx={{ color: colors.amber.text, fontWeight: 600 }}>实时铜价监控</Typography>
              {copperLoading ? <CircularProgress size={20} /> : copperPrice ? (
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
                  <Typography variant="h4" sx={{ fontWeight: 700, color: 'text.primary' }}>¥{Number(copperPrice.livePrice).toLocaleString()}</Typography>
                  <Typography variant="body2" sx={{ color: colors.amber.text }}>元/吨</Typography>
                  <Chip label={`${copperPrice.livePricePerKg} 元/千克`} size="small" sx={{ bgcolor: colors.amber.main, color: 'white', fontWeight: 700 }} />
                  <Divider orientation="vertical" flexItem sx={{ borderColor: colors.amber.border }} />
                  <Typography variant="body2" sx={{ color: colors.amber.text }}>数据库铜价基数: <strong>{copperPrice.dbPrice}</strong> 元/千克</Typography>
                  {copperPrice.dbPrice !== copperPrice.livePricePerKg && <Chip icon={<TrendingUpIcon size={16} />} label="需要同步" size="small" color="warning" variant="outlined" />}
                </Box>
              ) : <Typography color="text.secondary">加载中...</Typography>}
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="刷新铜价"><IconButton aria-label="刷新铜价" onClick={loadCopperPrice} sx={{ color: colors.amber.text }}><RefreshIcon size={20} /></IconButton></Tooltip>
              <Button variant="contained" startIcon={copperUpdating ? <CircularProgress size={16} color="inherit" /> : <CurrencyIcon size={20} />} onClick={handleCopperUpdate} disabled={copperUpdating} sx={{ bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' }, fontWeight: 700, whiteSpace: 'nowrap' }}>
                {copperUpdating ? '更新中...' : '同步铜价到数据库'}
              </Button>
            </Box>
          </Box>
        </Paper>
      </Grid>

      <Grid item xs={12} md={4}>
        <Paper elevation={0} sx={{ p: 3, borderRadius: 3, position: 'sticky', top: 20 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <CalculateIcon size={24} color="#2563eb" />
            <Typography variant="h6" color="primary" sx={{ fontWeight: 700 }}>成本试算</Typography>
          </Box>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>定子规格</InputLabel>
            <Select value={calcSpec} label="定子规格" onChange={e => selectSpec(e.target.value)}>
              {specOptions.map(spec => (
                <MenuItem key={spec} value={spec}>规格 {spec}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>材质</InputLabel>
            <Select value={calcMaterial} label="材质" onChange={e => setCalcMaterial(e.target.value)}>
              {calcMaterialOptions.map(material => (
                <MenuItem key={material} value={material}>{material}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {specOptions.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }}>
              {specOptions.map(spec => (
                <Chip
                  key={spec}
                  label={`${spec}规格`}
                  clickable
                  size="small"
                  color={calcSpec === spec ? 'primary' : 'default'}
                  variant={calcSpec === spec ? 'filled' : 'outlined'}
                  onClick={() => selectSpec(spec)}
                  sx={{ fontWeight: 700 }}
                />
              ))}
            </Box>
          )}

          <TextField
            fullWidth size="small" label="片数" type="number" value={calcSheets} onChange={e => setCalcSheets(e.target.value)} 
            sx={{ mb: 2, '& .MuiOutlinedInput-root.Mui-focused fieldset': { borderColor: '#7c3aed', borderWidth: 2 } }}
            helperText={calcRecords.length ? `可选: ${calcRecords.map(c => c.sheets).join(', ')} (其他片数自动插值)` : ''}
          />
          <FormControlLabel
            control={<Switch checked={useCustomWireWeight} onChange={e => setUseCustomWireWeight(e.target.checked)} size="small" />}
            label={<Typography variant="body2">客户指定线重</Typography>} sx={{ mb: 1 }}
          />
          <Collapse in={useCustomWireWeight}>
            <TextField fullWidth size="small" label="客户线重" type="number" value={calcWireWeight} onChange={e => setCalcWireWeight(e.target.value)} sx={{ mb: 2, '& .MuiOutlinedInput-root.Mui-focused fieldset': { borderColor: '#7c3aed', borderWidth: 2 } }} InputProps={{ endAdornment: <InputAdornment position="end">kg</InputAdornment> }} />
          </Collapse>
          <Tooltip title={!calcSpec ? "请先选择定子规格" : !calcSheets ? "请输入片数" : ""}>
            <span>
              <Button fullWidth variant="contained" startIcon={calcLoading ? <CircularProgress size={16} color="inherit" /> : <CalculateIcon size={20} />} onClick={handleCalculate} disabled={calcLoading || !calcSpec || !calcSheets} sx={{ mb: 2, fontWeight: 700 }}>计算成本</Button>
            </span>
          </Tooltip>

          {calcResult && (
            <Card variant="outlined" sx={{ bgcolor: colors.green.bg, border: '1px solid #86efac', animation: 'fadeIn 0.3s ease' }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" color="success.dark">计算结果 · {calcResult.material || calcMaterial}</Typography>
                  <Chip label={calcResult.source} size="small" color={calcResult.source === '精确匹配' ? 'success' : 'info'} variant="outlined" />
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 700, color: colors.green.text, mb: 1 }}>¥{calcResult.totalCost.toFixed(2)}</Typography>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" component="div" sx={{ fontFamily: 'monospace', bgcolor: colors.slate.bg, p: 1, borderRadius: 1, lineHeight: 1.8, fontSize: '0.75rem' }}>
                  <Box component="span" sx={{ color: 'primary.main' }}>单价</Box> {calcResult.unitPrice} × <Box component="span" sx={{ color: 'primary.main' }}>片数</Box> {calcResult.sheets} = {(calcResult.unitPrice * calcResult.sheets).toFixed(2)}<br />
                  <Box component="span" sx={{ color: 'primary.main' }}>线重</Box> {calcResult.wireWeight} × <Box component="span" sx={{ color: 'primary.main' }}>铜价</Box> {calcResult.copperBase} = {(calcResult.wireWeight * calcResult.copperBase).toFixed(2)}
                  {calcResult.isCustomWireWeight && <Chip label="客户指定" size="small" sx={{ ml: 0.5, height: 16, fontSize: '0.65rem' }} color="warning" />}<br />
                  <Box component="span" sx={{ color: 'text.secondary' }}>线圈加工费</Box>: {calcResult.coilFee}<br />
                  <Box component="span" sx={{ color: 'text.secondary' }}>转子加工费</Box>: {calcResult.rotorFee}
                </Typography>
                {calcResult.wireGauge && (
                  <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>默认线径: {calcResult.wireGauge}{calcResult.capacitor && ` | 默认电容: ${calcResult.capacitor}μF`}</Typography>
                )}
              </CardContent>
            </Card>
          )}
        </Paper>
      </Grid>

      <Grid item xs={12} md={8}>
        <Paper elevation={0} sx={{ p: 3, borderRadius: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <CableIcon size={24} color={colors.purple.main} style={{ marginRight: 8 }} />
            <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700, color: colors.purple.main }}>线圈转子数据管理</Typography>
            <Button variant="contained" startIcon={<AddIcon size={18} />} onClick={handleAdd} size="small" sx={{ ml: 1, fontWeight: 600 }}>新增记录</Button>
          </Box>

          {specOptions.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }}>
              {specOptions.map(spec => (
                <Chip
                  key={spec}
                  label={`规格 ${spec}`}
                  clickable
                  color={calcSpec === spec ? 'secondary' : 'default'}
                  variant={calcSpec === spec ? 'filled' : 'outlined'}
                  onClick={() => selectSpec(spec)}
                  sx={{ fontWeight: 700 }}
                />
              ))}
            </Box>
          )}

          {Object.entries(groupedCoils).sort(([a], [b]) => a.localeCompare(b)).map(([groupKey, records], idx) => {
            const { spec, material } = splitCoilGroupKey(groupKey);
            return (
            <Fade key={groupKey} in timeout={300 + idx * 100}>
              <Box sx={{ mb: 2 }}>
              <Box onClick={() => toggleSpec(groupKey)} sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', p: 1.5, borderRadius: 1, bgcolor: colors.slate.light, '&:hover': { bgcolor: colors.slate.hover }, transition: 'background 0.2s' }}>
                {expandedSpecs.has(groupKey) ? <ExpandLessIcon size={20} /> : <ExpandMoreIcon size={20} />}
                <Typography variant="subtitle1" sx={{ fontWeight: 700, ml: 1, flexGrow: 1 }}>规格 {spec} · {material}</Typography>
                {editingSpec === groupKey ? (
                  <Box onClick={e => e.stopPropagation()} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <TextField
                      size="small" type="number" value={editingPrice}
                      onChange={e => setEditingPrice(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { updateSpecPrice(spec, material, editingPrice); setEditingSpec(null); } if (e.key === 'Escape') setEditingSpec(null); }}
                      autoFocus sx={{ width: 100 }}
                      InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
                    />
                    <IconButton size="small" color="primary" aria-label="保存规格材质单价" onClick={() => { updateSpecPrice(spec, material, editingPrice); setEditingSpec(null); }}><SaveIcon size={16} /></IconButton>
                    <IconButton size="small" aria-label="取消编辑规格单价" onClick={() => setEditingSpec(null)}><CloseIcon size={16} /></IconButton>
                  </Box>
                ) : (
                  <Chip
                    label={`单价 ¥${records[0].unitPrice}`} size="small" variant="outlined"
                    onClick={e => { e.stopPropagation(); setEditingSpec(groupKey); setEditingPrice(records[0].unitPrice); }}
                    onDelete={() => { setEditingSpec(groupKey); setEditingPrice(records[0].unitPrice); }}
                    deleteIcon={<EditIcon size={14} />}
                    sx={{ mr: 1, cursor: 'pointer' }}
                  />
                )}
                <Chip label={`${records.length} 种片数`} size="small" color="primary" variant="outlined" />
              </Box>
              <Collapse in={expandedSpecs.has(groupKey)}>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>片数</TableCell><TableCell>默认线重</TableCell><TableCell>铜价基数</TableCell>
                        <TableCell>线圈加工费</TableCell><TableCell>转子加工费</TableCell><TableCell>成本</TableCell>
                        <TableCell>线径</TableCell><TableCell>电容</TableCell><TableCell align="right">操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {records.map((coil: CoilRecord) => (
                        <TableRow key={coil.Id} hover sx={{ '&:hover': { bgcolor: colors.purple.bg } }}>
                          <TableCell><Typography variant="body2" sx={{ fontWeight: 700 }}>{coil.sheets}</Typography></TableCell>
                          <TableCell>{coil.wireWeight} kg</TableCell><TableCell>{coil.copperBase}</TableCell>
                          <TableCell>¥{coil.coilFee}</TableCell><TableCell>¥{coil.rotorFee}</TableCell>
                          <TableCell><Typography variant="body2" sx={{ fontWeight: 700, color: colors.green.dark }}>¥{parseFloat(coil.cost).toFixed(2)}</Typography></TableCell>
                          <TableCell>{coil.defaultWireGauge || '-'}</TableCell><TableCell>{coil.defaultCapacitor ? `${coil.defaultCapacitor}μF` : '-'}</TableCell>
                          <TableCell align="right">
                            <IconButton size="small" aria-label="编辑线圈记录" onClick={() => handleEdit(coil)} color="primary"><EditIcon size={18} /></IconButton>
                            <IconButton size="small" aria-label="删除线圈记录" onClick={() => setDeleteTarget(coil.Id)} color="error"><DeleteIcon size={18} /></IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Collapse>
            </Box>
            </Fade>
          );})}
          {coils.length === 0 && !loading && (
            <Box sx={{ textAlign: 'center', py: 6, color: 'text.disabled' }}>
              <CableIcon size={48} style={{ marginBottom: 8, opacity: 0.3 }} />
              <Typography>暂无线圈数据</Typography>
            </Box>
          )}
        </Paper>
      </Grid>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{editingId ? '编辑线圈记录' : '新增线圈记录'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={6}>
              <Autocomplete
                freeSolo options={specOptions} value={formData.spec}
                onChange={(_e, v) => { const val = v || ''; setFormData(p => ({ ...p, spec: val })); if (!editingId) autoFillFromSpec(val, formData.material); }}
                onInputChange={(_e, v) => { setFormData(p => ({ ...p, spec: v })); }}
                onBlur={() => { if (!editingId && formData.spec) autoFillFromSpec(formData.spec, formData.material); }}
                renderInput={(params) => <TextField {...params} fullWidth size="small" label="规格 *" />}
              />
            </Grid>
            <Grid item xs={6}>
              <Autocomplete
                freeSolo options={materialOptions} value={formData.material || DEFAULT_COIL_MATERIAL}
                onChange={(_e, v) => {
                  const val = v || DEFAULT_COIL_MATERIAL;
                  setFormData(p => ({ ...p, material: val, unitPrice: !editingId ? (MATERIAL_UNIT_PRICE_DEFAULTS[val] || p.unitPrice) : p.unitPrice }));
                  if (!editingId && formData.spec) autoFillFromSpec(formData.spec, val);
                }}
                onInputChange={(_e, v) => { const val = v || DEFAULT_COIL_MATERIAL; setFormData(p => ({ ...p, material: val, unitPrice: !editingId ? (MATERIAL_UNIT_PRICE_DEFAULTS[val] || p.unitPrice) : p.unitPrice })); }}
                renderInput={(params) => <TextField {...params} fullWidth size="small" label="材质 *" />}
              />
            </Grid>
            <Grid item xs={6}><TextField fullWidth size="small" label="片数 *" type="number" value={formData.sheets} onChange={e => setFormData(p => ({ ...p, sheets: e.target.value }))} /></Grid>
            <Grid item xs={6}>
              <TextField fullWidth size="small" label="单价" type="number" value={formData.unitPrice}
                onChange={e => setFormData(p => ({ ...p, unitPrice: e.target.value }))}
                InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
                disabled={!!editingId}
                helperText={editingId ? '请在规格+材质组头部统一修改' : ''}
              />
            </Grid>
            <Grid item xs={6}><TextField fullWidth size="small" label="默认线重" type="number" value={formData.wireWeight} onChange={e => setFormData(p => ({ ...p, wireWeight: e.target.value }))} InputProps={{ endAdornment: <InputAdornment position="end">kg</InputAdornment> }} /></Grid>
            <Grid item xs={6}><TextField fullWidth size="small" label="铜价基数" type="number" value={formData.copperBase} onChange={e => setFormData(p => ({ ...p, copperBase: e.target.value }))} InputProps={{ endAdornment: <InputAdornment position="end">元/千克</InputAdornment> }} /></Grid>
            <Grid item xs={6}><TextField fullWidth size="small" label="线圈加工费" type="number" value={formData.coilFee} onChange={e => setFormData(p => ({ ...p, coilFee: e.target.value }))} InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }} /></Grid>
            <Grid item xs={6}><TextField fullWidth size="small" label="转子加工费" type="number" value={formData.rotorFee} onChange={e => setFormData(p => ({ ...p, rotorFee: e.target.value }))} InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }} /></Grid>
            <Grid item xs={6}><TextField fullWidth size="small" label="默认线径" value={formData.defaultWireGauge} onChange={e => setFormData(p => ({ ...p, defaultWireGauge: e.target.value }))} /></Grid>
            <Grid item xs={6}><TextField fullWidth size="small" label="默认电容 (μF)" type="number" value={formData.defaultCapacitor} onChange={e => setFormData(p => ({ ...p, defaultCapacitor: e.target.value }))} InputProps={{ endAdornment: <InputAdornment position="end">μF</InputAdornment> }} /></Grid>
          </Grid>
          {formData.unitPrice && formData.sheets && (
            <Box sx={{ mt: 2, p: 1.5, bgcolor: colors.green.bg, borderRadius: 1, border: `1px solid ${colors.green.border}` }}>
              <Typography variant="caption" color="success.dark">
                预估成本: ¥{(parseFloat(formData.unitPrice || '0') * parseInt(formData.sheets || '0') + parseFloat(formData.wireWeight || '0') * parseFloat(formData.copperBase || '0') + parseFloat(formData.coilFee || '0') + parseFloat(formData.rotorFee || '0')).toFixed(2)}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} startIcon={<CloseIcon size={20} />}>取消</Button>
          <Button variant="contained" onClick={handleSave} startIcon={<SaveIcon size={20} />} sx={{ fontWeight: 600 }}>保存</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>删除线圈记录</DialogTitle>
        <DialogContent><DialogContentText>确定要删除这条线圈记录吗？此操作不可撤销。</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button onClick={confirmDelete} color="error" variant="contained">删除</Button>
        </DialogActions>
      </Dialog>
      </Grid>
    </Box>
  );
}
