import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  TextField,
  Button,
  IconButton,
  Fade,
  Divider,
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
  Badge,
  Drawer,
} from '@mui/material';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Inventory as InventoryIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  ErrorOutline as ErrorOutlineIcon,
  BugReport as BugReportIcon,
  PlayArrow as PlayIcon,
  FilterList as FilterIcon,
} from '@mui/icons-material';
import { Part } from '../types';
import { createPart, updatePart, deletePart } from '../utils/api';
import { useAppStore } from '../utils/store';
import { colors, gradients } from '../utils/theme';

import { BUILTIN_CATEGORIES, loadCustomCategories, getCatColor, getCatIcon, stockStatus } from '../components/parts/partsConstants';
import CategoryManagerDialog from '../components/parts/CategoryManagerDialog';
import PartFormPanel from '../components/parts/PartFormPanel';
import PartRow from '../components/parts/PartRow';
// ─── 统计卡片 ─────────────────────────────────────────
import StatCard from '../components/StatCard';

// ─── 主页面 ───────────────────────────────────────────

export default function PartsPage() {
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

  const [harnessOpen, setHarnessOpen] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testRunning, setTestRunning] = useState(false);

  // ── 类别管理 ─────────────────────────────────────
  const [customCategories, setCustomCategories] = useState<string[]>(() => loadCustomCategories());
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const allCategories = useMemo(() => {
    const dbCats = parts.map(p => p.category).filter(Boolean);
    return Array.from(new Set([...BUILTIN_CATEGORIES, ...customCategories, ...dbCats]));
  }, [customCategories, parts]);

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
  const handleSave = async (partData: Omit<Part, 'Id'>) => {
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
      setEditingPart(null);
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
      showSnackbar('零件已删除', 'info');
    } catch {
      setError('删除失败');
    }
  };

  const toggleCategory = (cat: string) =>
    setCollapsedCategories((prev) => { const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next; });

  // ── Render ────────────────────────────────────────
  return (
    <Box>
      {/* 页面标题 */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box>
          <Typography variant="h5" fontWeight={800} sx={{ letterSpacing: -0.5 }}>🔩 零件管理</Typography>
          <Typography variant="caption" color="text.secondary">管理所有配件的型号、价格与库存</Typography>
        </Box>
        <Box display="flex" gap={1}>
          <Tooltip title="运行自动化测试">
            <Badge badgeContent={testResults.filter((r) => !r.passed).length || null} color="error">
              <IconButton
                id="harness-toggle-btn"
                onClick={() => setHarnessOpen((v) => !v)}
                sx={{ bgcolor: harnessOpen ? '#fdf4ff' : 'action.hover', color: harnessOpen ? colors.purple.main : 'inherit', border: harnessOpen ? `1px solid ${colors.purple.border}` : '1px solid transparent' }}
              >
                <BugReportIcon />
              </IconButton>
            </Badge>
          </Tooltip>
          <Tooltip title="刷新数据">
            <span>
              <IconButton id="parts-refresh-btn" onClick={() => loadParts()} disabled={loading}>
                {loading ? <LinearProgress sx={{ width: 20 }} /> : <RefreshIcon />}
              </IconButton>
            </span>
          </Tooltip>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddNew}
            sx={{ fontWeight: 700, boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)' }}
          >
            新增零件
          </Button>
        </Box>
      </Box>

      {/* 通知条 */}
      <Collapse in={!!error}>
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>{error}</Alert>
      </Collapse>

      {/* KPI 统计 */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <StatCard label="零件种类" value={parts.length} subtitle={`${categories.length} 个类别`} gradient={gradients.parts} delay={0} />
        <StatCard label="库存总价值" value={`¥${(kpis.totalValue / 10000).toFixed(1)}w`} subtitle="按当前价格估算" gradient={gradients.revenue} delay={1} />
        <StatCard label="低库存预警" value={kpis.lowStock} subtitle="库存 ≤ 5 的零件" gradient={gradients.recipes} delay={2} />
        <StatCard label="缺货零件" value={kpis.outOfStock} subtitle="库存为 0" gradient={gradients.profit} delay={3} />
      </Box>

      {/* 主体：全宽列表 */}
      <Paper elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          {/* 搜索 & 筛选栏 */}
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 1.5, flexWrap: { xs: 'wrap', sm: 'wrap' }, overflowX: 'auto', alignItems: 'center' }}>
            <TextField
              id="parts-search-input"
              size="small" placeholder="搜索型号、供应商..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} /></InputAdornment> }}
              sx={{ flex: 1, minWidth: 180 }}
            />
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel><FilterIcon sx={{ fontSize: 14, mr: 0.3 }} />分类筛选</InputLabel>
              <Select
                id="parts-category-filter"
                value={filterCategory} label="分类筛选"
                onChange={(e) => setFilterCategory(e.target.value)}
              >
                <MenuItem value="">全部分类</MenuItem>
                {categories.map((cat) => <MenuItem key={cat} value={cat}>{getCatIcon(cat)} {cat}</MenuItem>)}
              </Select>
            </FormControl>
            <Button size="small" variant="text" onClick={() => setCollapsedCategories(new Set())} startIcon={<ExpandMoreIcon />}>展开全部</Button>
            <Button size="small" variant="text" onClick={() => setCollapsedCategories(new Set(Object.keys(groupedParts)))} startIcon={<ExpandLessIcon />}>折叠全部</Button>
          </Box>

          {/* 结果统计 */}
          {(searchQuery || filterCategory) && (
            <Box sx={{ px: 2, py: 1, bgcolor: colors.blue.bg, borderBottom: '1px solid', borderColor: colors.blue.border }}>
              <Typography variant="caption" color={colors.blue.text} fontWeight={600}>
                🔍 找到 {filteredParts.length} 个零件{filteredParts.length !== parts.length ? `（共 ${parts.length} 个）` : ''}
              </Typography>
            </Box>
          )}

          {/* 列表内容 */}
          {loading && <LinearProgress />}

          {!loading && filteredParts.length === 0 && (
            <Box textAlign="center" py={8} color="text.secondary">
              <InventoryIcon sx={{ fontSize: 48, opacity: 0.2, mb: 1, display: 'block', mx: 'auto' }} />
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
                    borderLeft: `4px solid ${cc.text}20`,
                    transition: 'all 0.15s',
                    '&:hover': { filter: 'brightness(0.97)' },
                  }}
                >
                  <Typography sx={{ fontSize: '1rem' }}>{getCatIcon(cat)}</Typography>
                  <Typography variant="subtitle2" fontWeight={800} color={cc.text}>{cat}</Typography>
                  <Chip label={`${catParts.length} 项`} size="small" sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700, bgcolor: 'white', color: cc.text, border: `1px solid ${cc.border}` }} />
                  {zeroCount > 0 && <Chip icon={<ErrorOutlineIcon sx={{ fontSize: '12px !important' }} />} label={`缺货 ${zeroCount}`} size="small" color="error" sx={{ height: 20, fontSize: '0.68rem' }} />}
                  {lowCount > 0 && <Chip icon={<WarningIcon sx={{ fontSize: '12px !important' }} />} label={`低库存 ${lowCount}`} size="small" color="warning" sx={{ height: 20, fontSize: '0.68rem' }} />}
                  <Box flex={1} />
                  <IconButton size="small" sx={{ color: cc.text, opacity: 0.6 }}>
                    {isCollapsed ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
                  </IconButton>
                </Box>

                {/* 表头 */}
                <Collapse in={!isCollapsed}>
                  <Box sx={{ px: 2, py: 1, display: 'grid', gridTemplateColumns: { xs: '2fr 1fr 70px 80px', sm: '2fr 1fr 1fr 90px 90px' }, gap: 1.5, bgcolor: 'rgba(0,0,0,0.012)', borderBottom: '1px solid', borderColor: 'divider' }}>
                    {['型号 / 类别', '单价', '供应商', '库存', '操作'].map((h) => (
                      <Typography key={h} variant="caption" color="text.disabled" fontWeight={700} sx={{ display: h === '供应商' ? { xs: 'none', sm: 'block' } : 'block', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.65rem' }}>{h}</Typography>
                    ))}
                  </Box>
                  {catParts.map((p, idx) => (
                    <PartRow key={p.Id} part={p} onEdit={handleEdit} onDelete={handleDelete} index={idx} />
                  ))}
                </Collapse>
              </Box>
            );
          })}
      </Paper>

      {/* 零件表单 Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={handleDrawerClose}
        PaperProps={{ sx: { width: { xs: '100%', sm: 400 }, p: 0, border: 'none' } }}
      >
        <Box ref={formRef} sx={{ height: '100%' }}>
          <PartFormPanel
            editingPart={editingPart}
            onSave={async (partData) => {
              await handleSave(partData);
              handleDrawerClose();
            }}
            onCancel={handleDrawerClose}
            saving={saving}
            allCategories={allCategories}
            customCategories={customCategories}
            onManageCategories={() => setCatManagerOpen(true)}
            supplierOptions={supplierOptions}
            open={drawerOpen}
          />
        </Box>
      </Drawer>

      {/* 删除确认弹窗 */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>⚠️ 删除零件</DialogTitle>
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

      {/* ══════════════════════════════════════════════════════════
          Harness 自动化测试面板（仅开发/演示用）
          ══════════════════════════════════════════════════════════ */}
      <Collapse in={harnessOpen}>
        <HarnessPanel parts={parts} testResults={testResults} setTestResults={setTestResults} testRunning={testRunning} setTestRunning={setTestRunning} />
      </Collapse>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════
//  HARNESS — 自动化测试引擎
// ═══════════════════════════════════════════════════════════════

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

interface HarnessPanelProps {
  parts: Part[];
  testResults: TestResult[];
  setTestResults: (r: TestResult[]) => void;
  testRunning: boolean;
  setTestRunning: (v: boolean) => void;
}

function HarnessPanel({ parts, testResults, setTestResults, testRunning, setTestRunning }: HarnessPanelProps) {

  // ── 测试用例定义 ──────────────────────────────────
  type TestCase = { id: string; name: string; fn: () => boolean | string };

  const testCases: TestCase[] = [
    // ── TC-01: 零件数组非空 ──
    {
      id: 'TC-01',
      name: '数据加载：零件列表应已从后端加载',
      fn: () => {
        if (parts.length === 0) return '零件列表为空，请先运行 seed-demo-data.cjs 生成演示数据';
        return true;
      },
    },

    // ── TC-02: Part 类型结构完整性 ──
    {
      id: 'TC-02',
      name: '数据结构：每个 Part 对象应包含必须字段',
      fn: () => {
        const required: (keyof Part)[] = ['Id', 'model', 'category', 'price', 'supplier', 'stock'];
        for (const p of parts) {
          for (const key of required) {
            if (p[key] === undefined || p[key] === null)
              return `零件 ID=${p.Id} 缺少字段: ${key}`;
          }
        }
        return true;
      },
    },

    // ── TC-03: price 字段为有限正数 ──
    {
      id: 'TC-03',
      name: '数据校验：所有零件的 price 应为 ≥ 0 的有限数字',
      fn: () => {
        const bad = parts.filter((p) => typeof p.price !== 'number' || !isFinite(p.price) || p.price < 0);
        if (bad.length > 0) return `以下零件 price 不合法: ${bad.map((p) => `[${p.Id}] ${p.model}`).join(', ')}`;
        return true;
      },
    },

    // ── TC-04: stock 字段为整数 ──
    {
      id: 'TC-04',
      name: '数据校验：所有零件的 stock 应为非负整数',
      fn: () => {
        const bad = parts.filter((p) => !Number.isInteger(p.stock) || p.stock < 0);
        if (bad.length > 0) return `以下零件 stock 不合法: ${bad.map((p) => `[${p.Id}] ${p.model}=${p.stock}`).join(', ')}`;
        return true;
      },
    },

    // ── TC-05: model 字段非空字符串 ──
    {
      id: 'TC-05',
      name: '数据校验：所有零件的 model 字段不得为空',
      fn: () => {
        const bad = parts.filter((p) => !p.model || !p.model.trim());
        if (bad.length > 0) return `发现 ${bad.length} 个 model 为空的零件, IDs: ${bad.map((p) => p.Id).join(', ')}`;
        return true;
      },
    },

    // ── TC-06: category 字段存在且非空 ──
    {
      id: 'TC-06',
      name: '业务逻辑：所有零件应有非空 category 分类',
      fn: () => {
        const bad = parts.filter((p) => !p.category || !p.category.trim());
        if (bad.length > 0) return `发现 ${bad.length} 个 category 为空的零件`;
        return true;
      },
    },

    // ── TC-07: 分组逻辑 — category 与分组匹配 ──
    {
      id: 'TC-07',
      name: '前端逻辑：分组后每组 category 应与组名一致',
      fn: () => {
        const map: Record<string, Part[]> = {};
        for (const p of parts) {
          const cat = p.category || '未分类';
          if (!map[cat]) map[cat] = [];
          map[cat].push(p);
        }
        for (const [cat, group] of Object.entries(map)) {
          const mismatch = group.filter((p) => (p.category || '未分类') !== cat);
          if (mismatch.length > 0) return `分组「${cat}」包含 category 不匹配的条目`;
        }
        return true;
      },
    },

    // ── TC-08: 搜索过滤 — keyword 命中率 ──
    {
      id: 'TC-08',
      name: '搜索过滤：关键词过滤应正确匹配 model/supplier/category',
      fn: () => {
        if (parts.length === 0) return '无零件数据，跳过';
        const keyword = parts[0].model.slice(0, 2).toLowerCase();
        const result = parts.filter((p) =>
          p.model.toLowerCase().includes(keyword) ||
          p.supplier.toLowerCase().includes(keyword) ||
          p.category.toLowerCase().includes(keyword)
        );
        if (result.length === 0) return `以关键词「${keyword}」搜索，期望至少 1 条结果，实际 0 条`;
        return true;
      },
    },

    // ── TC-09: stockStatus 函数无 undefined ──
    {
      id: 'TC-09',
      name: '工具函数：stockStatus() 对任意 stock 值应返回合法结果',
      fn: () => {
        const testValues = [0, 1, 5, 6, 100, -1, NaN];
        for (const v of testValues) {
          const r = stockStatus(v);
          if (!r || !r.label || !r.color || !r.gradient) return `stockStatus(${v}) 返回了无效结果: ${JSON.stringify(r)}`;
        }
        return true;
      },
    },

    // ── TC-10: ID 唯一性 ──
    {
      id: 'TC-10',
      name: '数据完整性：所有零件的 Id 字段应唯一',
      fn: () => {
        const ids = parts.map((p) => p.Id);
        const uniqueIds = new Set(ids);
        if (uniqueIds.size !== ids.length) return `发现重复 Id！共 ${ids.length} 条记录，但仅 ${uniqueIds.size} 个唯一 Id`;
        return true;
      },
    },

    // ── TC-11: 演示数据类别覆盖检查 ──
    {
      id: 'TC-11',
      name: '演示数据：应至少涵盖 3 种以上分类',
      fn: () => {
        const cats = new Set(parts.map((p) => p.category));
        if (cats.size < 3) return `当前仅 ${cats.size} 个分类，演示数据应覆盖 ≥ 3 个分类`;
        return true;
      },
    },

    // ── TC-12: 库存总价值计算 ──
    {
      id: 'TC-12',
      name: '成本计算：库存总价值 = Σ(price × stock) 应 > 0',
      fn: () => {
        const totalValue = parts.reduce((sum, p) => sum + p.price * p.stock, 0);
        if (!isFinite(totalValue)) return `总价值计算结果为非有限数：${totalValue}`;
        if (parts.some((p) => p.price > 0 && p.stock > 0) && totalValue <= 0)
          return `存在有价格有库存的零件，但总价值为 ${totalValue}`;
        return true;
      },
    },

    // ── TC-13: DOM 元素存在性检查 ──
    {
      id: 'TC-13',
      name: 'DOM 检查：关键 UI 元素应存在于文档中',
      fn: () => {
        const ids = ['part-model-input', 'part-category-select', 'part-price-input', 'part-supplier-autocomplete', 'part-stock-input', 'part-save-btn', 'parts-search-input'];
        const missing = ids.filter((id) => !document.getElementById(id));
        if (missing.length > 0) return `以下元素 ID 未在 DOM 中找到: ${missing.join(', ')}`;
        return true;
      },
    },

    // ── TC-14: 表单 save 按钮可点击 ──
    {
      id: 'TC-14',
      name: 'DOM 检查：保存按钮应为可用状态（未 disabled）',
      fn: () => {
        const btn = document.getElementById('part-save-btn') as HTMLButtonElement | null;
        if (!btn) return 'part-save-btn 未在 DOM 中找到';
        if (btn.disabled) return '保存按钮当前处于 disabled 状态（可能正在保存中）';
        return true;
      },
    },

    // ── TC-15: 搜索框响应性 ──
    {
      id: 'TC-15',
      name: 'DOM 检查：搜索框应为 input 类型元素',
      fn: () => {
        const el = document.getElementById('parts-search-input');
        if (!el) return 'parts-search-input 未在 DOM 中找到';
        const input = el.tagName === 'INPUT' ? el : el.querySelector('input');
        if (!input) return '搜索框内未找到 input 元素';
        return true;
      },
    },
  ];

  // ── 运行所有测试 ──────────────────────────────────
  const runAllTests = async () => {
    setTestRunning(true);
    setTestResults([]);
    const results: TestResult[] = [];
    for (const tc of testCases) {
      const t0 = performance.now();
      let passed = false;
      let message = '';
      try {
        const result = tc.fn();
        if (result === true) { passed = true; message = '通过'; }
        else { passed = false; message = String(result); }
      } catch (e) {
        passed = false;
        message = `抛出异常: ${e instanceof Error ? e.message : String(e)}`;
      }
      const duration = +(performance.now() - t0).toFixed(2);
      results.push({ id: tc.id, name: tc.name, passed, message, duration });
      // 每个 case 结束后 yield，让 React 有机会重渲染
      await new Promise((r) => setTimeout(r, 30));
      setTestResults([...results]);
    }
    setTestRunning(false);
  };

  const passed = testResults.filter((r) => r.passed).length;
  const failed = testResults.filter((r) => !r.passed).length;
  const total = testCases.length;

  return (
    <Paper elevation={0} sx={{ mt: 3, border: `2px solid ${colors.purple.border}`, borderRadius: 3, overflow: 'hidden' }}>
      {/* 顶部工具栏 */}
      <Box sx={{ px: 3, py: 2, background: gradients.brand, display: 'flex', alignItems: 'center', gap: 2 }}>
        <BugReportIcon sx={{ color: 'white', fontSize: 22 }} />
        <Box flex={1}>
          <Typography variant="subtitle1" fontWeight={800} color="white">Harness 自动化测试面板</Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)' }}>
            共 {total} 个测试用例 · 覆盖数据结构 / 前端逻辑 / DOM 可访问性
          </Typography>
        </Box>
        {testResults.length > 0 && (
          <Box display="flex" gap={1}>
            <Chip label={`✅ ${passed} 通过`} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white', fontWeight: 700 }} />
            {failed > 0 && <Chip label={`❌ ${failed} 失败`} size="small" sx={{ bgcolor: 'rgba(239,68,68,0.25)', color: 'white', fontWeight: 700 }} />}
          </Box>
        )}
        <Button
          id="run-all-tests-btn"
          variant="contained"
          startIcon={<PlayIcon />}
          onClick={runAllTests}
          disabled={testRunning}
          sx={{ bgcolor: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)', '&:hover': { bgcolor: 'rgba(255,255,255,0.25)' }, fontWeight: 700, boxShadow: 'none' }}
        >
          {testRunning ? '测试运行中...' : '运行全部测试'}
        </Button>
      </Box>

      {testRunning && <LinearProgress sx={{ '& .MuiLinearProgress-bar': { background: gradients.brand } }} />}

      {/* 测试结果列表 */}
      <Box sx={{ maxHeight: 420, overflowY: 'auto', '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(0,0,0,0.1)', borderRadius: 2 } }}>
        {testResults.length === 0 ? (
          <Box textAlign="center" py={5} color="text.secondary">
            <BugReportIcon sx={{ fontSize: 40, opacity: 0.15, display: 'block', mx: 'auto', mb: 1 }} />
            <Typography variant="body2">点击「运行全部测试」以开始校验</Typography>
          </Box>
        ) : (
          testResults.map((r, idx) => (
            <Fade key={r.id} in timeout={200 + idx * 30}>
              <Box>
                <Box
                  id={`test-result-${r.id}`}
                  sx={{
                    display: 'flex', alignItems: 'flex-start', gap: 2,
                    px: 3, py: 1.5,
                    bgcolor: r.passed ? 'rgba(16,185,129,0.03)' : 'rgba(239,68,68,0.04)',
                    borderLeft: `4px solid ${r.passed ? colors.green.main : colors.red.main}`,
                  }}
                >
                  <Box sx={{ mt: 0.15 }}>
                    {r.passed
                      ? <CheckCircleIcon sx={{ fontSize: 18, color: colors.green.main }} />
                      : <ErrorOutlineIcon sx={{ fontSize: 18, color: colors.red.main }} />}
                  </Box>
                  <Box flex={1}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Chip label={r.id} size="small" sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, bgcolor: r.passed ? colors.green.bg : colors.red.bg, color: r.passed ? colors.green.text : colors.red.text }} />
                      <Typography variant="body2" fontWeight={600}>{r.name}</Typography>
                    </Box>
                    {!r.passed && (
                      <Typography variant="caption" color={colors.red.text} sx={{ display: 'block', fontFamily: 'monospace', bgcolor: colors.red.bg, px: 1, py: 0.3, borderRadius: 1, mt: 0.5 }}>
                        ✗ {r.message}
                      </Typography>
                    )}
                  </Box>
                  <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: 'nowrap', mt: 0.2 }}>{r.duration}ms</Typography>
                </Box>
                {idx < testResults.length - 1 && <Divider sx={{ opacity: 0.4 }} />}
              </Box>
            </Fade>
          ))
        )}
      </Box>

      {/* 底部摘要 */}
      {testResults.length > 0 && (
        <Box sx={{ px: 3, py: 1.5, borderTop: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2, bgcolor: failed === 0 ? colors.green.bg : colors.red.bg }}>
          {failed === 0
            ? <><CheckCircleIcon sx={{ color: colors.green.main, fontSize: 18 }} /><Typography variant="caption" fontWeight={700} color={colors.green.text}>🎉 所有 {passed} 个测试用例全部通过！</Typography></>
            : <><ErrorOutlineIcon sx={{ color: colors.red.main, fontSize: 18 }} /><Typography variant="caption" fontWeight={700} color={colors.red.text}>⚠ {failed} 个测试失败，请查看上方详情</Typography></>
          }
          <Box flex={1} />
          <Typography variant="caption" color="text.disabled">
            总耗时: {testResults.reduce((s, r) => s + r.duration, 0).toFixed(0)}ms
          </Typography>
        </Box>
      )}
    </Paper>
  );
}
