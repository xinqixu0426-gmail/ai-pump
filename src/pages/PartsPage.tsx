import { useState, useEffect, useCallback } from 'react';
import {
  Grid,
  Paper,
  Typography,
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button
} from '@mui/material';
import { Part } from '../types';
import { createPart, updatePart, deletePart } from '../utils/api';
import { useAppStore } from '../utils/store';
import PartForm from '../components/PartForm';
import PartList from '../components/PartList';

export default function PartsPage() {
  const { parts, fetchParts } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingPart, setEditingPart] = useState<Part | null>(null);

  // 加载零件数据
  const loadParts = useCallback(async () => {
    try {
      setLoading(true);
      await fetchParts();
      setError('');
    } catch (err) {
      setError('加载零件数据失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [fetchParts]);

  useEffect(() => {
    loadParts();
  }, [loadParts]);

  // 创建或更新零件
  const handleSave = async (partData: Omit<Part, 'Id'>) => {
    try {
      if (editingPart) {
        await updatePart(editingPart.Id, partData);
      } else {
        await createPart(partData);
      }
      await fetchParts(true);
      setEditingPart(null);
    } catch (err) {
      setError('保存失败');
      console.error(err);
    }
  };

  // 删除零件
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const handleDelete = (id: number) => {
    setDeleteTarget(id);
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    try {
      await deletePart(id);
      await fetchParts(true);
    } catch (err) {
      setError('删除失败');
      console.error(err);
    }
  };

  // 编辑零件
  const handleEdit = (part: Part) => {
    setEditingPart(part);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 取消编辑
  const handleCancel = () => {
    setEditingPart(null);
  };

  return (
    <Grid container spacing={3}>
      {/* 左侧：表单 */}
      <Grid item xs={12} md={3}>
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom color="primary">
            {editingPart ? '修改零件' : '录入零件'}
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          <PartForm
            part={editingPart}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        </Paper>
      </Grid>

      {/* 右侧：列表 */}
      <Grid item xs={12} md={9}>
        <Paper elevation={2} sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" color="success.main" sx={{ flexGrow: 1 }}>
              零件列表
            </Typography>
            {loading && <CircularProgress size={20} />}
          </Box>

          <PartList
            parts={parts}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </Paper>
      </Grid>
      {/* 删除确认弹窗 */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>删除零件</DialogTitle>
        <DialogContent>
          <DialogContentText>确定要删除这个零件吗？此操作不可撤销。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button onClick={confirmDelete} color="error" variant="contained">删除</Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
