import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Chip,
  TextField,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tooltip,
  LinearProgress,
  Alert,
  Collapse,
  InputAdornment,
  Checkbox,
  Slide
} from '@mui/material';
import {
  Plus as AddIcon,
  Search as SearchIcon,
  RefreshCw as RefreshIcon,
  Package as InventoryIcon,
  ChevronDown as ExpandMoreIcon,
  ChevronUp as ExpandLessIcon,
  AlertTriangle as WarningIcon,
  AlertCircle as ErrorOutlineIcon,
  Filter as FilterIcon,
  Wrench as PartIcon,
  CircleDollarSign as MoneyIcon,
  AlertTriangle as AlertIcon,
  PackageMinus as OutIcon,
  Tag as LocalOfferIcon,
  Download as DownloadIcon,
  Trash2 as DeleteIcon,
  X as CloseIcon
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Part } from '../types';
import { createPart, updatePart, deletePart } from '../utils/api';
import { useAppStore } from '../utils/store';
import { colors, gradients } from '../utils/theme';

import { BUILTIN_CATEGORIES, loadCustomCategories, getCatColor, getCatIcon } from '../components/parts/partsConstants';
import CategoryManagerDialog from '../components/parts/CategoryManagerDialog';
import PartFormPanel from '../components/parts/PartFormPanel';
import PartRow from '../components/parts/PartRow';
// ─── 统计卡片 ─────────────────────────────────────────
import StatCard from '../components/StatCard';

// ─── 主页面 ───────────────────────────────────────────

