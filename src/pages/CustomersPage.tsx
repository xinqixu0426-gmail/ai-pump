import { useState, useEffect } from 'react';
import { Box, Paper, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Table, TableHead, TableRow, TableCell, TableBody, IconButton } from '@mui/material';
import { Plus, Edit, Trash2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAppStore } from '../utils/store';
import { createCustomer, updateCustomer, deleteCustomer } from '../utils/api';

export default function CustomersPage() {
  const { customers, fetchCustomers, showSnackbar } = useAppStore();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', contactInfo: '', defaultMargin: 0.15, remark: '' });

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const handleSave = async () => {
    try {
      if (editing) await updateCustomer(editing.Id, form);
      else await createCustomer(form);
      await fetchCustomers(true);
      setOpen(false);
      showSnackbar('客户保存成功', 'success');
    } catch (err: any) { showSnackbar(err.message || '保存失败', 'error'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除?')) return;
    try {
      await deleteCustomer(id);
      await fetchCustomers(true);
      showSnackbar('删除成功', 'info');
    } catch (err: any) { showSnackbar(err.message || '删除失败', 'error'); }
  };

  const openForm = (c?: any) => {
    if (c) {
      setEditing(c);
      setForm({ name: c.name, contactInfo: c.contactInfo, defaultMargin: c.defaultMargin, remark: c.remark });
    } else {
      setEditing(null);
      setForm({ name: '', contactInfo: '', defaultMargin: 0.15, remark: '' });
    }
    setOpen(true);
  };

  return (
    <Box>
      <PageHeader title="客户档案" subtitle="管理客户基础信息及利润率" actions={<Button variant="contained" startIcon={<Plus size={20} />} onClick={() => openForm()}>新增客户</Button>} />
      <Paper elevation={0} sx={{ mt: 3, borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
              <TableCell>客户名称</TableCell>
              <TableCell>联系方式</TableCell>
              <TableCell>默认利润率</TableCell>
              <TableCell>备注</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {customers.map(c => (
              <TableRow key={c.Id}>
                <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
                <TableCell>{c.contactInfo}</TableCell>
                <TableCell>{(c.defaultMargin * 100).toFixed(0)}%</TableCell>
                <TableCell>{c.remark}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => openForm(c)}><Edit size={16} /></IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(c.Id)}><Trash2 size={16} /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {customers.length === 0 && (
                <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>暂无客户记录</TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? '编辑客户' : '新增客户'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField label="客户名称" value={form.name} onChange={e => setForm({...form, name: e.target.value})} fullWidth />
          <TextField label="联系方式" value={form.contactInfo} onChange={e => setForm({...form, contactInfo: e.target.value})} fullWidth />
          <TextField label="默认利润率 (小数，例如0.15代表15%)" type="number" inputProps={{ step: 0.01 }} value={form.defaultMargin} onChange={e => setForm({...form, defaultMargin: parseFloat(e.target.value)})} fullWidth />
          <TextField label="备注" value={form.remark} onChange={e => setForm({...form, remark: e.target.value})} fullWidth multiline rows={3} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleSave} variant="contained" disabled={!form.name}>保存</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
