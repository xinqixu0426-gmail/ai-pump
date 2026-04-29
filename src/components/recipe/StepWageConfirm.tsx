import {
  Box,
  TextField,
  Paper,
  Typography,
  Chip,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import { PumpShellTemplate, PartSelection } from '../../types';

interface StepWageConfirmProps {
  selectedTemplate: PumpShellTemplate | null;
  assemblyWage: number;
  setAssemblyWage: (val: number) => void;
  packingWage: number;
  setPackingWage: (val: number) => void;
  paintingWage: number | null;
  setPaintingWage: (val: number | null) => void;
  managementFee: number;
  setManagementFee: (val: number) => void;
  laborCost: number;

  recipeName: string;
  recipeSpec: string;
  coilSpec: string;
  coilSheets: string;
  optionalParts: Array<PartSelection & { id: number }>;
}

export default function StepWageConfirm({
  selectedTemplate, assemblyWage, setAssemblyWage, packingWage, setPackingWage, paintingWage, setPaintingWage, managementFee, setManagementFee, laborCost,
  recipeName, recipeSpec, coilSpec, coilSheets, optionalParts,
}: StepWageConfirmProps) {

  return (
    <>
      {/* 人工工资（如果有模板则显示） */}
      {selectedTemplate && (
        <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, bgcolor: 'rgba(245, 158, 11, 0.06)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: 15, lineHeight: 1 }}>👷</Typography>
            <Typography variant="caption" fontWeight={700} color="warning.main" sx={{ letterSpacing: 0.5 }}>
              ▸ 人工工资 & 管理费（元/台）
            </Typography>
            {laborCost > 0 && (
              <Chip label={`¥${laborCost.toFixed(2)}`} size="small" color="warning" sx={{ ml: 'auto', fontWeight: 700 }} />
            )}
          </Box>
          <Box sx={{ px: 2, py: 1.5, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TextField label="安装工资" type="number" size="small"
              value={assemblyWage === 0 ? '' : assemblyWage} onChange={e => setAssemblyWage(parseFloat(e.target.value) || 0)}
              inputProps={{ min: 0, step: 0.5 }} sx={{ width: 120 }} />
            <TextField label="打包工资" type="number" size="small"
              value={packingWage === 0 ? '' : packingWage} onChange={e => setPackingWage(parseFloat(e.target.value) || 0)}
              inputProps={{ min: 0, step: 0.5 }} sx={{ width: 120 }} />
            <Box display="flex" alignItems="center" gap={1}>
              <FormControlLabel
                control={<Checkbox size="small" checked={paintingWage != null}
                  onChange={e => setPaintingWage(e.target.checked ? 0 : null)} />}
                label={<Typography variant="body2" sx={{ fontSize: '0.8rem' }}>需要喷漆</Typography>}
                sx={{ mr: 0 }}
              />
              {paintingWage != null && (
                <TextField label="喷漆工资" type="number" size="small"
                  value={paintingWage === 0 ? '' : paintingWage} onChange={e => setPaintingWage(parseFloat(e.target.value) || 0)}
                  inputProps={{ min: 0, step: 0.5 }} sx={{ width: 120 }} />
              )}
            </Box>
            <TextField label="管理费用" type="number" size="small"
              value={managementFee === 0 ? '' : managementFee} onChange={e => setManagementFee(parseFloat(e.target.value) || 0)}
              inputProps={{ min: 0, step: 0.5 }} sx={{ width: 120 }}
              helperText="系统默认值" />
          </Box>
        </Paper>
      )}

      {/* 配方概览 */}
      <Paper variant="outlined" sx={{ mb: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: 15, lineHeight: 1 }}>📋</Typography>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: 0.5 }}>
            ▸ 配方概览
          </Typography>
        </Box>
        <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">配方名称：<strong>{recipeName || '-'}</strong></Typography>
          <Typography variant="body2" color="text.secondary">规格：<strong>{recipeSpec || '-'}</strong></Typography>
          <Typography variant="body2" color="text.secondary">泵壳模板：<strong>{selectedTemplate?.shell_model || '未选择'}</strong></Typography>
          <Typography variant="body2" color="text.secondary">线圈规格：<strong>{coilSpec ? `${coilSpec} / ${coilSheets}片` : '未配置'}</strong></Typography>
          <Typography variant="body2" color="text.secondary">选配件数：<strong>{optionalParts.filter(p => p.model).length} 项</strong></Typography>
          <Typography variant="body2" color="text.secondary">人工合计：<strong>¥{laborCost.toFixed(2)}</strong></Typography>
        </Box>
      </Paper>

    </>
  );
}