export default function PartsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationState = location.state as { action?: string; searchQuery?: string } | null;
  const consumedNavigationRef = useRef<string | null>(null);
  const { parts, fetchParts, showSnackbar } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingPart, setEditingPart] = useState<Part | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const formRef = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── 类别管理 ─────────────────────────────────────
  const [customCategories, setCustomCategories] = useState<string[]>(() => loadCustomCategories());
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const allCategories = useMemo(() => {
    const dbCats = parts.map(p => p.category).filter(Boolean);
    return Array.from(new Set([...BUILTIN_CATEGORIES, ...customCategories, ...dbCats]));
  }, [customCategories, parts]);

  // 重置选择
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  useEffect(() => { setSelectedIds([]); }, [searchQuery, filterCategory]);

  const loadParts = useCallback(async () => {
    try {
      setLoading(true);
      await fetchParts();
      setError('');
    } catch {
      setError('加载零件数据失败，请检查后端连接。');
    } finally {
      setLoading(false);
    }
  }, [fetchParts]);

  useEffect(() => { loadParts(); }, [loadParts]);

  useEffect(() => {
    if (!navigationState || consumedNavigationRef.current === location.key) return;

    let consumed = false;
    if (navigationState.searchQuery) {
      setSearchQuery(navigationState.searchQuery);
      setFilterCategory('');
      consumed = true;
    }

    if (navigationState.action === 'new-part') {
      setEditingPart(null);
      setDrawerOpen(true);
      consumed = true;
    }

    if (consumed) {
      consumedNavigationRef.current = location.key;
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [navigationState, location.key, location.pathname, navigate]);

  // ── 过滤逻辑 ─────────────────────────────────────
  const filteredParts = useMemo(() => {
    return parts.filter((p) => {
      const q = searchQuery.toLowerCase();
      const matchQuery = !q || p.model.toLowerCase().includes(q) || p.supplier.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
      const matchCat = !filterCategory || p.category === filterCategory;
      return matchQuery && matchCat;
    });
  }, [parts, searchQuery, filterCategory]);

  const groupedParts = useMemo(() => {
    const map: Record<string, Part[]> = {};
    for (const p of filteredParts) {
      const cat = p.category || '未分类';
      if (!map[cat]) map[cat] = [];
      map[cat].push(p);
    }
    return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'zh')));
  }, [filteredParts]);

  const categories = useMemo(() => [...new Set(parts.map((p) => p.category))].sort(), [parts]);
  const supplierOptions = useMemo(() => [...new Set(parts.map((p) => p.supplier).filter(Boolean))].sort(), [parts]);

  // ── KPI ──────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalValue = parts.reduce((sum, p) => sum + p.price * p.stock, 0);
    const lowStock = parts.filter((p) => p.stock > 0 && p.stock <= 5).length;
    const outOfStock = parts.filter((p) => p.stock === 0).length;
    return { totalValue, lowStock, outOfStock };
  }, [parts]);

  // ── CRUD ─────────────────────────────────────────
  const handleSave = async (partData: Omit<Part, 'Id'>, options?: { continueEntry?: boolean }) => {
    try {
      setSaving(true);
      if (editingPart) {
        await updatePart(editingPart.Id, partData);
        showSnackbar(`零件「${partData.model}」已更新`);
      } else {
        await createPart(partData);
        showSnackbar(`零件「${partData.model}」已新增`);
      }
      await fetchParts(true);
      if (!options?.continueEntry) setEditingPart(null);
      setError('');
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (part: Part) => {
    setEditingPart(part);
    setDrawerOpen(true);
  };

  const handleAddNew = () => {
    setEditingPart(null);
    setDrawerOpen(true);
  };

  const handleDrawerClose = () => {
    setDrawerOpen(false);
    setTimeout(() => setEditingPart(null), 200);
  };

  const handleDelete = (id: number) => setDeleteTarget(id);

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    const id = deleteTarget;
    setDeleteTarget(null);
    try {
      await deletePart(id);
      await fetchParts(true);
      setSelectedIds(prev => prev.filter(x => x !== id));
      showSnackbar('零件已删除', 'info');
    } catch {
      setError('删除失败');
    }
  };

  const toggleCategory = (cat: string) =>
    setCollapsedCategories((prev) => { const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next; });

  const toggleSelect = (id: number, checked: boolean) => {
    setSelectedIds(prev => checked ? [...prev, id] : prev.filter(x => x !== id));
  };
  
  const handleSelectGroup = (catParts: Part[]) => {
    const ids = catParts.map(p => p.Id);
    const allSelected = ids.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(x => !ids.includes(x)));
    } else {
      setSelectedIds(prev => [...new Set([...prev, ...ids])]);
    }
  };

  // ── Render ────────────────────────────────────────
  return (
    <Box>
      {/* 页面标题 */}
      <PageHeader
        title="零件管理"
        subtitle="管理所有配件的型号、价格与库存"
        actions={
          <Box display="flex" gap={1}>
            <Tooltip title="刷新数据">
              <span>
                <IconButton id="parts-refresh-btn" onClick={() => loadParts()} disabled={loading}>
                  {loading ? <LinearProgress sx={{ width: 20 }} /> : <RefreshIcon size={24} />}
                </IconButton>
              </span>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<AddIcon size={20} />}
              onClick={handleAddNew}
              sx={{ fontWeight: 700, boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)' }}
            >
              新增零件
            </Button>
          </Box>
        }
      />

      {/* 通知条 */}
      <Collapse in={!!error}>
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>{error}</Alert>
      </Collapse>

      {/* KPI 统计 */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <StatCard label="零件种类" value={parts.length} subtitle={`${categories.length} 个类别`} icon={<PartIcon size={22} />} gradient={gradients.parts} delay={0} />
        <StatCard label="库存总价值" value={`¥${(kpis.totalValue / 10000).toFixed(1)}w`} subtitle="按当前价格估算" icon={<MoneyIcon size={22} />} gradient={gradients.revenue} delay={1} />
        <StatCard label="低库存预警" value={kpis.lowStock} subtitle="库存 ≤ 5 的零件" icon={<AlertIcon size={22} />} gradient={gradients.recipes} delay={2} />
        <StatCard label="缺货零件" value={kpis.outOfStock} subtitle="库存为 0" icon={<OutIcon size={22} />} gradient={gradients.profit} delay={3} />
      </Box>

      {/* 主体：全宽列表 */}
      <Paper elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          {/* 搜索 & 筛选栏 */}
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 1.5, flexWrap: { xs: 'wrap', sm: 'wrap' }, overflowX: 'auto', alignItems: 'center' }}>
            <TextField
              id="parts-search-input"
              size="small" placeholder="搜索型号、供应商..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon size={18} color="rgba(148,163,184,0.6)" /></InputAdornment> }}
              sx={{ flex: 1, minWidth: 180 }}
            />
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel><FilterIcon size={14} style={{ marginRight: 4 }} />分类筛选</InputLabel>
              <Select
                id="parts-category-filter"
                value={filterCategory} label="分类筛选"
                onChange={(e) => setFilterCategory(e.target.value)}
              >
                <MenuItem value="">全部分类</MenuItem>
                {categories.map((cat) => <MenuItem key={cat} value={cat}>{getCatIcon(cat)} {cat}</MenuItem>)}
              </Select>
            </FormControl>
            <Button size="small" variant="text" onClick={() => setCollapsedCategories(new Set())} startIcon={<ExpandMoreIcon size={18} />}>展开全部</Button>
            <Button size="small" variant="text" onClick={() => setCollapsedCategories(new Set(Object.keys(groupedParts)))} startIcon={<ExpandLessIcon size={18} />}>折叠全部</Button>
          </Box>

          {/* 结果统计 */}
          {(searchQuery || filterCategory) && (
            <Box sx={{ px: 2, py: 1, bgcolor: colors.blue.bg, borderBottom: '1px solid', borderColor: colors.blue.border }}>
              <Typography variant="caption" color={colors.blue.text} fontWeight={600}>
                找到 {filteredParts.length} 个零件{filteredParts.length !== parts.length ? `（共 ${parts.length} 个）` : ''}
              </Typography>
            </Box>
          )}

          {/* 列表内容 */}
          {loading && <LinearProgress />}

          {!loading && filteredParts.length === 0 && (
            <Box textAlign="center" py={8} color="text.secondary">
              <InventoryIcon size={48} style={{ opacity: 0.2, marginBottom: 8, display: 'block', marginInline: 'auto' }} />
              <Typography variant="body2">{parts.length === 0 ? '暂无零件，点击右上角录入' : '未找到匹配的零件'}</Typography>
            </Box>
          )}

          {Object.entries(groupedParts).map(([cat, catParts]) => {
            const cc = getCatColor(cat, customCategories);
            const isCollapsed = collapsedCategories.has(cat);
            const lowCount = catParts.filter((p) => p.stock > 0 && p.stock <= 5).length;
            const zeroCount = catParts.filter((p) => p.stock === 0).length;
            return (
              <Box key={cat}>
                {/* 类别标题行 */}
                <Box
                  id={`category-header-${cat}`}
                  onClick={() => toggleCategory(cat)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5,
                    px: 2, py: 1.2, cursor: 'pointer',
                    bgcolor: cc.bg, borderBottom: '1px solid', borderColor: cc.border,
                    borderLeft: `4px solid ${cc.text}`,
                    transition: 'all 0.15s',
                    '&:hover': { filter: 'brightness(0.97)' },
                  }}
                >
                  <Checkbox 
                    size="small" 
                    checked={catParts.length > 0 && catParts.every(p => selectedIds.includes(p.Id))}
                    indeterminate={catParts.some(p => selectedIds.includes(p.Id)) && !catParts.every(p => selectedIds.includes(p.Id))}
                    onChange={() => handleSelectGroup(catParts)}
                    onClick={(e) => e.stopPropagation()}
                    sx={{ p: 0.5, color: cc.text, '&.Mui-checked, &.MuiCheckbox-indeterminate': { color: cc.text } }}
                  />
                  <Typography variant="subtitle2" fontWeight={600} color={cc.text}>{cat}</Typography>
                  <Chip label={`${catParts.length} 项`} size="small" sx={{ height: 20, fontSize: '0.68rem', fontWeight: 600, bgcolor: 'white', color: cc.text, border: `1px solid ${cc.border}` }} />
                  {zeroCount > 0 && <Chip icon={<ErrorOutlineIcon size={14} />} label={`缺货 ${zeroCount}`} size="small" color="error" sx={{ height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { ml: 0.5 } }} />}
                  {lowCount > 0 && <Chip icon={<WarningIcon size={14} />} label={`低库存 ${lowCount}`} size="small" color="warning" sx={{ height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { ml: 0.5 } }} />}
                  <Box flex={1} />
                  <IconButton size="small" sx={{ color: cc.text, opacity: 0.6 }}>
                    {isCollapsed ? <ExpandMoreIcon size={20} /> : <ExpandLessIcon size={20} />}
                  </IconButton>
                </Box>

                {/* 表头 */}
                <Collapse in={!isCollapsed}>
                  <Box sx={{ px: 2, py: 1, display: 'grid', gridTemplateColumns: { xs: '30px 2fr 1fr 70px 80px', sm: '40px 2fr 1fr 1fr 90px 100px 90px' }, gap: 1.5, bgcolor: 'rgba(0,0,0,0.012)', borderBottom: '1px solid', borderColor: 'divider' }}>
                    {[{label:'', hSm:!1}, {label:'型号 / 类别', hSm:!1}, {label:'单价', hSm:!1}, {label:'供应商', hSm:!0}, {label:'库存', hSm:!1}, {label:'录入时间', hSm:!0}, {label:'操作', hSm:!1}].map((h, i) => (
                      <Typography key={i} variant="caption" color="text.disabled" fontWeight={700} sx={{ display: h.hSm ? { xs: 'none', sm: 'block' } : 'block', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.65rem' }}>{h.label}</Typography>
                    ))}
                  </Box>
                  {catParts.map((p, idx) => (
                    <PartRow key={p.Id} part={p} onEdit={handleEdit} onDelete={handleDelete} index={idx} selected={selectedIds.includes(p.Id)} onSelect={toggleSelect} />
                  ))}
                </Collapse>
              </Box>
            );
          })}
      </Paper>

      {/* 零件表单 Dialog */}
      <Dialog
        open={drawerOpen}
        onClose={handleDrawerClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            p: 0,
            overflow: 'visible',
            maxHeight: '90vh',
          },
        }}
      >
        <Box ref={formRef} sx={{ overflow: 'auto', maxHeight: '90vh' }}>
          <PartFormPanel
            editingPart={editingPart}
            onSave={async (partData, options) => {
              await handleSave(partData, options);
              if (!options?.continueEntry) handleDrawerClose();
            }}
            onCancel={handleDrawerClose}
            saving={saving}
            allCategories={allCategories}
            customCategories={customCategories}
            onManageCategories={() => setCatManagerOpen(true)}
            supplierOptions={supplierOptions}
            parts={parts}
            open={drawerOpen}
          />
        </Box>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 600 }}>删除零件</DialogTitle>
        <DialogContent>
          <DialogContentText>确定要删除该零件吗？此操作不可撤销，且可能影响引用此零件的配方成本计算。</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ pb: 2, px: 3 }}>
          <Button autoFocus onClick={() => setDeleteTarget(null)} variant="outlined">取消</Button>
          <Button id="confirm-delete-btn" onClick={confirmDelete} color="error" variant="contained" sx={{ boxShadow: 'none' }}>确认删除</Button>
        </DialogActions>
      </Dialog>

      {/* 类别管理弹窗 */}
      <CategoryManagerDialog
        open={catManagerOpen}
        onClose={() => setCatManagerOpen(false)}
        customCategories={customCategories}
        onChange={setCustomCategories}
      />

      {/* 批量操作浮动栏 */}
      <Slide direction="up" in={selectedIds.length > 0} mountOnEnter unmountOnExit>
        <Paper
          elevation={12}
          sx={{
            position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 2, px: 3, py: 1.5, borderRadius: 999,
            background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)',
            zIndex: 1300, color: 'white', whiteSpace: 'nowrap'
          }}
        >
          <Typography variant="body2" fontWeight={700}>已选择 {selectedIds.length} 项</Typography>
          <Box sx={{ width: 1, height: 24, bgcolor: 'rgba(255,255,255,0.2)' }} />
          <Button variant="text" size="small" sx={{ color: 'white', fontWeight: 600, '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }} startIcon={<LocalOfferIcon />} onClick={() => showSnackbar('批量调价功能开发中', 'info')}>批量调价</Button>
          <Button variant="text" size="small" sx={{ color: 'white', fontWeight: 600, '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }} startIcon={<DownloadIcon />} onClick={() => {
            const selected = parts.filter(p => selectedIds.includes(p.Id));
            const header = '型号,分类,单价,供应商,库存,备注';
            const rows = selected.map(p => [p.model, p.category, p.price, p.supplier, p.stock, (p.notes || '').replace(/,/g, '，')].join(','));
            const csv = '\uFEFF' + [header, ...rows].join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `零件导出_${new Date().toISOString().slice(0,10)}.csv`;
            a.click(); URL.revokeObjectURL(url);
            showSnackbar(`已导出 ${selected.length} 条零件`, 'success');
          }}>导出 CSV</Button>
          <Button variant="text" size="small" sx={{ color: '#ef4444', fontWeight: 600, '&:hover': { bgcolor: 'rgba(239,68,68,0.1)' } }} startIcon={<DeleteIcon />} onClick={async () => {
            if (!confirm(`确定要删除选中的 ${selectedIds.length} 个零件吗？此操作不可撤销。`)) return;
            try {
              await deletePart(selectedIds.map(id => ({ Id: id })) as any);
              await fetchParts(true);
              showSnackbar(`已删除 ${selectedIds.length} 个零件`, 'info');
              setSelectedIds([]);
            } catch { setError('批量删除失败'); }
          }}>删除</Button>
          <IconButton size="small" onClick={() => setSelectedIds([])} sx={{ color: 'rgba(255,255,255,0.5)', ml: 1, p: 0.5 }}><CloseIcon size={18} /></IconButton>
        </Paper>
      </Slide>

    </Box>
  );
}
