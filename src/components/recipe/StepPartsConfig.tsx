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
import { CableAccessoryConfig, CableAccessoryType, Part, PartSelection } from '../../types';
import RecipePartRow from '../RecipePartRow';
import { CoilSpecInfo, CoilCalcResult } from './recipeFormConstants';
import { getCableAccessoryFee, getCableAccessoryName } from '../../utils/partHelpers';
import {
  DEFAULT_COIL_MATERIAL,
  DEFAULT_PACKAGING_MATERIAL,
  PACKAGING_MATERIAL_OPTIONS,
  inferPackingMaterial,
  wireModel,
  wireOptionsFromParts,
} from '../../utils/businessRules';

const packingAutocompleteSx = {
  minWidth: 160,
  '&, & *, & input, & fieldset, & button, & svg': {
    cursor: 'text !important',
  },
};

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
  floatAccessoryType: CableAccessoryType;
  setFloatAccessoryType: (val: CableAccessoryType) => void;
  floatAccessoryDelta: number;

  hasCable: boolean;
  setHasCable: (val: boolean) => void;
  cableLength: string;
  setCableLength: (val: string) => void;
  cableWire: string;
  setCableWire: (val: string) => void;
  cableAccessoryType: CableAccessoryType;
  setCableAccessoryType: (val: CableAccessoryType) => void;
  cableAccessoryConfig: CableAccessoryConfig | null;

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
  hasFloat, setHasFloat, floatWire, setFloatWire, floatAccessoryType, setFloatAccessoryType, floatAccessoryDelta,
  hasCable, setHasCable, cableLength, setCableLength, cableWire, setCableWire, cableAccessoryType, setCableAccessoryType, cableAccessoryConfig,
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

  const getWireOptions = (prefix: string): string[] => wireOptionsFromParts(parts, prefix);

  const cableModel = wireModel('电缆', cableWire);
  const floatModel = wireModel('浮球', floatWire);
  const floatBasePrice = getPriceByModelAndSupplier(floatModel, '');
  const floatDelta = floatAccessoryType === 'xinjie' ? floatAccessoryDelta : 0;
  const floatTotal = floatBasePrice + floatDelta;
  const cableMeters = Number(cableLength) || 0;
  const cableUnitPrice = getPriceByModelAndSupplier(cableModel, '');
  const cableAccessoryPrice = getCableAccessoryFee(parts, cableModel, '', cableAccessoryType, cableAccessoryConfig);
  const standardCableAccessoryName = getCableAccessoryName(parts, cableModel, '', 'standard', cableAccessoryConfig);
  const xinjieCableAccessoryName = getCableAccessoryName(parts, cableModel, '', 'xinjie', cableAccessoryConfig);
  const cableAccessoryName = cableAccessoryType === 'xinjie' ? xinjieCableAccessoryName : standardCableAccessoryName;
  const cableTotal = cableUnitPrice * cableMeters + cableAccessoryPrice;
  const selectedCoilSpec = coilSpecs.find(s => s.spec === coilSpec);
  const coilMaterialOptions = selectedCoilSpec?.materials?.length ? selectedCoilSpec.materials : [DEFAULT_COIL_MATERIAL];
  const displayedOptionalCount = optionalParts.length + (capacitorModel ? 1 : 0);
  const updatePackingPart = (id: number, patch: Partial<PartSelection>) => {
    setPackingParts(packingParts.map(p => p.id === id ? { ...p, ...patch } : p));
  };
  const isManualPacking = (part: PartSelection) => part.costSource === 'manual' && !String(part.supplier || '').trim();
  const getPackingMaterial = (part: PartSelection) => {
    return inferPackingMaterial(part.model || '', part.packagingMaterial);
  };

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
                setCoilMaterial(nextInfo?.material || nextInfo?.materials?.[0] || DEFAULT_COIL_MATERIAL);
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
                  allowCreateMissing
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
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel>铜套规格</InputLabel>
                  <Select
                    value={floatAccessoryType}
                    label="铜套规格"
                    onChange={(e) => setFloatAccessoryType(e.target.value as CableAccessoryType)}
                  >
                    <MenuItem value="standard">普通铜套</MenuItem>
                    <MenuItem value="xinjie">新界式</MenuItem>
                  </Select>
                </FormControl>
                <Box sx={{ ml: { xs: 0, md: 'auto' }, textAlign: { xs: 'left', md: 'right' } }}>
                  <Typography variant="body2" color="text.secondary" fontWeight={700}>
                    ¥{floatTotal.toFixed(2)}
                  </Typography>
                  {floatAccessoryType === 'xinjie' && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.35 }}>
                      {`${floatModel}: ¥${floatBasePrice.toFixed(2)} + 新界式 ¥${floatDelta.toFixed(2)} = ¥${floatTotal.toFixed(2)}`}
                    </Typography>
                  )}
                </Box>
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
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel>铜套规格</InputLabel>
                  <Select
                    value={cableAccessoryType}
                    label="铜套规格"
                    onChange={(e) => setCableAccessoryType(e.target.value as CableAccessoryType)}
                  >
                    <MenuItem value="standard">{standardCableAccessoryName}</MenuItem>
                    <MenuItem value="xinjie">{xinjieCableAccessoryName}</MenuItem>
                  </Select>
                </FormControl>
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
                      {`${cableModel}: ¥${cableUnitPrice.toFixed(2)} × ${cableMeters}m + ${cableAccessoryName} ¥${cableAccessoryPrice.toFixed(2)} = ¥${cableTotal.toFixed(2)}`}
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
            onClick={() => setPackingParts([...packingParts, { id: Date.now() + Math.random(), model: '', supplier: '', qty: 1, packagingMaterial: DEFAULT_PACKAGING_MATERIAL }])}
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
                <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 92 }}>计价</TableCell>
                <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>供应商</TableCell>
                <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 140 }}>类型</TableCell>
                <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 72, textAlign: 'right' }}>单价</TableCell>
                <TableCell sx={{ py: 0.75, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary', width: 80, textAlign: 'right' }}>小计</TableCell>
                <TableCell sx={{ py: 0.75, width: 36 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {packingParts.map((part) => {
                const packingModels = getModelsByCategory('包装');
                const suppliers = part.model
                  ? Array.from(new Set(parts
                      .filter(p => p.category === '包装' && p.model.trim() === String(part.model || '').trim() && p.supplier)
                      .map(p => p.supplier)))
                      .sort()
                  : [];
                const manualPacking = isManualPacking(part);
                const packagingMaterial = getPackingMaterial(part);
                const packingCandidates = parts.filter(p => p.category === '包装' && p.model.trim() === String(part.model || '').trim());
                const exactPacking = packingCandidates.find(p => String(part.supplier || '').trim() && p.supplier.trim() === String(part.supplier || '').trim());
                const libraryPrice = exactPacking
                  ? exactPacking.price
                  : (packingCandidates.length > 0 ? packingCandidates.reduce((min, p) => p.price < min.price ? p : min, packingCandidates[0]).price : 0);
                const missingPacking = !manualPacking && !!String(part.model || '').trim() && !!String(part.supplier || '').trim() && libraryPrice <= 0;
                const price = (manualPacking || missingPacking) ? Number(part.snapshotPrice || 0) : libraryPrice;
                const subtotal = price;
                return (
                  <TableRow key={part.id}>
                    <TableCell sx={{ pl: 1.5, py: 0.5 }}>
                      {manualPacking ? (
                        <TextField
                          size="small"
                          value={part.model}
                          onChange={(e) => updatePackingPart(part.id, { model: e.target.value })}
                          placeholder="外包装估算"
                          sx={{ minWidth: 160 }}
                        />
                      ) : (
                        <Autocomplete
                          size="small"
                          freeSolo
                          forcePopupIcon={false}
                          clearIcon={null}
                          options={packingModels}
                          value={part.model || ''}
                          onChange={(_, v) => {
                            const newModel = v || '';
                            const newSuppliers = newModel
                              ? Array.from(new Set(parts
                                  .filter(p => p.category === '包装' && p.model.trim() === newModel && p.supplier)
                                  .map(p => p.supplier)))
                                  .sort()
                              : [];
                            updatePackingPart(part.id, { model: newModel, supplier: newSuppliers[0] || '', qty: 1, packagingMaterial: inferPackingMaterial(newModel), snapshotPrice: undefined, costSource: undefined });
                          }}
                          onInputChange={(_, value, reason) => {
                            if (reason === 'reset') return;
                            updatePackingPart(part.id, { model: value || '', supplier: '', qty: 1, packagingMaterial: inferPackingMaterial(value || ''), snapshotPrice: undefined, costSource: undefined });
                          }}
                          renderInput={(params) => (
                            <TextField {...params} placeholder="选择包材" size="small" sx={{ minWidth: 160 }} />
                          )}
                          sx={packingAutocompleteSx}
                          noOptionsText="零件库无『包装』类别零件"
                        />
                      )}
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <FormControl size="small" sx={{ minWidth: 86 }}>
                        <Select
                          value={manualPacking ? 'manual' : 'part'}
                          onChange={(e) => {
                            if (e.target.value === 'manual') {
                              updatePackingPart(part.id, {
                                model: part.model || '外包装估算',
                                supplier: '',
                                qty: 1,
                                packagingMaterial,
                                snapshotPrice: part.snapshotPrice ?? price,
                                costSource: 'manual',
                              });
                            } else {
                              updatePackingPart(part.id, {
                                model: '',
                                supplier: '',
                                qty: 1,
                                packagingMaterial,
                                snapshotPrice: undefined,
                                costSource: undefined,
                              });
                            }
                          }}
                        >
                          <MenuItem value="part">型号</MenuItem>
                          <MenuItem value="manual">估算</MenuItem>
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      {manualPacking ? (
                        <Typography variant="body2" color="text.secondary">手输</Typography>
                      ) : (
                        <Autocomplete
                          size="small"
                          freeSolo
                          disabled={!part.model}
                          options={suppliers}
                          value={part.supplier || ''}
                          onChange={(_, value) => updatePackingPart(part.id, { supplier: value || '', snapshotPrice: undefined, costSource: undefined })}
                          onInputChange={(_, value, reason) => {
                            if (reason === 'reset') return;
                            updatePackingPart(part.id, { supplier: value || '', snapshotPrice: undefined, costSource: undefined });
                          }}
                          renderInput={(params) => (
                            <TextField {...params} placeholder="供应商" size="small" sx={{ minWidth: 100 }} />
                          )}
                          noOptionsText="可输入新供应商"
                          sx={{ minWidth: 100 }}
                        />
                        )}
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <Autocomplete
                        size="small"
                        freeSolo
                        options={PACKAGING_MATERIAL_OPTIONS}
                        value={packagingMaterial}
                        onChange={(_, value) => updatePackingPart(part.id, { packagingMaterial: value || DEFAULT_PACKAGING_MATERIAL, qty: 1 })}
                        onInputChange={(_, value) => updatePackingPart(part.id, { packagingMaterial: value || DEFAULT_PACKAGING_MATERIAL, qty: 1 })}
                        renderInput={(params) => (
                          <TextField {...params} placeholder="包材类型" size="small" sx={{ minWidth: 128 }} />
                        )}
                        sx={{ minWidth: 128 }}
                      />
                    </TableCell>
                    <TableCell sx={{ textAlign: 'right', color: price > 0 ? 'text.secondary' : 'error.main', fontSize: '0.82rem', py: 0.5 }}>
                      {manualPacking || missingPacking ? (
                        <TextField
                          size="small"
                          type="number"
                          value={part.snapshotPrice ?? ''}
                          inputProps={{ min: 0, step: 0.01 }}
                          onChange={(e) => updatePackingPart(part.id, { snapshotPrice: Math.max(0, Number(e.target.value) || 0), costSource: 'manual' })}
                          sx={{ width: 86 }}
                        />
                      ) : (
                        price > 0 ? `¥${price.toFixed(2)}` : '-'
                      )}
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
