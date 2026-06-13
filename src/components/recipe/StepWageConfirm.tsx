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
import { PumpShellTemplate, PartSelection, SurfaceTreatmentMode } from '../../types';

interface StepWageConfirmProps {
  selectedTemplate: PumpShellTemplate | null;
  assemblyWage: number;
  setAssemblyWage: (val: number) => void;
  packingWage: number;
  setPackingWage: (val: number) => void;
  surfaceTreatmentMode: SurfaceTreatmentMode;
  setSurfaceTreatmentMode: (val: SurfaceTreatmentMode) => void;
  surfaceTreatmentCost: number;
  setSurfaceTreatmentCost: (val: number) => void;
  managementFee: number;
  setManagementFee: (val: number) => void;
  laborCost: number;

  recipeName: string;
  recipeSpec: string;
  coilSpec: string;
  coilSheets: string;
  optionalParts: Array<PartSelection & { id: number }>;
  capacitorModel?: string;
}

const SURFACE_LABELS: Record<SurfaceTreatmentMode, string> = {
  none: '无',
  painting: '喷漆',
  electrophoresis: '电泳',
  powder_coating: '喷塑',
  electrophoresis_powder_coating: '电泳+喷塑',
};

export default function StepWageConfirm({
  selectedTemplate,
  assemblyWage,
  setAssemblyWage,
  packingWage,
  setPackingWage,
  surfaceTreatmentMode,
  setSurfaceTreatmentMode,
  surfaceTreatmentCost,
  setSurfaceTreatmentCost,
  managementFee,
  setManagementFee,
  laborCost,
  recipeName,
  recipeSpec,
  coilSpec,
  coilSheets,
  optionalParts,
  capacitorModel = '',
}: StepWageConfirmProps) {
  const handleSurfaceModeChange = (mode: SurfaceTreatmentMode) => {
    setSurfaceTreatmentMode(mode);
    if (mode === 'none') setSurfaceTreatmentCost(0);
    if (mode === 'painting') setSurfaceTreatmentCost(3);
  };

  const surfaceCostDisabled = surfaceTreatmentMode === 'none';
  const displayedOptionalCount = optionalParts.filter(p => p.model).length + (capacitorModel ? 1 : 0);

  return (
    <>
      {selectedTemplate && (
        <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, bgcolor: 'rgba(245, 158, 11, 0.06)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: 15, lineHeight: 1 }}>工</Typography>
            <Typography variant="caption" fontWeight={700} color="warning.main" sx={{ letterSpacing: 0.5 }}>
              人工工资 & 表面处理 & 管理费
            </Typography>
            {laborCost > 0 && (
              <Chip label={`¥${laborCost.toFixed(2)}`} size="small" color="warning" sx={{ ml: 'auto', fontWeight: 700 }} />
            )}
          </Box>
          <Box sx={{ px: 2, py: 1.5, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TextField
              label="安装工资"
              type="number"
              size="small"
              value={assemblyWage === 0 ? '' : assemblyWage}
              onChange={e => setAssemblyWage(parseFloat(e.target.value) || 0)}
              inputProps={{ min: 0, step: 0.5 }}
              sx={{ width: 120 }}
            />
            <TextField
              label="打包工资"
              type="number"
              size="small"
              value={packingWage === 0 ? '' : packingWage}
              onChange={e => setPackingWage(parseFloat(e.target.value) || 0)}
              inputProps={{ min: 0, step: 0.5 }}
              sx={{ width: 120 }}
            />
            <FormControl size="small" sx={{ width: 150 }}>
              <InputLabel>表面处理</InputLabel>
              <Select
                value={surfaceTreatmentMode}
                label="表面处理"
                onChange={e => handleSurfaceModeChange(e.target.value as SurfaceTreatmentMode)}
              >
                {Object.entries(SURFACE_LABELS).map(([mode, label]) => (
                  <MenuItem key={mode} value={mode}>{label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="处理费用"
              type="number"
              size="small"
              value={surfaceTreatmentCost === 0 ? '' : surfaceTreatmentCost}
              onChange={e => setSurfaceTreatmentCost(parseFloat(e.target.value) || 0)}
              inputProps={{ min: 0, step: 0.5 }}
              disabled={surfaceCostDisabled}
              helperText={surfaceTreatmentMode === 'painting' ? '喷漆默认 3 元，可手动修改' : undefined}
              sx={{ width: 130 }}
            />
            <TextField
              label="管理费用"
              type="number"
              size="small"
              value={managementFee === 0 ? '' : managementFee}
              onChange={e => setManagementFee(parseFloat(e.target.value) || 0)}
              inputProps={{ min: 0, step: 0.5 }}
              sx={{ width: 120 }}
              helperText="系统默认值"
            />
          </Box>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: 15, lineHeight: 1 }}>表</Typography>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 0.5 }}>
            配方概览
          </Typography>
        </Box>
        <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">配方名称：<strong>{recipeName || '-'}</strong></Typography>
          <Typography variant="body2" color="text.secondary">规格：<strong>{recipeSpec || '-'}</strong></Typography>
          <Typography variant="body2" color="text.secondary">泵壳模板：<strong>{selectedTemplate?.shellModel || '未选择'}</strong></Typography>
          <Typography variant="body2" color="text.secondary">线圈规格：<strong>{coilSpec ? `${coilSpec} / ${coilSheets}片` : '未配置'}</strong></Typography>
          <Typography variant="body2" color="text.secondary">选配件数：<strong>{displayedOptionalCount} 项</strong></Typography>
          <Typography variant="body2" color="text.secondary">表面处理：<strong>{SURFACE_LABELS[surfaceTreatmentMode]} ¥{surfaceTreatmentCost.toFixed(2)}</strong></Typography>
          <Typography variant="body2" color="text.secondary">人工与管理合计：<strong>¥{laborCost.toFixed(2)}</strong></Typography>
        </Box>
      </Paper>
    </>
  );
}
