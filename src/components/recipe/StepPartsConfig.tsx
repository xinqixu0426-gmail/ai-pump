import {
  Box,
  TextField,
  Paper,
  Typography,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  FormControlLabel,
  Checkbox,
  CircularProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Divider,
  Autocomplete
} from '@mui/material';
import { Cable as CableIcon, Add as AddIcon, NavigateNext as NextIcon, NavigateBefore as PrevIcon } from '@mui/icons-material';
import { colors } from '../../utils/theme';
import { Part, PartSelection } from '../../types';
import RecipePartRow from '../RecipePartRow';
import { CoilSpecInfo, CoilCalcResult } from './recipeFormConstants';

interface StepPartsConfigProps {
  coilSpecs: CoilSpecInfo[];
  coilSpec: string;
  setCoilSpec: (val: string) => void;
  coilSheets: string;
  setCoilSheets: (val: string) => void;
  useCoilCustomWeight: boolean;
  setUseCoilCustomWeight: (val: boolean) => void;
  coilCustomWireWeight: string;
  setCoilCustomWireWeight: (val: string) => void;
  coilResult: CoilCalcResult | null;
  coilLoading: boolean;

  optionalParts: Array<PartSelection & { id: number }>;
  handleAddOptional: () => void;
  handleOptionalChange: (id: number, field: keyof PartSelection, value: string | number) => void;
  handleRemoveOptional: (id: number) => void;

  hasFloat: boolean;
  setHasFloat: (val: boolean) => void;
  floatWire: string;
  setFloatWire: (val: string) => void;

  hasCable: boolean;
  setHasCable: (val: boolean) => void;
  cableLength: string;
  setCableLength: (val: string) => void;
  cableWire: string;
  setCableWire: (val: string) => void;

  boxType: string;
  setBoxType: (val: string) => void;

  parts: Part[];
  getPriceByModelAndSupplier: (model: string, supplier: string) => number;
  getSuppliersByModel: (model: string) => string[];
  getModelsByCategory: (category: string) => string[];
  
  onPrev: () => void;
  onNext: () => void;
}

