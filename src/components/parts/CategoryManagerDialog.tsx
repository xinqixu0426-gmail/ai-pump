import { useState } from 'react';
import {
  Box, Typography, Chip, TextField, Button, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, Stack, Tooltip, Divider,
} from '@mui/material';
import {
  Plus as AddIcon, Edit3 as EditIcon, Trash2 as DeleteIcon,
  X as CancelIcon, Settings as SettingsIcon, Lock as LockIcon, CheckCircle as CheckCircleIcon,
} from 'lucide-react';
import { gradients } from '../../utils/theme';
import { BUILTIN_CATEGORIES, BUILTIN_COLORS, BUILTIN_ICONS, CUSTOM_COLOR_POOL, saveCustomCategories } from './partsConstants';

// ─── 类别管理弹窗 ─────────────────────────────────────

interface CategoryManagerDialogProps {
  open: boolean;
  onClose: () => void;
  customCategories: string[];
  onChange: (cats: string[]) => void;
}

export default function CategoryManagerDialog({ open, onClose, customCategories, onChange }: CategoryManagerDialogProps) {
  const [newCat, setNewCat] = useState('');
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [catError, setCatError] = useState('');

  const allExisting = [...BUILTIN_CATEGORIES, ...customCategories];

  const handleAdd = () => {
    const trimmed = newCat.trim();
    if (!trimmed) { setCatError('类别名称不能为空'); return; }
    if (allExisting.map((c) => c.toLowerCase()).includes(trimmed.toLowerCase())) {
      setCatError('该类别已存在'); return;
    }
    const updated = [...customCategories, trimmed];
    onChange(updated);
    saveCustomCategories(updated);
    setNewCat('');
    setCatError('');
  };

  const handleDelete = (idx: number) => {
    const updated = customCategories.filter((_, i) => i !== idx);
    onChange(updated);
    saveCustomCategories(updated);
    if (editingIdx === idx) { setEditingIdx(null); setEditValue(''); }
  };

  const handleStartEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditValue(customCategories[idx]);
    setCatError('');
  };

  const handleSaveEdit = (idx: number) => {
    const trimmed = editValue.trim();
    if (!trimmed) { setCatError('名称不能为空'); return; }
    const others = allExisting.filter((c) => c !== customCategories[idx]);
    if (others.map((c) => c.toLowerCase()).includes(trimmed.toLowerCase())) {
      setCatError('该类别名称已存在'); return;
    }
    const updated = customCategories.map((c, i) => (i === idx ? trimmed : c));
    onChange(updated);
    saveCustomCategories(updated);
    setEditingIdx(null);
    setEditValue('');
    setCatError('');
  };

  return (
    <Dialog
      open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: 3, overflow: 'hidden' } }}
    >
      <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'center', gap: 1.5, background: gradients.brand, color: 'white' }}>
        <SettingsIcon size={24} />
        <Box>
          <Typography fontWeight={800}>管理零件类别</Typography>
          <Typography variant="caption" sx={{ opacity: 0.75 }}>内置类别受保护，自定义类别可随意增删改</Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 2.5 }}>
        {/* 新增输入行 */}
        <Box display="flex" gap={1} mb={2}>
          <TextField
            id="new-category-input"
            size="small" fullWidth
            label="新增类别名称" placeholder="输入类别名，回车确认"
            value={newCat}
            onChange={(e) => { setNewCat(e.target.value); setCatError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            error={!!catError} helperText={catError || ' '}
          />
          <Button
            id="add-category-btn"
            variant="contained" startIcon={<AddIcon size={18} />}
            onClick={handleAdd}
            sx={{ flexShrink: 0, alignSelf: 'flex-start', mt: '2px', height: 40, background: gradients.parts, boxShadow: 'none' }}
          >
            添加
          </Button>
        </Box>

        <Divider sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>所有类别</Typography>
        </Divider>

        {/* 内置类别（只读） */}
        <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          内置类别（{BUILTIN_CATEGORIES.length} 个，不可删除）
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2.5 }}>
          {BUILTIN_CATEGORIES.map((cat) => (
            <Chip
              key={cat}
              label={`${BUILTIN_ICONS[cat] ?? '📦'} ${cat}`}
              size="small"
              icon={<LockIcon size={11} />}
              sx={{
                fontWeight: 600, fontSize: '0.8rem',
                bgcolor: BUILTIN_COLORS[cat]?.bg ?? '#f8fafc',
                color: BUILTIN_COLORS[cat]?.text ?? '#475569',
                border: `1px solid ${BUILTIN_COLORS[cat]?.border ?? '#e2e8f0'}`,
                '& .MuiChip-icon': { color: 'inherit', opacity: 0.5 },
              }}
            />
          ))}
        </Box>

        {/* 自定义类别 */}
        <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: 'block', mb: 1.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          自定义类别（{customCategories.length} 个）
        </Typography>

        {customCategories.length === 0 ? (
          <Box textAlign="center" py={3} color="text.disabled">
            <SettingsIcon size={32} style={{ opacity: 0.2, display: 'block', margin: '0 auto 4px auto' }} />
            <Typography variant="caption">暂无自定义类别，在上方输入框添加</Typography>
          </Box>
        ) : (
          <Stack spacing={1}>
            {customCategories.map((cat, idx) => {
              const cc = CUSTOM_COLOR_POOL[idx % CUSTOM_COLOR_POOL.length];
              const isEditingRow = editingIdx === idx;
              return (
                <Box
                  key={idx}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1,
                    px: 1.5, py: 1, borderRadius: 2,
                    bgcolor: cc.bg, border: `1px solid ${cc.border}`,
                  }}
                >
                  {isEditingRow ? (
                    <TextField
                      size="small" value={editValue} autoFocus
                      onChange={(e) => { setEditValue(e.target.value); setCatError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(idx); if (e.key === 'Escape') { setEditingIdx(null); setCatError(''); } }}
                      sx={{ flex: 1, '& .MuiInputBase-input': { py: 0.5, fontSize: '0.85rem' } }}
                    />
                  ) : (
                    <Typography variant="body2" fontWeight={600} color={cc.text} flex={1}>🏷️ {cat}</Typography>
                  )}
                  {isEditingRow ? (
                    <>
                      <Tooltip title="保存">
                        <IconButton size="small" color="success" onClick={() => handleSaveEdit(idx)}><CheckCircleIcon size={18} /></IconButton>
                      </Tooltip>
                      <Tooltip title="取消">
                        <IconButton size="small" onClick={() => { setEditingIdx(null); setCatError(''); }}><CancelIcon size={18} /></IconButton>
                      </Tooltip>
                    </>
                  ) : (
                    <>
                      <Tooltip title="重命名">
                        <IconButton size="small" color="primary" onClick={() => handleStartEdit(idx)}><EditIcon size={18} /></IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton size="small" color="error" onClick={() => handleDelete(idx)}><DeleteIcon size={18} /></IconButton>
                      </Tooltip>
                    </>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button autoFocus onClick={onClose} variant="contained" sx={{ background: gradients.brand, boxShadow: 'none', fontWeight: 700 }}>完成</Button>
      </DialogActions>
    </Dialog>
  );
}

