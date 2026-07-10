import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Avatar,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ClipboardList,
  FileText,
  Package,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Customer, Order, Part, Quotation, Recipe } from '../types';
import { useAppStore } from '../utils/store';
import { entityCreatedAt, entityId } from '../utils/entityFields';

type SearchResult = {
  key: string;
  group: string;
  title: string;
  subtitle: string;
  meta?: string;
  icon: LucideIcon;
  color: string;
  onSelect: () => void;
};

const GROUP_ORDER = ['快捷动作', '订单', '配方', '零件', '客户', '报价单'];

function parseItems(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function money(value?: number): string {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function dateShort(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const {
    parts,
    recipes,
    orders,
    customers,
    quotations,
    fetchParts,
    fetchRecipes,
    fetchOrders,
    fetchCustomers,
    fetchQuotations,
  } = useAppStore();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      fetchParts(),
      fetchRecipes(),
      fetchOrders(),
      fetchCustomers(),
      fetchQuotations(),
    ]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, fetchParts, fetchRecipes, fetchOrders, fetchCustomers, fetchQuotations]);

  const closeAndGo = (path: string, state?: Record<string, unknown>) => {
    setOpen(false);
    setQuery('');
    navigate(path, state ? { state } : undefined);
  };

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    const customersTyped = customers as Customer[];
    const quotationsTyped = quotations as Quotation[];
    const customerNameMap = new Map(customersTyped.map(c => [entityId(c), c.name]));
    const hasQuery = q.length > 0;
    const match = (...values: unknown[]) =>
      hasQuery && values.some(value => String(value ?? '').toLowerCase().includes(q));

    const commandResults: SearchResult[] = [
      {
        key: 'cmd-new-order',
        group: '快捷动作',
        title: '新建订单',
        subtitle: '从客户、配方和数量生成生产订单',
        icon: Plus,
        color: '#2563eb',
        onSelect: () => closeAndGo('/order-form'),
      },
      {
        key: 'cmd-purchase',
        group: '快捷动作',
        title: '打开采购中心',
        subtitle: '按供应商汇总待采购物料',
        icon: ClipboardList,
        color: '#0f766e',
        onSelect: () => closeAndGo('/purchase'),
      },
      {
        key: 'cmd-new-recipe',
        group: '快捷动作',
        title: '录入配方',
        subtitle: '新建水泵 BOM 配方',
        icon: Receipt,
        color: '#7c3aed',
        onSelect: () => closeAndGo('/recipe-form'),
      },
      {
        key: 'cmd-new-part',
        group: '快捷动作',
        title: '录入零件',
        subtitle: '打开零件录入面板',
        icon: Wrench,
        color: '#ea580c',
        onSelect: () => closeAndGo('/parts', { action: 'new-part' }),
      },
    ];

    const orderResults = (orders as Order[])
      .filter(order =>
        match(
          order.customerName,
          order.contractNo,
          order.remark,
          order.status,
          order.items.map(item => `${item.recipeName} ${item.spec || ''}`).join(' ')
        )
      )
      .slice(0, 8)
      .map<SearchResult>(order => ({
        key: `order-${order.id}`,
        group: '订单',
        title: order.customerName,
        subtitle: `${order.contractNo || '无合同号'} · ${order.items.length} 个型号 · ${order.status}`,
        meta: `${dateShort(order.createdAt)} · ${money(order.totalPrice)}`,
        icon: ShoppingCart,
        color: '#2563eb',
        onSelect: () => closeAndGo('/orders', { openOrderId: order.id }),
      }));

    const recipeResults = (recipes as Recipe[])
      .filter(recipe => match(recipe.name, recipe.spec, recipe.partsJson))
      .slice(0, 8)
      .map<SearchResult>(recipe => ({
        key: `recipe-${entityId(recipe)}`,
        group: '配方',
        title: recipe.name,
        subtitle: recipe.spec || '未填写规格',
        meta: recipe.savedTotalCost ? money(recipe.savedTotalCost) : '查看成本',
        icon: Receipt,
        color: '#7c3aed',
        onSelect: () => closeAndGo('/recipes', { openRecipeId: entityId(recipe) }),
      }));

    const partResults = (parts as Part[])
      .filter(part => match(part.model, part.category, part.supplier, part.remark, part.notes))
      .slice(0, 8)
      .map<SearchResult>(part => ({
        key: `part-${entityId(part)}`,
        group: '零件',
        title: part.model,
        subtitle: `${part.category || '未分类'} · ${part.supplier || '无供应商'}`,
        meta: `库存 ${part.stock || 0} · ${money(part.price)}`,
        icon: Package,
        color: '#ea580c',
        onSelect: () => closeAndGo('/parts', { searchQuery: part.model }),
      }));

    const customerResults = customersTyped
      .filter(customer => match(customer.name, customer.contactInfo, customer.remark))
      .slice(0, 8)
      .map<SearchResult>(customer => ({
        key: `customer-${entityId(customer)}`,
        group: '客户',
        title: customer.name,
        subtitle: customer.contactInfo || customer.remark || '客户档案',
        meta: `默认加价 ${(Number(customer.defaultMargin || 0) * 100).toFixed(0)}%`,
        icon: Users,
        color: '#0891b2',
        onSelect: () => closeAndGo('/customers', { customerId: entityId(customer) }),
      }));

    const quotationResults = quotationsTyped
      .filter(quotation => {
        const quoteItems = parseItems(quotation.itemsJson)
          .map(item => item.baseRecipeName || item.recipeName || '')
          .join(' ');
        return match(
          customerNameMap.get(quotation.customerId),
          quotation.status,
          quotation.remark,
          quoteItems
        );
      })
      .slice(0, 8)
      .map<SearchResult>(quotation => ({
        key: `quotation-${entityId(quotation)}`,
        group: '报价单',
        title: customerNameMap.get(quotation.customerId) || `报价单 #${entityId(quotation)}`,
        subtitle: `${quotation.status || '报价中'} · ${quotation.remark || '无备注'}`,
        meta: `${dateShort(entityCreatedAt(quotation))} · ${money(quotation.totalPrice)}`,
        icon: FileText,
        color: '#16a34a',
        onSelect: () => closeAndGo('/quotations', { openQuotationId: entityId(quotation) }),
      }));

    if (!hasQuery) return commandResults;
    return [
      ...commandResults.filter(item => match(item.title, item.subtitle)),
      ...orderResults,
      ...recipeResults,
      ...partResults,
      ...customerResults,
      ...quotationResults,
    ];
  }, [query, parts, recipes, orders, customers, quotations]);

  const groupedResults = useMemo(() => {
    return GROUP_ORDER.map(group => ({
      group,
      items: results.filter(item => item.group === group),
    })).filter(section => section.items.length > 0);
  }, [results]);

  return (
    <>
      <Tooltip title="全局搜索 Ctrl+K">
        <IconButton
          aria-label="全局搜索"
          onClick={() => setOpen(true)}
          sx={{
            width: 38,
            height: 38,
            border: '1px solid var(--border)',
            bgcolor: 'rgba(255,255,255,0.86)',
            '&:hover': { bgcolor: '#fff' },
          }}
        >
          <Search size={18} />
        </IconButton>
      </Tooltip>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { borderRadius: 3, overflow: 'hidden' } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, pb: 1 }}>
          <Box>
            <Typography variant="h6" fontWeight={800}>全局搜索</Typography>
            <Typography variant="caption" color="text.secondary">订单、零件、配方、客户和报价单</Typography>
          </Box>
          <IconButton size="small" aria-label="关闭全局搜索" onClick={() => setOpen(false)}>
            <X size={18} />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ pt: 1, pb: 2 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="输入客户、合同号、型号、配方或供应商"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={18} color="#64748b" />
                </InputAdornment>
              ),
              endAdornment: loading ? (
                <InputAdornment position="end">
                  <CircularProgress size={16} />
                </InputAdornment>
              ) : undefined,
            }}
          />

          <Box sx={{ mt: 2, maxHeight: 520, overflowY: 'auto' }}>
            {groupedResults.map((section, sectionIndex) => (
              <Box key={section.group} sx={{ mb: sectionIndex === groupedResults.length - 1 ? 0 : 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.5, mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={800}>
                    {section.group}
                  </Typography>
                  <Chip size="small" label={section.items.length} sx={{ height: 18, fontSize: 11 }} />
                </Box>
                <List disablePadding>
                  {section.items.map(item => {
                    const Icon = item.icon;
                    return (
                      <ListItemButton
                        key={item.key}
                        onClick={item.onSelect}
                        sx={{
                          borderRadius: 2,
                          py: 1,
                          px: 1,
                          gap: 1.25,
                          alignItems: 'center',
                        }}
                      >
                        <Avatar
                          variant="rounded"
                          sx={{
                            width: 34,
                            height: 34,
                            bgcolor: `${item.color}18`,
                            color: item.color,
                          }}
                        >
                          <Icon size={18} />
                        </Avatar>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" fontWeight={800} noWrap>{item.title}</Typography>
                          <Typography variant="caption" color="text.secondary" noWrap component="div">
                            {item.subtitle}
                          </Typography>
                        </Box>
                        {item.meta && (
                          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                            {item.meta}
                          </Typography>
                        )}
                      </ListItemButton>
                    );
                  })}
                </List>
                {sectionIndex !== groupedResults.length - 1 && <Divider sx={{ mt: 1 }} />}
              </Box>
            ))}

            {!loading && groupedResults.length === 0 && (
              <Box sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2">没有找到匹配结果</Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
}
