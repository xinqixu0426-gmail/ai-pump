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
import { TemplatePart, PumpShellTemplate, PumpShellMeta } from '../../types';

interface StepTemplateSelectProps {
  recipeName: string;
  setRecipeName: (val: string) => void;
  recipeSpec: string;
  setRecipeSpec: (val: string) => void;
  selectedTemplateId: number | null;
  setSelectedTemplateId: (val: number | null) => void;
  templates: PumpShellTemplate[];
  templateParts: TemplatePart[];
  templateCost: number;
  getPriceByModelAndSupplier: (model: string, supplier: string) => number;
  shellMetaInfo: PumpShellMeta | null;
  customBarrelLength: string;
  setCustomBarrelLength: (val: string) => void;
}

export default function StepTemplateSelect({
  recipeName,
  setRecipeName,
  recipeSpec,
  setRecipeSpec,
  selectedTemplateId,
  setSelectedTemplateId,
  templates,
  templateParts,
  templateCost,
  getPriceByModelAndSupplier,
  shellMetaInfo,
  customBarrelLength,
  setCustomBarrelLength,
}: StepTemplateSelectProps) {
  const selectedTemplate = templates.find((t) => t.Id === selectedTemplateId) || null;
  const templatePreviewRows = selectedTemplate
    ? [
        {
          key: 'shell',
          name: '泵壳',
          model: selectedTemplate.shell_model,
          supplier: '',
          qty: 1,
          subtotal: getPriceByModelAndSupplier(selectedTemplate.shell_model, ''),
        },
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
            ▸ 泵壳模板（固定配件）
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
          <FormControl size="small" sx={{ minWidth: 240, mb: selectedTemplate ? 1.5 : 0 }}>
            <InputLabel>选择泵壳模板</InputLabel>
            <Select
              value={selectedTemplateId || ''}
              label="选择泵壳模板"
              onChange={(e) => setSelectedTemplateId(e.target.value ? Number(e.target.value) : null)}
            >
              <MenuItem value="">
                <em>不使用模板</em>
              </MenuItem>
              {templates.map(t => (
                <MenuItem key={t.Id} value={t.Id}>
                  {t.shell_model}{t.description ? ` — ${t.description}` : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

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
                {shellMetaInfo.barrelLengthPresets && shellMetaInfo.barrelLengthPresets.length > 0 && (
                  <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
                    <Typography variant="caption" color="text.secondary">快速选择:</Typography>
                    {shellMetaInfo.barrelLengthPresets.map((len, idx) => (
                      <Chip
                        key={idx}
                        label={`${len} mm`}
                        size="small"
                        color={customBarrelLength === String(len) ? 'primary' : 'default'}
                        onClick={() => setCustomBarrelLength(String(len))}
                        sx={{ fontWeight: customBarrelLength === String(len) ? 700 : 400 }}
                      />
                    ))}
                  </Box>
                )}
                <Box display="flex" gap={1.5} alignItems="center">
                  <TextField
                    size="small" label="机筒长度" type="number" required
                    value={customBarrelLength} onChange={(e) => setCustomBarrelLength(e.target.value)}
                    placeholder={shellMetaInfo.barrelLength ? `未填将默认使用 ${shellMetaInfo.barrelLength}` : "必填"}
                    InputProps={{ endAdornment: <Typography variant="caption" sx={{ pl: 1 }}>mm</Typography> }}
                    sx={{ width: 220 }}
                    error={!customBarrelLength && !shellMetaInfo.barrelLength}
                  />
                  {(customBarrelLength || shellMetaInfo.barrelLength) && (shellMetaInfo.openOffset != null || shellMetaInfo.openFactor != null) && (
                    <Typography variant="body2" color="text.secondary">
                      自动重算开档: 
                      <Typography component="span" fontWeight={700} color="primary.main" sx={{ mx: 0.5 }}>
                        {(Number(customBarrelLength || shellMetaInfo.barrelLength) - (shellMetaInfo.openOffset ?? shellMetaInfo.openFactor ?? 0)).toFixed(1)}
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
              选择泵壳模板后，固定配件(轴承/油封/螺丝等)将自动填入
            </Typography>
          )}
        </Box>
      </Paper>
    </>
  );
}
