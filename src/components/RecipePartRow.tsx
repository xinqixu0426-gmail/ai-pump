import {
  TextField,
  TableRow,
  TableCell,
  Chip,
  Autocomplete,
  IconButton,
  Tooltip
} from '@mui/material';
import { Trash2 as DeleteIcon } from 'lucide-react';
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
  allowCreateMissing?: boolean;
}

export default function RecipePartRow({
  label,
  selection,
  models,
  getSuppliers,
  getPrice,
  onChange,
  onDelete,
  isRequired = false,
  allowCreateMissing = false,
}: RecipePartRowProps) {
  const suppliers = selection.model ? getSuppliers(selection.model) : [];
  const libraryPrice =
    selection.model && selection.supplier
      ? getPrice(selection.model, selection.supplier)
      : 0;
  const manualPrice = selection.costSource === 'manual' ? Number(selection.snapshotPrice || 0) : 0;
  const isMissingPart = allowCreateMissing && !!selection.model && !!selection.supplier && libraryPrice <= 0;
  const price = isMissingPart ? manualPrice : libraryPrice;
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
          freeSolo
          options={models}
          value={selection.model || ''}
          onChange={(_, value) => onChange('model', value || '')}
          onInputChange={(_, value) => onChange('model', value || '')}
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
        <Autocomplete
          size="small"
          freeSolo
          disabled={!selection.model}
          options={suppliers}
          value={selection.supplier || ''}
          onChange={(_, value) => onChange('supplier', value || '')}
          onInputChange={(_, value) => onChange('supplier', value || '')}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="供应商"
              size="small"
              sx={{ '& .MuiInputBase-root': { py: 0, fontSize: '0.8rem' } }}
            />
          )}
          noOptionsText="可输入新供应商"
          sx={{ minWidth: 120 }}
        />
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
      <TableCell sx={{ py: 0.5, width: 88, textAlign: 'right', color: 'text.secondary', fontSize: '0.8rem' }}>
        {isMissingPart ? (
          <TextField
            type="number"
            size="small"
            value={selection.snapshotPrice ?? ''}
            placeholder="单价"
            inputProps={{ min: 0, step: 0.001, style: { textAlign: 'right', fontSize: '0.8rem', padding: '4px 6px' } }}
            onChange={(e) => {
              onChange('costSource', 'manual');
              onChange('snapshotPrice', Math.max(0, Number(e.target.value) || 0));
            }}
            sx={{ width: 82 }}
          />
        ) : (
          price > 0 ? `¥${price.toFixed(2)}` : '—'
        )}
      </TableCell>

      {/* 小计 */}
      <TableCell sx={{ py: 0.5, width: 80, textAlign: 'right', fontWeight: 'bold', fontSize: '0.82rem', color: subtotal > 0 ? 'primary.main' : 'text.disabled' }}>
        {subtotal > 0 ? `¥${subtotal.toFixed(2)}` : '—'}
      </TableCell>

      {/* 删除 */}
      <TableCell sx={{ py: 0.5, width: 40, pr: 0.5 }}>
        {onDelete ? (
          <Tooltip title="删除">
            <IconButton size="small" color="error" aria-label="删除配方零件" onClick={onDelete} sx={{ p: 0.5 }}>
              <DeleteIcon size={18} />
            </IconButton>
          </Tooltip>
        ) : (
          <span style={{ display: 'inline-block', width: 28 }} />
        )}
      </TableCell>
    </TableRow>
  );
}
