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
  Button
} from '@mui/material';
import { Inventory as TemplateIcon, NavigateNext as NextIcon } from '@mui/icons-material';
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
  onNext: () => void;
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
  onNext,
}: StepTemplateSelectProps) {
  const selectedTemplate = templates.find((t) => t.Id === selectedTemplateId) || null;

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
          <TemplateIcon sx={{ fontSize: 16, color: colors.purple.main }} />
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
          {selectedTemplate && templateParts.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 1 }}>
              {templateParts.map((p, i) => {
                const supplier = p.supplier || '';
                const price = getPriceByModelAndSupplier(p.model, supplier);
                return (
                  <Box key={i} display="flex" justifyContent="space-between" alignItems="center"
                    sx={{ py: 0.25, fontSize: '0.8rem' }}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 70 }}>
                        {p.name}
                      </Typography>
                      <Chip label={p.model} size="small" variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem' }} />
                      {supplier && (
                        <Typography variant="caption" color="text.disabled">{supplier}</Typography>
                      )}
                      {p.qty > 1 && (
                        <Typography variant="caption" color="text.disabled">×{p.qty}</Typography>
                      )}
                    </Box>
                    <Typography variant="body2" sx={{
                      fontFamily: 'monospace',
                      color: price > 0 ? 'success.main' : 'error.main',
                      fontSize: '0.8rem'
                    }}>
                      ¥{(price * p.qty).toFixed(2)}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          )}

          {/* 泵壳如果是SS，支持机筒长度自定义 */}
          {shellMetaInfo?.isStainless && (
            <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, border: '1px solid #bae6fd', bgcolor: '#f0f9ff' }}>
              <Typography variant="body2" fontWeight={700} color="#0369a1" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <span style={{ fontSize: '1.2rem' }}>📏</span> 不锈钢机筒长度 (配方级配置)
              </Typography>
              <Box display="flex" gap={1.5} alignItems="center">
                <TextField
                  size="small" label="机筒长度" type="number"
                  value={customBarrelLength} onChange={(e) => setCustomBarrelLength(e.target.value)}
                  placeholder={`默认: ${shellMetaInfo.barrelLength || '未设置'}`}
                  InputProps={{ endAdornment: <Typography variant="caption" sx={{ pl: 1 }}>mm</Typography> }}
                  sx={{ width: 150 }}
                />
                {(customBarrelLength || shellMetaInfo.barrelLength) && shellMetaInfo.openFactor != null && (
                  <Typography variant="body2" color="text.secondary">
                    自动重算开档: 
                    <Typography component="span" fontWeight={700} color="primary.main" sx={{ mx: 0.5 }}>
                      {(Number(customBarrelLength || shellMetaInfo.barrelLength) - shellMetaInfo.openFactor).toFixed(1)}
                    </Typography>
                    mm
                  </Typography>
                )}
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

      {/* Step navigation */}
      <Box display="flex" justifyContent="flex-end" mt={2}>
        <Button
          variant="contained"
          endIcon={<NextIcon />}
          onClick={onNext}
          disabled={!recipeName.trim()}
        >
          下一步：配件配置
        </Button>
      </Box>
    </>
  );
}
