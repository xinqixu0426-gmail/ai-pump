import { useCallback, MutableRefObject } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, TextField,
  Button, Table, TableBody, TableCell, TableHead, TableRow, Divider,
  IconButton, CircularProgress, Autocomplete, Typography, ToggleButton,
  ToggleButtonGroup, Checkbox, Tooltip,
} from '@mui/material';
import {
  Trash2 as DeleteIcon, Plus as AddIcon, Save as SaveIcon, X as CloseIcon,
} from 'lucide-react';
import { PumpShellTemplate, Part } from '../types';

export interface PartFormRow {
  id: number;
  name: string;
  model: string;
  qty: number;
  supplier: string;
}

export interface ShellComponentFormRow {
  id: number;
  name: string;
  model: string;
  qty: number;
  unitCost: number;
  included: boolean;
  optional: boolean;
  note: string;
}

const NAME_TO_CATEGORY: Record<string, string> = {
  '花板轴承': '轴承', '油缸轴承': '轴承', '轴承': '轴承',
  '机械油封': '油封', '骨架油封': '油封', '油封': '油封',
  '皮垫': '密封件', 'O型圈': '密封件',
  '螺丝': '螺丝', '螺杆': '螺丝', '螺母': '螺丝', '不锈钢长螺丝': '螺丝',
  '叶轮': '叶轮', '电容': '电容',
};

const DEFAULT_SHELL_COMPONENT_NAMES = ['上帽', '机筒', '花板', '油缸', '泵头', '叶轮', '底座', '法兰'];

interface Props {
  open: boolean;
  onClose: () => void;
  editingTpl: PumpShellTemplate | null;
  shellModel: string;
  setShellModel: (v: string) => void;
  tplDescription: string;
  setTplDescription: (v: string) => void;
  partRows: PartFormRow[];
  setPartRows: React.Dispatch<React.SetStateAction<PartFormRow[]>>;
  shellComponentRows: ShellComponentFormRow[];
  setShellComponentRows: React.Dispatch<React.SetStateAction<ShellComponentFormRow[]>>;
  parts: Part[];
  shellModels: string[];
  uniqueModels: string[];
  tplSaving: boolean;
  onSave: () => void;
  nextRowId: MutableRefObject<number>;
  assemblyWage: number;
  setAssemblyWage: (v: number) => void;
  packingWage: number;
  setPackingWage: (v: number) => void;
  costMode: 'bundle' | 'components';
  setCostMode: (v: 'bundle' | 'components') => void;
  bundleCost: number;
  setBundleCost: (v: number) => void;
}

