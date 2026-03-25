import {
  FormControl,
  Select,
  MenuItem,
  TextField,
  TableRow,
  TableCell,
  Chip,
  Autocomplete,
  IconButton,
  Tooltip
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { PartSelection } from '../types';

interface RecipePartRowProps {
  label: string;
  selection: PartSelection;
  models: string[];
  getSuppliers: (model: string) => string[];
  getPrice: (model: string, supplier: string) => number;
  onChange: (field: keyof PartSelection, value: string | number) => void;
  onDelete?: () => void;
  isRequired?: boolean;
}

export default function RecipePartRow({
  label,
  selection,
  models,
  getSuppliers,
  getPrice,
  onChange,
  onDelete,
  isRequired = false
}: RecipePartRowProps) {
  const suppliers = selection.model ? getSuppliers(selection.model) : [];
  const price =
    selection.model && selection.supplier
      ? getPrice(selection.model, selection.supplier)
      : 0;
  const subtotal = price * selection.qty;

  return (
    <TableRow
      sx={{
        '&:hover': { bgcolor: 'action.hover' },
        bgcolor: isRequired ? 'rgba(25, 118, 210, 0.03)' : 'inherit'
      }}
    >
      {/* 配件名称 */}
      <TableCell sx={{ py: 0.5, pl: 1.5, width: 90, whiteSpace: 'nowrap' }}>
        <Chip
          label={label}
          size="small"
          color={isRequired ? 'primary' : 'default'}
          variant={isRequired ? 'outlined' : 'filled'}
          sx={{ fontSize: '0.7rem', height: 20 }}
        />
      </TableCell>

      {/* 型号 Autocomplete */}
      <TableCell sx={{ py: 0.5, minWidth: 140 }}>
        <Autocomplete
          size="small"
          options={models}
          value={selection.model || null}
          onChange={(_, value) => onChange('model', value || '')}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="型号"
              size="small"
              sx={{ '& .MuiInputBase-root': { py: 0, fontSize: '0.8rem' } }}
            />
          )}
          noOptionsText="无匹配"
          clearOnEscape
          sx={{ minWidth: 130 }}
        />
      </TableCell>

      {/* 供应商 Select */}
      <TableCell sx={{ py: 0.5, minWidth: 120 }}>
        <FormControl fullWidth size="small" disabled={!selection.model || suppliers.length === 0}>
          <Select
            value={selection.supplier}
            onChange={(e) => onChange('supplier', e.target.value)}
            displayEmpty
            sx={{ fontSize: '0.8rem' }}
          >
            <MenuItem value="">
              <em style={{ fontSize: '0.75rem', color: '#aaa' }}>
                {suppliers.length === 0 ? '—' : '供应商'}
              </em>
            </MenuItem>
            {suppliers.map((s) => (
              <MenuItem key={s} value={s} sx={{ fontSize: '0.8rem' }}>
                {s}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </TableCell>

      {/* 数量 */}
      <TableCell sx={{ py: 0.5, width: 70 }}>
        <TextField
          type="number"
          inputProps={{ min: 1, style: { textAlign: 'center', fontSize: '0.8rem', padding: '4px 6px' } }}
          value={selection.qty}
          onChange={(e) => onChange('qty', parseInt(e.target.value) || 1)}
          size="small"
          sx={{ width: 64 }}
        />
      </TableCell>

      {/* 单价 */}
      <TableCell sx={{ py: 0.5, width: 72, textAlign: 'right', color: 'text.secondary', fontSize: '0.8rem' }}>
        {price > 0 ? `¥${price.toFixed(2)}` : '—'}
      </TableCell>

      {/* 小计 */}
      <TableCell sx={{ py: 0.5, width: 80, textAlign: 'right', fontWeight: 'bold', fontSize: '0.82rem', color: subtotal > 0 ? 'primary.main' : 'text.disabled' }}>
        {subtotal > 0 ? `¥${subtotal.toFixed(2)}` : '—'}
      </TableCell>

      {/* 删除 */}
      <TableCell sx={{ py: 0.5, width: 40, pr: 0.5 }}>
        {onDelete ? (
          <Tooltip title="删除">
            <IconButton size="small" color="error" onClick={onDelete} sx={{ p: 0.5 }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          <span style={{ display: 'inline-block', width: 28 }} />
        )}
      </TableCell>
    </TableRow>
  );
}