export default function StepPartsConfig({
  coilSpecs, coilSpec, setCoilSpec, coilSheets, setCoilSheets,
  useCoilCustomWeight, setUseCoilCustomWeight, coilCustomWireWeight, setCoilCustomWireWeight,
  coilResult, coilLoading,
  optionalParts, handleAddOptional, handleOptionalChange, handleRemoveOptional,
  hasFloat, setHasFloat, floatWire, setFloatWire,
  hasCable, setHasCable, cableLength, setCableLength, cableWire, setCableWire,
  boxType, setBoxType,
  parts, getPriceByModelAndSupplier, getSuppliersByModel, getModelsByCategory,
  onPrev, onNext
}: StepPartsConfigProps) {

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

  const getWireOptions = (prefix: string): string[] => {
    const wires = new Set<string>(['0.35', '0.40', '0.45', '0.50', '0.55', '0.60', '0.65', '0.70', '0.75', '0.80', '0.85', '0.90', '0.95', '1.00', '1.18', '1.50', '2.50', '4.00']);
    parts.forEach((p) => {
      const m = p.model;
      if (m.startsWith(prefix)) { const w = m.replace(prefix, ''); if (w) wires.add(w); }
    });
    return Array.from(wires).sort((a, b) => parseFloat(a) - parseFloat(b));
  };

  const resolveBoxType = (keyword: string): { model: string; price: number } => {
    const k = (keyword || '').trim();
    if (!k) return { model: '', price: 0 };
    const exactPrice = getPriceByModelAndSupplier(k, '');
    if (exactPrice > 0) return { model: k, price: exactPrice };
    const candidates = parts
      .filter((p) => p.category === '包装' && p.model.includes(k))
      .map((p) => ({ model: p.model, price: p.price }));
    if (candidates.length > 0) return candidates.reduce((min, c) => c.price < min.price ? c : min, candidates[0]);
    return { model: k, price: 0 };
  };

  return (
    <>
      {/* ━━ 线圈转子 ━━ */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1, bgcolor: 'rgba(124, 58, 237, 0.05)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <CableIcon sx={{ fontSize: 16, color: colors.purple.main }} />
          <Typography variant="caption" fontWeight={700} color={colors.purple.main} sx={{ letterSpacing: 1 }}>
            ▸ 线圈转子
          </Typography>
          {coilLoading && <CircularProgress size={12} sx={{ ml: 1 }} />}
          {coilResult && (
            <Chip
              label={`¥${coilResult.totalCost.toFixed(2)}`}
              size="small"
              color="success"
              sx={{ ml: 'auto', fontWeight: 700 }}
            />
          )}
        </Box>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>定子规格</InputLabel>
            <Select
              value={coilSpec}
              label="定子规格"
              onChange={(e) => { setCoilSpec(e.target.value); setCoilSheets(''); }}
            >
              {coilSpecs.map(s => (
                <MenuItem key={s.spec} value={s.spec}>
                  规格 {s.spec} ({s.count}种)
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="片数"
            type="number"
            value={coilSheets}
            onChange={(e) => setCoilSheets(e.target.value)}
            sx={{ width: 120 }}
            placeholder={coilSpec && coilSpecs.find(s => s.spec === coilSpec)
              ? coilSpecs.find(s => s.spec === coilSpec)!.sheets.join(',')
              : ''}
          />
          <FormControlLabel
            control={<Checkbox checked={useCoilCustomWeight} onChange={(e) => setUseCoilCustomWeight(e.target.checked)} size="small" />}
            label={<Typography variant="body2">指定线重</Typography>}
          />
          {useCoilCustomWeight && (
            <TextField
              size="small" label="线重(kg)" type="number"
              value={coilCustomWireWeight}
              onChange={(e) => setCoilCustomWireWeight(e.target.value)}
              sx={{ width: 100 }}
              inputProps={{ step: '0.001' }}
            />
          )}
          {coilResult && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              {coilResult.formula}
            </Typography>
          )}
        </Box>
      </Paper>

      {/* ━━ 选配配件 ━━ */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Table size="small" sx={{ tableLayout: 'auto' }}>
          <TableHeader />
          <TableBody>
            <TableRow>
              <TableCell colSpan={7} sx={{ py: 0.5, px: 1.5, bgcolor: 'grey.50', borderBottom: 'none' }}>
                <Box display="flex" alignItems="center" justifyContent="space-between">
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
            {optionalParts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ textAlign: 'center', py: 1.5, color: 'text.disabled', fontSize: '0.8rem' }}>
                  暂无选配配件
                </TableCell>
              </TableRow>
            ) : (
              optionalParts.map((part) => (
                <RecipePartRow
                  key={part.id}
                  label="配件"
                  selection={part}
                  models={parts.map((p) => p.model).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)}
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

      {/* ━━ 动态配置区 ━━ */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 1 }}>
            ▸ 动态配置（浮球 / 电缆 / 包材）
          </Typography>
        </Box>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {/* 浮球 */}
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <FormControlLabel
              control={<Checkbox checked={hasFloat} onChange={(e) => setHasFloat(e.target.checked)} size="small" />}
              label={<Typography variant="body2" fontWeight={500}>浮球</Typography>}
              sx={{ minWidth: 100 }}
            />
            {hasFloat && (
              <>
                <FormControl size="small" sx={{ minWidth: 110 }}>
                  <InputLabel>线径</InputLabel>
                  <Select value={floatWire} label="线径" onChange={(e) => setFloatWire(e.target.value as string)}>
                    {getWireOptions('浮球-线径').map((w) => (
                      <MenuItem key={w} value={w}>{w} mm</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                  ¥{getPriceByModelAndSupplier(`浮球-线径${floatWire}`, '').toFixed(2)}
                </Typography>
              </>
            )}
          </Box>
          <Divider />
          {/* 电缆 */}
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <FormControlLabel
              control={<Checkbox checked={hasCable} onChange={(e) => setHasCable(e.target.checked)} size="small" />}
              label={<Typography variant="body2" fontWeight={500}>电缆线</Typography>}
              sx={{ minWidth: 100 }}
            />
            {hasCable && (
              <>
                <FormControl size="small" sx={{ minWidth: 110 }}>
                  <InputLabel>线径</InputLabel>
                  <Select value={cableWire} label="线径" onChange={(e) => setCableWire(e.target.value as string)}>
                    {getWireOptions('电缆-线径').map((w) => (
                      <MenuItem key={w} value={w}>{w} mm</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="长度(米)" size="small" type="number"
                  inputProps={{ step: '0.1', min: '0' }}
                  value={cableLength}
                  onChange={(e) => setCableLength(e.target.value)}
                  sx={{ width: 110 }}
                />
                <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                  ¥{((getPriceByModelAndSupplier(`电缆-线径${cableWire}`, '') * (Number(cableLength) || 0)) + getPriceByModelAndSupplier('电缆配件费', '')).toFixed(2)}
                </Typography>
              </>
            )}
          </Box>
          <Divider />
          {/* 包材 */}
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <Typography variant="body2" fontWeight={500} sx={{ minWidth: 100 }}>包装</Typography>
            <Autocomplete
              freeSolo
              disableClearable
              options={getModelsByCategory('包装')}
              value={boxType}
              onInputChange={(_, v) => setBoxType(v)}
              sx={{ width: 220 }}
              renderInput={(params) => (
                <TextField {...params} label="包装箱型号" size="small" placeholder="选择或输入" InputProps={{ ...params.InputProps, type: 'search' }} />
              )}
            />
            {boxType && (() => {
              const resolved = resolveBoxType(boxType);
              return (
                <Typography variant="body2" color={resolved.price > 0 ? 'text.secondary' : 'error'} sx={{ ml: 'auto' }}>
                  ¥{resolved.price.toFixed(2)}
                  {resolved.model !== boxType && resolved.price > 0 && (
                    <Typography component="span" variant="caption" sx={{ ml: 0.5, color: 'text.disabled' }}>
                      ({resolved.model})
                    </Typography>
                  )}
                </Typography>
              );
            })()}
          </Box>
        </Box>
      </Paper>

      {/* Step navigation */}
      <Box display="flex" justifyContent="space-between" mt={2}>
        <Button variant="outlined" startIcon={<PrevIcon />} onClick={onPrev}>
          上一步
        </Button>
        <Button variant="contained" endIcon={<NextIcon />} onClick={onNext}>
          下一步：确认
        </Button>
      </Box>
    </>
  );
}
