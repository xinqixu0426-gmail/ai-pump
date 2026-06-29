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
} from '@mui/material';
import { Package as TemplateIcon } from 'lucide-react';
import { colors } from '../../utils/theme';
import { TemplatePart, ShellComponent, PumpShellTemplate, PumpShellMeta, PumpModelVariant } from '../../types';

interface StepTemplateSelectProps {
  recipeName: string;
  setRecipeName: (val: string) => void;
  recipeSpec: string;
  setRecipeSpec: (val: string) => void;
  selectedTemplateId: number | null;
  onTemplateSelect: (val: number | null) => void;
  modelVariants: PumpModelVariant[];
  selectedModelVariantId: number | null;
  onModelVariantSelect: (val: number | null) => void;
  impellerModel: string;
  impellerThickness: string;
  impellerDiameter: string;
  impellerBladeCount: string;
  templates: PumpShellTemplate[];
  templateParts: TemplatePart[];
  shellComponents: ShellComponent[];
  templateCost: number;
  getPriceByModelAndSupplier: (model: string, supplier: string) => number;
  shellMetaInfo: PumpShellMeta | null;
  effectiveBarrelLength: string | number | null;
  customBarrelLength: string;
  setCustomBarrelLength: (val: string) => void;
}

export default function StepTemplateSelect({
  recipeName,
  setRecipeName,
  recipeSpec,
  setRecipeSpec,
  selectedTemplateId,
  onTemplateSelect,
  modelVariants,
  selectedModelVariantId,
  onModelVariantSelect,
  impellerModel,
  impellerThickness,
  impellerDiameter,
  impellerBladeCount,
  templates,
  templateParts,
  shellComponents,
  templateCost,
  getPriceByModelAndSupplier,
  shellMetaInfo,
  effectiveBarrelLength,
  customBarrelLength,
  setCustomBarrelLength,
}: StepTemplateSelectProps) {
  const selectedTemplate = templates.find((t) => t.Id === selectedTemplateId) || null;
  const selectedVariant = modelVariants.find(v => v.Id === selectedModelVariantId) || null;
  const costMode = selectedTemplate?.costMode || 'components';
  const shellRows = costMode === 'bundle'
    ? [{
        key: 'bundle',
        name: '整套泵壳',
        model: selectedTemplate?.shellModel || '',
        supplier: '',
        qty: 1,
        subtotal: Number(selectedTemplate?.bundleCost || 0),
      }]
    : shellComponents
        .filter(c => c.included !== false)
        .map((c, i) => {
          const qty = c.pricingMode === 'lengthCm'
            ? Number(effectiveBarrelLength || Number(c.qty || 0) * 10) / 10
            : Number(c.qty || 1);
          return {
            key: `shell-${c.name}-${i}`,
            name: c.pricingMode === 'lengthCm' ? `${c.name}(按cm)` : c.name,
            model: c.model || c.name,
            supplier: '',
            qty,
            subtotal: Number(c.unitCost || 0) * qty,
          };
        });
  const templatePreviewRows = selectedTemplate
    ? [
        ...shellRows,
        ...templateParts.map((p, i) => {
          const supplier = p.supplier || '';
          const price = getPriceByModelAndSupplier(p.model, supplier);
          return {
            key: `${p.model}-${i}`,
            name: p.name,
            model: p.model,
            supplier,
            qty: p.qty,
            subtotal: price * p.qty,
          };
        }),
      ]
    : [];

  return (
    <>
      {/* ━━ 基本信息 ━━ */}
      <Box display="flex" gap={2} mb={2}>
        <TextField
          label="配方名称"
          value={recipeName}
          onChange={(e) => setRecipeName(e.target.value)}
          placeholder="如：人民款370w-90机筒"
          required
          size="small"
          sx={{ flex: 2 }}
        />
        <TextField
          label="规格"
          value={recipeSpec}
          onChange={(e) => setRecipeSpec(e.target.value)}
          placeholder="如：90-100"
          size="small"
          sx={{ flex: 1 }}
        />
      </Box>

      {/* ━━ 泵壳模板选择 ━━ */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1, bgcolor: 'rgba(124, 58, 237, 0.05)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <TemplateIcon size={16} color={colors.purple.main} />
          <Typography variant="caption" fontWeight={700} color={colors.purple.main} sx={{ letterSpacing: 1 }}>
            ▸ 泵壳模板（泵壳成本 + 固定配件）
          </Typography>
          {selectedTemplate && (
            <Chip
              label={`¥${templateCost.toFixed(2)}`}
              size="small"
              color="success"
              sx={{ ml: 'auto', fontWeight: 700 }}
            />
          )}
        </Box>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Box display="flex" gap={1.5} alignItems="center" flexWrap="wrap" mb={selectedTemplate ? 1.5 : 0}>
            <FormControl size="small" sx={{ minWidth: 240 }}>
              <InputLabel>型号变体</InputLabel>
              <Select
                value={selectedModelVariantId || ''}
                label="型号变体"
                onChange={(e) => onModelVariantSelect(e.target.value ? Number(e.target.value) : null)}
              >
                <MenuItem value=""><em>不使用型号变体</em></MenuItem>
                {modelVariants.map(v => (
                  <MenuItem key={v.Id} value={v.Id}>{v.modelName}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 240 }} disabled={!!selectedModelVariantId}>
              <InputLabel>选择泵壳模板</InputLabel>
              <Select
                value={selectedModelVariantId ? '' : (selectedTemplateId || '')}
                label="选择泵壳模板"
                onChange={(e) => onTemplateSelect(e.target.value ? Number(e.target.value) : null)}
              >
                <MenuItem value="">
                  <em>{selectedModelVariantId ? '由型号变体带入' : '不使用模板'}</em>
                </MenuItem>
                {templates.map(t => (
                  <MenuItem key={t.Id} value={t.Id}>
                    {t.shellModel}{t.description ? ` — ${t.description}` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedVariant && selectedTemplate && (
              <Chip label={`模板 ${selectedTemplate.shellModel}`} size="small" color="success" variant="outlined" />
            )}
            {impellerModel && (
              <Box display="flex" gap={0.5} flexWrap="wrap">
                <Chip label={`叶轮 ${impellerModel}`} size="small" color="primary" variant="outlined" />
                {impellerThickness && <Chip label={`${impellerThickness}mm厚`} size="small" variant="outlined" />}
                {impellerDiameter && <Chip label={`直径${impellerDiameter}mm`} size="small" variant="outlined" />}
                {impellerBladeCount && <Chip label={`${impellerBladeCount}片叶`} size="small" variant="outlined" />}
              </Box>
            )}
          </Box>

          {/* 模板配件预览（只读） */}
          {selectedTemplate && (
            <Box sx={{
              mt: 1.5,
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 1,
            }}>
              {templatePreviewRows.map((row) => (
                <Box key={row.key} sx={{
                  minWidth: 0,
                  px: 1.25,
                  py: 0.9,
                  border: '1px solid',
                  borderColor: row.subtotal > 0 ? 'rgba(16, 185, 129, 0.28)' : 'rgba(239, 68, 68, 0.28)',
                  borderRadius: 1,
                  bgcolor: row.subtotal > 0 ? 'rgba(16, 185, 129, 0.035)' : 'rgba(239, 68, 68, 0.035)',
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, mb: 0.35 }}>
                    <Typography variant="caption" color="text.secondary" noWrap title={row.name} sx={{ flex: 1, minWidth: 0, fontWeight: 700 }}>
                      {row.name}
                    </Typography>
                    <Typography variant="caption" sx={{
                      flexShrink: 0,
                      fontFamily: 'monospace',
                      color: row.subtotal > 0 ? 'success.main' : 'error.main',
                      fontWeight: 800,
                    }}>
                      ¥{row.subtotal.toFixed(2)}
                    </Typography>
                  </Box>
                  <Typography variant="body2" noWrap title={row.model} sx={{ fontWeight: 700, lineHeight: 1.25 }}>
                    {row.model}{row.qty > 1 ? ` ×${row.qty}` : ''}
                  </Typography>
                  {row.supplier && (
                    <Typography variant="caption" color="text.disabled" noWrap title={row.supplier} sx={{ display: 'block', mt: 0.25 }}>
                      {row.supplier}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          )}

          {/* 泵壳如果是SS，支持机筒长度自定义 */}
          {shellMetaInfo?.isStainless && (
            <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, border: '1px solid #bae6fd', bgcolor: '#f0f9ff' }}>
              <Typography variant="body2" fontWeight={700} color="#0369a1" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <span style={{ fontSize: '1.2rem' }}>📏</span> 不锈钢机筒长度 (配方级配置)
              </Typography>
              <Box display="flex" flexDirection="column" gap={1.5}>
                {selectedVariant?.barrelLength && !customBarrelLength && (
                  <Typography variant="caption" color="text.secondary">
                    当前使用变体机筒长度：{selectedVariant.barrelLength} mm；如需覆盖，可在下方填写配方机筒长度。
                  </Typography>
                )}
                <Box display="flex" gap={1.5} alignItems="center">
                  <TextField
                    size="small" label="配方机筒长度" type="number"
                    value={customBarrelLength} onChange={(e) => setCustomBarrelLength(e.target.value)}
                    placeholder={selectedVariant?.barrelLength ? `未填使用变体 ${selectedVariant.barrelLength}` : '未选变体时请填写'}
                    InputProps={{ endAdornment: <Typography variant="caption" sx={{ pl: 1 }}>mm</Typography> }}
                    sx={{ width: 220 }}
                    error={!effectiveBarrelLength}
                  />
                  {effectiveBarrelLength && (shellMetaInfo.openOffset != null || shellMetaInfo.openFactor != null) && (
                    <Typography variant="body2" color="text.secondary">
                      自动重算开档: 
                      <Typography component="span" fontWeight={700} color="primary.main" sx={{ mx: 0.5 }}>
                        {(Number(effectiveBarrelLength) - (shellMetaInfo.openOffset ?? shellMetaInfo.openFactor ?? 0)).toFixed(1)}
                      </Typography>
                      mm
                    </Typography>
                  )}
                </Box>
              </Box>
            </Box>
          )}

          {!selectedTemplate && (
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              选择泵壳模板后，泵壳成本按模板计价方式计算，固定配件(轴承/油封/螺丝等)自动填入
            </Typography>
          )}
        </Box>
      </Paper>
    </>
  );
}
