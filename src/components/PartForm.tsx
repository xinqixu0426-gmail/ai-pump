import { useState, useEffect } from 'react';
import {
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Box,
  Stack
} from '@mui/material';
import { Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';
import { Part } from '../types';

interface PartFormProps {
  part: Part | null;
  onSave: (part: Omit<Part, 'Id'>) => void;
  onCancel: () => void;
}

// 预定义类别选项
const CATEGORIES = [
  '轴承',
  '油封',
  '螺丝',
  '泵壳',
  '线圈转子',
  '电容',
  '电缆线',
  '皮垫',
  '其他'
];

export default function PartForm({ part, onSave, onCancel }: PartFormProps) {
  const [model, setModel] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [supplier, setSupplier] = useState('');
  const [stock, setStock] = useState('');
  const [customCategory, setCustomCategory] = useState('');

  // 当编辑的零件变化时，更新表单
  useEffect(() => {
    if (part) {
      setModel(part.型号 || part.model || '');
      const cat = part.类别 || part.category || '';
      if (CATEGORIES.includes(cat)) {
        setCategory(cat);
        setCustomCategory('');
      } else {
        setCategory('其他');
        setCustomCategory(cat);
      }
      setPrice(String(part.单价 || part.price || ''));
      setSupplier(part.供应商 || part.supplier || '');
      setStock(String(part.库存 ?? part.stock ?? ''));
    } else {
      // 清空表单
      setModel('');
      setCategory('');
      setPrice('');
      setSupplier('');
      setStock('');
      setCustomCategory('');
    }
  }, [part]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const finalCategory = category === '其他' ? customCategory : category;

    onSave({
      型号: model,
      类别: finalCategory,
      单价: parseFloat(price) || 0,
      供应商: supplier,
      库存: parseInt(stock) || 0
    });

    if (!part) {
      // 新增后清空表单
      setModel('');
      setCategory('');
      setPrice('');
      setSupplier('');
      setStock('');
      setCustomCategory('');
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={2}>
        <TextField
          label="型号"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="如：201"
          required
          fullWidth
          size="small"
        />

        <FormControl fullWidth size="small" required>
          <InputLabel>类别</InputLabel>
          <Select
            value={category}
            label="类别"
            onChange={(e) => setCategory(e.target.value)}
          >
            <MenuItem value="">
              <em>请选择</em>
            </MenuItem>
            {CATEGORIES.map((cat) => (
              <MenuItem key={cat} value={cat}>
                {cat}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {category === '其他' && (
          <TextField
            label="自定义类别"
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            placeholder="输入自定义类别"
            required
            fullWidth
            size="small"
          />
        )}

        <TextField
          label="单价（元）"
          type="number"
          inputProps={{ step: 0.01, min: 0 }}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          required
          fullWidth
          size="small"
        />

        <TextField
          label="供应商"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="如：张记配件"
          required
          fullWidth
          size="small"
        />

        <TextField
          label="库存数量"
          type="number"
          inputProps={{ min: 0, step: 1 }}
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          placeholder="0"
          fullWidth
          size="small"
        />

        <Stack direction="row" spacing={1}>
          <Button
            type="submit"
            variant="contained"
            startIcon={<SaveIcon />}
            fullWidth
          >
            {part ? '保存修改' : '新增零件'}
          </Button>
          {part && (
            <Button
              variant="outlined"
              startIcon={<CancelIcon />}
              onClick={onCancel}
            >
              取消
            </Button>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}
