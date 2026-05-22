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
  Autocomplete,
  IconButton,
} from '@mui/material';
import { Cable as CableIcon, Plus as AddIcon, Trash2 as DeleteIcon } from 'lucide-react';
import { colors } from '../../utils/theme';
import { Part, PartSelection } from '../../types';
import RecipePartRow from '../RecipePartRow';
import { CoilSpecInfo, CoilCalcResult } from './recipeFormConstants';
import { getCableAccessoryFee } from '../../utils/partHelpers';

interface StepPartsConfigProps {
  coilSpecs: CoilSpecInfo[];
  coilSpec: string;
  setCoilSpec: (val: string) => void;
  coilMaterial: string;
  setCoilMaterial: (val: string) => void;
  coilSheets: string;
  setCoilSheets: (val: string) => void;
  useCoilCustomWeight: boolean;
  setUseCoilCustomWeight: (val: boolean) => void;
  coilCustomWireWeight: string;
  setCoilCustomWireWeight: (val: string) => void;
  coilResult: CoilCalcResult | null;
  coilLoading: boolean;

  capacitorModel: string;
  capacitorPrice: number;

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

  boxType?: never;      // 已废弃
  setBoxType?: never;   // 已废弃

  packingParts: Array<PartSelection & { id: number }>;
  setPackingParts: (parts: Array<PartSelection & { id: number }>) => void;

  parts: Part[];
  getPriceByModelAndSupplier: (model: string, supplier: string) => number;
  getSuppliersByModel: (model: string) => string[];
  getModelsByCategory: (category: string) => string[];
}

