import { Box, Typography, Chip, IconButton, Tooltip, Fade, Checkbox } from '@mui/material';
import { Edit3 as EditIcon, Trash2 as DeleteIcon } from 'lucide-react';
import { Part } from '../../types';
import { stockStatus, getCatColor, loadCustomCategories } from './partsConstants';

// ─── 零件行 ───────────────────────────────────────────

interface PartRowProps { 
  part: Part; 
  onEdit: (p: Part) => void; 
  onDelete: (id: number) => void; 
  index: number; 
  selected?: boolean;
  onSelect?: (id: number, checked: boolean) => void;
}

export default function PartRow({ part, onEdit, onDelete, index, selected, onSelect }: PartRowProps) {
  const ss = stockStatus(part.stock);
  const customCats = loadCustomCategories();
  const cc = getCatColor(part.category, customCats);

  // 解析泵壳元数据
  const pumpMeta: { isStainless: boolean; barrelLength?: number; openFactor?: number } | null =
    part.category === '泵壳' && part.notes
      ? (() => { try { return JSON.parse(part.notes); } catch { return null; } })()
      : null;

  return (
    <Fade in timeout={200 + index * 40}>
      <Box
        id={`part-row-${part.Id}`}
        sx={{
          display: 'grid',
          gridTemplateColumns: onSelect 
            ? { xs: '30px 2fr 1fr 70px 80px', sm: '40px 2fr 1fr 1fr 90px 90px' }
            : { xs: '2fr 1fr 70px 80px', sm: '2fr 1fr 1fr 90px 90px' },
          alignItems: 'center',
          gap: 1.5, px: 2, py: 1.5,
          borderBottom: '1px solid', borderColor: 'divider',
          transition: 'background 0.15s',
          '&:last-child': { border: 'none' },
          '&:hover': { bgcolor: 'rgba(0,0,0,0.018)' },
        }}
      >
        {onSelect && (
          <Checkbox 
            checked={!!selected} 
            onChange={(e) => onSelect(part.Id, e.target.checked)} 
            size="small" 
            sx={{ p: 0 }}
          />
        )}
        <Box>
          <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>{part.model}</Typography>
          <Box display="flex" gap={0.5} flexWrap="wrap" mt={0.3}>
            <Chip label={part.category} size="small" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 600, bgcolor: cc.bg, color: cc.text, border: `1px solid ${cc.border}` }} />
            {pumpMeta?.isStainless && (
              <Tooltip title={`不锈钢机筒${pumpMeta.barrelLength ? `  机筒长度: ${pumpMeta.barrelLength}mm` : ''}${pumpMeta.openFactor ? `  开档系数: ${pumpMeta.openFactor}` : ''}`}>
                <Chip
                  label={`✨ SS${pumpMeta.barrelLength ? ` ${pumpMeta.barrelLength}mm` : ''}`}
                  size="small"
                  sx={{ height: 18, fontSize: '0.62rem', fontWeight: 700, bgcolor: '#0284c7', color: 'white', cursor: 'default' }}
                />
              </Tooltip>
            )}
          </Box>
        </Box>
        <Typography variant="body2" fontWeight={700} color="text.primary">¥{part.price.toFixed(2)}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {part.supplier || '-'}
        </Typography>
        <Box>
          <Chip
            label={part.stock} size="small" color={ss.color} variant="outlined"
            sx={{ fontWeight: 700, minWidth: 36, fontSize: '0.78rem' }}
          />
          <Typography variant="caption" color={`${ss.color}.main`} sx={{ display: 'block', fontSize: '0.62rem', mt: 0.1 }}>
            {ss.label}
          </Typography>
        </Box>
        <Box display="flex" gap={0.5} justifyContent="flex-end">
          <Tooltip title="编辑">
            <IconButton id={`edit-part-${part.Id}`} size="small" color="primary" onClick={() => onEdit(part)}>
              <EditIcon size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title="删除">
            <IconButton id={`delete-part-${part.Id}`} size="small" color="error" onClick={() => onDelete(part.Id)}>
              <DeleteIcon size={18} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Fade>
  );
}

