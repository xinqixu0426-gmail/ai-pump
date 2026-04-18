import {
  Box, Typography, TextField, Button, Grid, Paper,
  Alert, Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import { Warning as WarningIcon } from '@mui/icons-material';

export interface RotorWarningData {
  missing_length?: {
    missing_params: Array<{key: string, name: string}>;
    components: Array<{name: string, value: number, missing: boolean}>;
    calculated_total: number;
  };
  stator_clearance?: {
    clearance: number;
    message: string;
  };
  extracted: any;
}

interface RotorWarningDialogProps {
  warning: RotorWarningData | null;
  supplements: Record<string, string>;
  setSupplements: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function RotorWarningDialog({
  warning, supplements, setSupplements, onConfirm, onCancel
}: RotorWarningDialogProps) {
  if (!warning) return null;

  return (
    <Dialog open={!!warning} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <WarningIcon color="warning" /> 
        安全与参数校验警告
      </DialogTitle>
      <DialogContent>
        {warning?.missing_length && (
          <Box sx={{ mb: warning?.stator_clearance ? 3 : 0 }}>
            <Typography variant="body1" sx={{ mb: 2, fontWeight: 'bold' }}>
              1. 总长度参数不完整
            </Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>
              以下参数未提供，可在下方直接补全（否则按 0 计算，导致总长标注错误）：
            </Typography>
            
            <Grid container spacing={1.5} sx={{ mb: 2 }}>
              {warning.missing_length.missing_params.map(p => (
                <Grid item xs={6} key={p.key}>
                  <TextField
                    fullWidth size="small" type="number"
                    label={p.name}
                    placeholder="未提供"
                    value={supplements[p.key] || ''}
                    onChange={e => setSupplements((prev: any) => ({ ...prev, [p.key]: e.target.value }))}
                    InputProps={{ endAdornment: <Typography variant="caption" color="text.secondary">mm</Typography> }}
                  />
                </Grid>
              ))}
            </Grid>

            <Typography variant="body2" sx={{ mb: 1, fontWeight: 'bold' }}>总长预览：</Typography>
            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {warning.missing_length.components.map(c => {
                  const supVal = c.missing ? parseFloat(supplements[warning.missing_length?.missing_params.find(m => m.name === c.name)?.key || ''] || '0') : c.value;
                  return c.name + '(' + (c.missing && !supplements[warning.missing_length?.missing_params.find(m => m.name === c.name)?.key || ''] ? '?' : supVal) + ')';
                }).join(' + ')}
                {' = '}
                {(() => {
                  const t = warning.missing_length!.components.reduce((sum, c) => {
                    if (c.missing) {
                      const k = warning.missing_length!.missing_params.find(m => m.name === c.name)?.key || '';
                      return sum + (parseFloat(supplements[k] || '0') || 0);
                    }
                    return sum + c.value;
                  }, 0);
                  const allFilled = warning.missing_length!.missing_params.every(p => parseFloat(supplements[p.key] || '0') > 0);
                  return <span style={{ fontWeight: 'bold', color: allFilled ? 'green' : 'red' }}>{t}mm</span>;
                })()}
              </Typography>
            </Paper>
          </Box>
        )}

        {warning?.stator_clearance && (
          <Box>
            <Typography variant="body1" sx={{ mb: 1, fontWeight: 'bold', mt: warning?.missing_length ? 2 : 0, pt: warning?.missing_length ? 2 : 0, borderTop: warning?.missing_length ? '1px dashed #ccc' : 'none' }}>
              {warning?.missing_length ? '2. ' : ''}定子距花板安全风险
            </Typography>
            <Alert severity="error" icon={false}>
              {warning.stator_clearance.message}
            </Alert>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} color="inherit">取消</Button>
        <Button onClick={onConfirm} color="warning" variant="contained">我知道风险，继续出图</Button>
      </DialogActions>
    </Dialog>
  );
}
