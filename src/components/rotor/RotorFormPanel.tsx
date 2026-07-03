import { TextField, Paper, Grid, MenuItem, Button, CircularProgress } from '@mui/material';
import { Save as SaveIcon, Wrench as BuildIcon } from 'lucide-react';
import { BEARING_OPTIONS } from './rotorConstants';

export interface RotorFormData {
  upper_bearing: string;
  lower_bearing: string;
  piece_count: string;
  rotor_dia: string;
  bearing_span: string;
  stack_offset: string;
  oil_seal_dia: string;
  impeller_dia: string;
  impeller_span: string;
  impeller_depth: string;
  thread_length: string;
  thread_dia: string;
}

interface RotorFormPanelProps {
  form: RotorFormData;
  updateForm: (key: string, value: string) => void;
  onSubmit: () => void;
  onSave: () => void;
  loading: boolean;
  saving: boolean;
  hasWarning: boolean;
}

export default function RotorFormPanel({
  form, updateForm, onSubmit, onSave, loading, saving, hasWarning
}: RotorFormPanelProps) {
  return (
    <Paper elevation={0} sx={{ p: 3, mb: 3, borderRadius: 3 }}>
      <Grid container spacing={2}>
        <Grid item xs={6} sm={3}>
          <TextField select fullWidth label="上轴承" value={form.upper_bearing}
            onChange={e => updateForm('upper_bearing', e.target.value)} size="small">
            {BEARING_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField select fullWidth label="下轴承" value={form.lower_bearing}
            onChange={e => updateForm('lower_bearing', e.target.value)} size="small">
            {BEARING_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField fullWidth label="转子片数" type="number" value={form.piece_count}
            onChange={e => updateForm('piece_count', e.target.value)} size="small" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField fullWidth label="转子直径" type="number" value={form.rotor_dia}
            onChange={e => updateForm('rotor_dia', e.target.value)} size="small" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField fullWidth label="开档/轴承间距" type="number" value={form.bearing_span}
            onChange={e => updateForm('bearing_span', e.target.value)} size="small" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField fullWidth label="叠片定位" type="number" value={form.stack_offset}
            onChange={e => updateForm('stack_offset', e.target.value)} size="small"
            error={hasWarning} helperText={hasWarning ? '请调整此值' : ''} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField fullWidth label="油封孔径" type="number" value={form.oil_seal_dia}
            onChange={e => updateForm('oil_seal_dia', e.target.value)} size="small" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField fullWidth label="叶轮孔径" type="number" value={form.impeller_dia}
            onChange={e => updateForm('impeller_dia', e.target.value)} size="small" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField fullWidth label="叶轮开档" type="number" value={form.impeller_span}
            onChange={e => updateForm('impeller_span', e.target.value)} size="small" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField fullWidth label="叶轮厚度" type="number" value={form.impeller_depth}
            onChange={e => updateForm('impeller_depth', e.target.value)} size="small" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField fullWidth label="螺丝长度" type="number" value={form.thread_length}
            onChange={e => updateForm('thread_length', e.target.value)} size="small" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField fullWidth label="螺纹直径" type="number" value={form.thread_dia}
            onChange={e => updateForm('thread_dia', e.target.value)} size="small" />
        </Grid>
      </Grid>
      <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
        <Grid item>
          <Button variant="outlined" onClick={onSave}
            disabled={loading || saving} startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon size={18} />}>
            保存参数
          </Button>
        </Grid>
        <Grid item>
          <Button variant="contained" onClick={onSubmit}
            disabled={loading || saving} startIcon={loading ? <CircularProgress size={20} /> : <BuildIcon size={18} />}>
            生成图纸
          </Button>
        </Grid>
      </Grid>
    </Paper>
  );
}