export default function StepPartsConfig({
  coilSpecs, coilSpec, setCoilSpec, coilMaterial, setCoilMaterial, coilSheets, setCoilSheets,
  useCoilCustomWeight, setUseCoilCustomWeight, coilCustomWireWeight, setCoilCustomWireWeight,
  coilResult, coilLoading,
  capacitorModel, capacitorPrice,
  optionalParts, handleAddOptional, handleOptionalChange, handleRemoveOptional,
  hasFloat, setHasFloat, floatWire, setFloatWire,
  hasCable, setHasCable, cableLength, setCableLength, cableWire, setCableWire,
  packingParts, setPackingParts,
  parts, getPriceByModelAndSupplier, getSuppliersByModel, getModelsByCategory,
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

  const cableModel = `电缆-线径${cableWire}`;
  const cableMeters = Number(cableLength) || 0;
  const cableUnitPrice = getPriceByModelAndSupplier(cableModel, '');
  const cableAccessoryPrice = getCableAccessoryFee(parts, cableModel, '');
  const cableTotal = cableUnitPrice * cableMeters + cableAccessoryPrice;
  const selectedCoilSpec = coilSpecs.find(s => s.spec === coilSpec);
  const coilMaterialOptions = selectedCoilSpec?.materials?.length ? selectedCoilSpec.materials : ['钢带'];
  const displayedOptionalCount = optionalParts.length + (capacitorModel ? 1 : 0);

  return (
    <>
      {/* ━━ 线圈转子 ━━ */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1, bgcolor: 'rgba(124, 58, 237, 0.05)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <CableIcon size={16} color={colors.purple.main} />
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
              onChange={(e) => {
                const nextSpec = e.target.value;
                const nextInfo = coilSpecs.find(s => s.spec === nextSpec);
                setCoilSpec(nextSpec);
                setCoilMaterial(nextInfo?.material || nextInfo?.materials?.[0] || '钢带');
                setCoilSheets('');
              }}
            >
              {coilSpecs.map(s => (
                <MenuItem key={s.spec} value={s.spec}>
                  规格 {s.spec} ({s.count}种)
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>材质</InputLabel>
            <Select value={coilMaterial} label="材质" onChange={(e) => setCoilMaterial(e.target.value as string)}>
              {coilMaterialOptions.map(material => (
                <MenuItem key={material} value={material}>{material}</MenuItem>
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
              {coilResult.material} / 单价 ¥{coilResult.unitPrice} / {coilResult.formula}
            </Typography>
          )}
        </Box>
      </Paper>

      {/* ━━ 选配配件 ━━ */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box display="flex" alignItems="center" gap={1}>
            <Typography sx={{ fontSize: 15, lineHeight: 1 }}>🔩</Typography>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 0.5 }}>
              ▸ 选配配件（{displayedOptionalCount} 项）
            </Typography>
          </Box>
          <Button
            variant="text" size="small"
            startIcon={<AddIcon size={16} />}
            onClick={handleAddOptional}
            sx={{ py: 0, fontSize: '0.75rem' }}
          >
            添加配件
          </Button>
        </Box>
        {displayedOptionalCount === 0 ? (
          <Box sx={{ py: 2, textAlign: 'center', color: 'text.disabled', fontSize: '0.8rem' }}>
            暂无选配配件
          </Box>
        ) : (
          <Table size="small" sx={{ tableLayout: 'auto' }}>
            <TableHeader />
            <TableBody>
              {capacitorModel && (
                <TableRow sx={{ bgcolor: 'rgba(46, 125, 50, 0.04)' }}>
                  <TableCell sx={{ pl: 1.5, py: 0.75, fontSize: '0.82rem', fontWeight: 600 }}>
                    电容
                  </TableCell>
                  <TableCell sx={{ py: 0.75 }}>
                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                      <Chip
                        label={capacitorModel}
                        size="small"
                        variant="outlined"
                        color="success"
                        sx={{ fontWeight: 600, fontSize: '0.72rem' }}
                      />
                      {coilResult?.capacitor && (
                        <Typography variant="caption" color="text.secondary">
                          自动关联 {coilResult.capacitor}
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ py: 0.75, color: 'text.secondary', fontSize: '0.82rem' }}>默认</TableCell>
                  <TableCell sx={{ py: 0.75, fontSize: '0.82rem' }}>1</TableCell>
                  <TableCell sx={{ py: 0.75, textAlign: 'right', color: capacitorPrice > 0 ? 'text.secondary' : 'error.main', fontSize: '0.82rem' }}>
                    {capacitorPrice > 0 ? `¥${capacitorPrice.toFixed(2)}` : '-'}
                  </TableCell>
                  <TableCell sx={{ py: 0.75, textAlign: 'right', fontWeight: 600, color: capacitorPrice > 0 ? 'text.primary' : 'error.main', fontSize: '0.82rem' }}>
                    {capacitorPrice > 0 ? `¥${capacitorPrice.toFixed(2)}` : '未找到'}
                  </TableCell>
                  <TableCell sx={{ py: 0.75 }} />
                </TableRow>
              )}
              {optionalParts.map((part) => (
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
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      {/* ━━ 动态配置 & 包装 ━━ */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: 15, lineHeight: 1 }}>⚙️</Typography>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 0.5 }}>
            ▸ 动态配置 & 包装
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
                <Box
                  sx={{
                    ml: { xs: 0, md: 'auto' },
                    maxWidth: { xs: '100%', md: 560 },
                    textAlign: { xs: 'left', md: 'right' },
                  }}
                >
                  <Typography variant="body2" color="text.secondary" fontWeight={700}>
                    ¥{cableTotal.toFixed(2)}
                  </Typography>
                  {cableMeters > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.35 }}>
                      {`${cableModel}: ¥${cableUnitPrice.toFixed(2)} × ${cableMeters}m + 电缆配件费 ¥${cableAccessoryPrice.toFixed(2)} = ¥${cableTotal.toFixed(2)}`}
                    </Typography>
                  )}
                </Box>
              </>
            )}
          </Box>
        </Box>

        {/* ─── 包装材料分段 ─── */}
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 2, py: 0.75,
          bgcolor: 'grey.50',
          borderTop: '1px solid', borderColor: 'divider',
        }}>
          <Box display="flex" alignItems="center" gap={1}>
            <Typography sx={{ fontSize: 13, lineHeight: 1 }}>📦</Typography>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 0.5 }}>
              包装材料（{packingParts.length} 项）
            </Typography>
          </Box>
          <Button
            variant="text" size="small"
            startIcon={<AddIcon size={14} />}
            onClick={() => setPackingParts([...packingParts, { id: Date.now() + Math.random(), model: '', supplier: '', qty: 1 }])}
            sx={{ py: 0, fontSize: '0.72rem' }}
          >
            添加包材
          </Button>
        </Box>

        {packingParts.length === 0 ? (
          <Box sx={{ py: 2, textAlign: 'center', color: 'text.disabled', fontSize: '0.8rem', borderTop: '1px solid', borderColor: 'divider' }}>
            暂无包材，点击「添加包材」
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell sx={{ py: 0.75, pl: 1.5, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>型号</TableCell>
                <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>供应商</TableCell>
                <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 70 }}>数量</TableCell>
                <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 72, textAlign: 'right' }}>单价</TableCell>
                <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 80, textAlign: 'right' }}>小计</TableCell>
                <TableCell sx={{ py: 0.75, width: 36 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {packingParts.map((part) => {
                const packingModels = getModelsByCategory('包装');
                const suppliers = part.model ? getSuppliersByModel(part.model) : [];
                const price = part.model ? getPriceByModelAndSupplier(part.model, part.supplier) : 0;
                const subtotal = price * (part.qty || 1);
                return (
                  <TableRow key={part.id}>
                    <TableCell sx={{ pl: 1.5, py: 0.5 }}>
                      <Autocomplete
                        size="small"
                        options={packingModels}
                        value={part.model || null}
                        onChange={(_, v) => {
                          const newModel = v || '';
                          const newSuppliers = newModel ? getSuppliersByModel(newModel) : [];
                          setPackingParts(packingParts.map(p =>
                            p.id === part.id
                              ? { ...p, model: newModel, supplier: newSuppliers[0] || '' }
                              : p
                          ));
                        }}
                        renderInput={(params) => (
                          <TextField {...params} placeholder="选择包材" size="small" sx={{ minWidth: 160 }} />
                        )}
                        sx={{ minWidth: 160 }}
                        noOptionsText="零件库无『包装』类别零件"
                      />
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <FormControl size="small" sx={{ minWidth: 100 }}>
                        <Select
                          value={part.supplier}
                          displayEmpty
                          onChange={(e) => setPackingParts(packingParts.map(p =>
                            p.id === part.id ? { ...p, supplier: e.target.value } : p
                          ))}
                        >
                          <MenuItem value=""><em>默认</em></MenuItem>
                          {suppliers.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <TextField
                        size="small" type="number"
                        value={part.qty}
                        inputProps={{ min: 1, step: 1 }}
                        onChange={(e) => setPackingParts(packingParts.map(p =>
                          p.id === part.id ? { ...p, qty: parseInt(e.target.value) || 1 } : p
                        ))}
                        sx={{ width: 60 }}
                      />
                    </TableCell>
                    <TableCell sx={{ textAlign: 'right', color: price > 0 ? 'text.secondary' : 'error.main', fontSize: '0.82rem', py: 0.5 }}>
                      {price > 0 ? `¥${price.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell sx={{ textAlign: 'right', color: subtotal > 0 ? 'text.primary' : 'error.main', fontWeight: 600, fontSize: '0.82rem', py: 0.5 }}>
                      {subtotal > 0 ? `¥${subtotal.toFixed(2)}` : '未找到'}
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <IconButton size="small" color="error" aria-label="删除配件行"
                        onClick={() => setPackingParts(packingParts.filter(p => p.id !== part.id))}>
                        <DeleteIcon size={16} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Paper>


    </>
  );
}