export default function TemplateFormDialog({
  open, onClose, editingTpl,
  shellModel, setShellModel,
  tplDescription, setTplDescription,
  partRows, setPartRows, shellComponentRows, setShellComponentRows,
  parts, shellModels, uniqueModels,
  tplSaving, onSave, nextRowId,
  assemblyWage, setAssemblyWage, packingWage, setPackingWage,
  costMode, setCostMode, bundleCost, setBundleCost,
}: Props) {
  const getCategoryFromName = useCallback((name: string): string | null => {
    if (!name) return null;
    const n = name.trim();
    if (NAME_TO_CATEGORY[n]) return NAME_TO_CATEGORY[n];
    for (const [key, cat] of Object.entries(NAME_TO_CATEGORY)) {
      if (n.includes(key)) return cat;
    }
    return null;
  }, []);

  const getModelsByCategory = useCallback((category: string | null): string[] => {
    if (!category) return uniqueModels;
    const set = new Set<string>();
    parts.forEach(p => { if (p.category === category && p.model) set.add(p.model); });
    return Array.from(set).sort();
  }, [parts, uniqueModels]);

  const handlePartRowChange = (id: number, field: keyof Omit<PartFormRow, 'id'>, value: string | number) => {
    setPartRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, [field]: value };
      if (field === 'model') updated.supplier = '';
      return updated;
    }));
  };

  const handleShellComponentChange = (
    id: number,
    field: keyof Omit<ShellComponentFormRow, 'id'>,
    value: string | number | boolean
  ) => {
    setShellComponentRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const checkStainlessScrewRow = useCallback((currentShellModel: string) => {
    const shellPart = parts.find(p => ['泵壳', '泵体', '壳体'].includes(p.category) && p.model === currentShellModel);
    let isStainless = false;
    if (shellPart?.notes) {
      try {
        isStainless = JSON.parse(shellPart.notes).isStainless === true;
      } catch {
        isStainless = shellPart.notes.includes('不锈钢机筒');
      }
    }

    setPartRows(prev => {
      const hasRow = prev.some(r => r.name === '不锈钢长螺丝');
      if (isStainless && !hasRow) {
        return [...prev, { id: nextRowId.current++, name: '不锈钢长螺丝', model: '', qty: 1, supplier: '' }];
      }
      if (!isStainless && hasRow) {
        return prev.filter(r => r.name !== '不锈钢长螺丝');
      }
      return prev;
    });
  }, [parts, nextRowId, setPartRows]);

  const addShellComponentRow = () => {
    const used = new Set(shellComponentRows.map(row => row.name));
    const nextName = DEFAULT_SHELL_COMPONENT_NAMES.find(name => !used.has(name)) || '';
    setShellComponentRows(prev => [
      ...prev,
      {
        id: nextRowId.current++,
        name: nextName,
        model: '',
        qty: 1,
        unitCost: 0,
        included: true,
        optional: nextName === '法兰',
        note: '',
      },
    ]);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {editingTpl ? `编辑模板 - ${editingTpl.shellModel}` : '新建泵壳模板'}
        <IconButton aria-label="关闭模板表单" onClick={onClose}><CloseIcon size={20} /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Box display="flex" gap={2} mb={2} mt={1}>
          <Autocomplete
            freeSolo
            disableClearable
            options={shellModels}
            value={shellModel}
            onChange={(_e, v) => { setShellModel(v || ''); checkStainlessScrewRow(v || ''); }}
            onInputChange={(_e, v) => { setShellModel(v || ''); }}
            sx={{ flex: 1 }}
            renderInput={(params) => (
              <TextField {...params} label="泵壳型号" placeholder="搜索或输入泵壳型号" required size="small" />
            )}
          />
          <TextField
            label="描述(可选)"
            value={tplDescription}
            onChange={e => setTplDescription(e.target.value)}
            placeholder="如 V750 标准配件包"
            size="small"
            sx={{ flex: 2 }}
          />
        </Box>

        <Box display="flex" gap={2} alignItems="center" mb={2} flexWrap="wrap">
          <ToggleButtonGroup
            exclusive
            size="small"
            value={costMode}
            onChange={(_e, value) => { if (value) setCostMode(value); }}
          >
            <ToggleButton value="bundle">泵壳整套报价</ToggleButton>
            <ToggleButton value="components">泵壳组件明细</ToggleButton>
          </ToggleButtonGroup>
          {costMode === 'bundle' && (
            <TextField
              label="整套泵壳成本"
              type="number"
              size="small"
              required
              value={bundleCost || ''}
              onChange={e => setBundleCost(Math.max(0, parseFloat(e.target.value) || 0))}
              inputProps={{ min: 0, step: 0.01 }}
              sx={{ width: 160 }}
            />
          )}
        </Box>

        {costMode === 'components' && (
          <>
            <Typography variant="subtitle2" fontWeight={700} mb={1} color="text.secondary">
              泵壳组件明细
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', width: 110 }}>组件名称</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>型号/规格</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', width: 70 }}>数量</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', width: 90 }}>单价</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', width: 70 }}>计入</TableCell>
                  <TableCell sx={{ width: 40 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {shellComponentRows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell sx={{ py: 0.5 }}>
                      <TextField
                        size="small"
                        fullWidth
                        value={row.name}
                        onChange={e => handleShellComponentChange(row.id, 'name', e.target.value)}
                        placeholder="如 上帽"
                        variant="standard"
                        inputProps={{ style: { fontSize: '0.85rem' } }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <TextField
                        size="small"
                        fullWidth
                        value={row.model}
                        onChange={e => handleShellComponentChange(row.id, 'model', e.target.value)}
                        placeholder="如 V750-上帽"
                        variant="standard"
                        inputProps={{ style: { fontSize: '0.85rem' } }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <TextField
                        size="small"
                        type="number"
                        value={row.qty}
                        onChange={e => handleShellComponentChange(row.id, 'qty', Math.max(1, parseFloat(e.target.value) || 1))}
                        variant="standard"
                        sx={{ width: 50 }}
                        inputProps={{ min: 1, step: 0.1, style: { fontSize: '0.85rem', textAlign: 'center' } }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <TextField
                        size="small"
                        type="number"
                        value={row.unitCost || ''}
                        onChange={e => handleShellComponentChange(row.id, 'unitCost', Math.max(0, parseFloat(e.target.value) || 0))}
                        variant="standard"
                        sx={{ width: 72 }}
                        inputProps={{ min: 0, step: 0.01, style: { fontSize: '0.85rem', textAlign: 'right' } }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <Tooltip title="是否计入泵壳本体成本">
                        <Checkbox
                          size="small"
                          checked={row.included !== false}
                          onChange={e => handleShellComponentChange(row.id, 'included', e.target.checked)}
                        />
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      <IconButton size="small" color="error" aria-label="删除泵壳组件行" onClick={() => setShellComponentRows(prev => prev.filter(r => r.id !== row.id))}>
                        <DeleteIcon size={18} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button size="small" startIcon={<AddIcon size={18} />} onClick={addShellComponentRow} sx={{ mt: 1 }}>
              添加泵壳组件
            </Button>
            <Divider sx={{ my: 2 }} />
          </>
        )}

        <Typography variant="subtitle2" fontWeight={700} mb={1} color="text.secondary">
          固定配件清单
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', width: 110 }}>配件名称</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>型号</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', width: 70 }}>数量</TableCell>
              <TableCell sx={{ width: 40 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {partRows.map(row => {
              const rowCat = getCategoryFromName(row.name);
              const filteredModels = getModelsByCategory(rowCat);
              return (
                <TableRow key={row.id}>
                  <TableCell sx={{ py: 0.5 }}>
                    <TextField
                      size="small"
                      fullWidth
                      value={row.name}
                      onChange={e => handlePartRowChange(row.id, 'name', e.target.value)}
                      placeholder="如 花板轴承"
                      variant="standard"
                      inputProps={{ style: { fontSize: '0.85rem' } }}
                    />
                  </TableCell>
                  <TableCell sx={{ py: 0.5 }}>
                    <Autocomplete
                      freeSolo
                      disableClearable
                      options={filteredModels}
                      value={row.model}
                      onChange={(_e, v) => handlePartRowChange(row.id, 'model', v || '')}
                      onInputChange={(_e, v) => handlePartRowChange(row.id, 'model', v || '')}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          size="small"
                          fullWidth
                          placeholder={rowCat ? `搜索${rowCat}型号` : '搜索或输入型号'}
                          variant="standard"
                          inputProps={{ ...params.inputProps, style: { fontSize: '0.85rem' } }}
                        />
                      )}
                      sx={{ minWidth: 120 }}
                    />
                  </TableCell>
                  <TableCell sx={{ py: 0.5 }}>
                    <TextField
                      size="small"
                      type="number"
                      value={row.qty}
                      onChange={e => handlePartRowChange(row.id, 'qty', Math.max(1, parseInt(e.target.value) || 1))}
                      variant="standard"
                      sx={{ width: 50 }}
                      inputProps={{ min: 1, style: { fontSize: '0.85rem', textAlign: 'center' } }}
                    />
                  </TableCell>
                  <TableCell sx={{ py: 0.5 }}>
                    <IconButton size="small" color="error" aria-label="删除固定配件行" onClick={() => setPartRows(prev => prev.filter(r => r.id !== row.id))}>
                      <DeleteIcon size={18} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Button
          size="small"
          startIcon={<AddIcon size={18} />}
          onClick={() => setPartRows(prev => [...prev, { id: nextRowId.current++, name: '', model: '', qty: 1, supplier: '' }])}
          sx={{ mt: 1 }}
        >
          添加固定配件
        </Button>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" fontWeight={700} mb={1} color="text.secondary">
          人工计件工资(元/台)
        </Typography>
        <Box display="flex" gap={2} flexWrap="wrap">
          <TextField
            label="安装工资"
            type="number"
            size="small"
            required
            value={assemblyWage || ''}
            onChange={e => setAssemblyWage(parseFloat(e.target.value) || 0)}
            inputProps={{ min: 0, step: 0.5 }}
            sx={{ width: 130 }}
            helperText="必填"
          />
          <TextField
            label="打包工资"
            type="number"
            size="small"
            required
            value={packingWage || ''}
            onChange={e => setPackingWage(parseFloat(e.target.value) || 0)}
            inputProps={{ min: 0, step: 0.5 }}
            sx={{ width: 130 }}
            helperText="必填"
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" startIcon={tplSaving ? <CircularProgress size={16} /> : <SaveIcon size={20} />} onClick={onSave} disabled={tplSaving || !shellModel.trim()}>
          {editingTpl ? '更新' : '创建'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
