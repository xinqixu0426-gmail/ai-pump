'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, FileText, Pencil, Plus, RefreshCw, Save, Trash2, UserRound, X } from 'lucide-react';
import {
  calculateCustomerQuotationStats,
  createCustomer,
  deleteCustomer,
  getAllCustomers,
  getAllQuotations,
  quotationCountByCustomer,
  quotationsForCustomer,
  updateCustomer,
  type Customer,
  type CustomerInput,
  type Quotation,
} from '@/lib/customers';
import { dateShort, money } from '@/lib/format';
import { FadePanel } from '@/components/motion/fade-panel';
import { SlideOver } from '@/components/motion/slide-over';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FormError } from '@/components/ui/form-error';
import { ListToolbar } from '@/components/ui/list-toolbar';
import { MetricCard, MetricGrid } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import { TableScrollArea } from '@/components/ui/table-scroll-area';
import { FactoryFileAttachments } from '@/components/factory-file-attachments';
import { useConfirmDiscard } from '@/hooks/use-confirm-discard';

function marginLabel(value: number) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function quotationStatusTone(status: string): StatusBadgeTone {
  if (status === '已接受') return 'green';
  if (status === '已转订单') return 'purple';
  if (status === '已拒绝') return 'red';
  if (status === '已过时') return 'slate';
  return 'blue';
}

type CustomerFormState = {
  name: string;
  contactInfo: string;
  defaultMarginPercent: string;
  remark: string;
};

const emptyForm: CustomerFormState = {
  name: '',
  contactInfo: '',
  defaultMarginPercent: '10',
  remark: '',
};

function formFromCustomer(customer: Customer): CustomerFormState {
  return {
    name: customer.name,
    contactInfo: customer.contactInfo,
    defaultMarginPercent: String(Math.round((Number(customer.defaultMargin) || 0) * 100)),
    remark: customer.remark || '',
  };
}

function formToInput(form: CustomerFormState): CustomerInput {
  return {
    name: form.name.trim(),
    contactInfo: form.contactInfo.trim(),
    defaultMargin: Math.max(0, Number(form.defaultMarginPercent) || 0) / 100,
    remark: form.remark.trim(),
  };
}

export function CustomersView() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerFormState>(emptyForm);
  const {
    dirty: formDirty,
    markDirty: markFormDirty,
    resetDirty: resetFormDirty,
    requestClose: requestDrawerClose,
  } = useConfirmDiscard({
    open: drawerOpen,
    busy: saving,
    onDiscard: () => setDrawerOpen(false),
  });

  async function load(force = false) {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);

    try {
      const [nextCustomers, nextQuotations] = await Promise.all([
        getAllCustomers(),
        getAllQuotations(),
      ]);
      setCustomers(nextCustomers);
      setQuotations(nextQuotations);
      setSelectedCustomerId((current) => (
        current && nextCustomers.some((customer) => customer.id === current)
          ? current
          : nextCustomers[0]?.id ?? null
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : '客户加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const quotationCounts = useMemo(() => quotationCountByCustomer(quotations), [quotations]);
  const filteredCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return customers.filter((customer) => {
      const text = `${customer.name} ${customer.contactInfo} ${customer.remark || ''}`.toLowerCase();
      return !normalizedQuery || text.includes(normalizedQuery);
    });
  }, [customers, query]);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) || null;
  const customerQuotations = useMemo(
    () => quotationsForCustomer(quotations, selectedCustomerId),
    [quotations, selectedCustomerId]
  );
  const selectedStats = useMemo(() => calculateCustomerQuotationStats(customerQuotations), [customerQuotations]);

  const totalQuotationPrice = useMemo(
    () => quotations.reduce((sum, quotation) => sum + quotation.totalPrice, 0),
    [quotations]
  );

  function openCreateDrawer() {
    resetFormDirty();
    setEditingCustomer(null);
    setForm(emptyForm);
    setFormError(null);
    setDrawerOpen(true);
  }

  function openEditDrawer(customer: Customer) {
    resetFormDirty();
    setEditingCustomer(customer);
    setForm(formFromCustomer(customer));
    setFormError(null);
    setDrawerOpen(true);
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = formToInput(form);
    if (!input.name) {
      setFormError('客户名称不能为空');
      return;
    }

    setSaving(true);
    setFormError(null);
    setError(null);

    try {
      const saved = editingCustomer
        ? await updateCustomer(editingCustomer, input)
        : await createCustomer(input);
      await load(true);
      setSelectedCustomerId(saved.id);
      resetFormDirty();
      setDrawerOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '客户保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeCustomer(customer: Customer) {
    const quoteCount = quotationCounts.get(customer.id) || 0;
    const message = quoteCount > 0
      ? `该客户已有 ${quoteCount} 张报价，删除后报价历史仍会保留客户 ID。确定删除？`
      : '确定删除该客户？';
    if (!window.confirm(message)) return;

    setSaving(true);
    setError(null);

    try {
      await deleteCustomer(customer);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '客户删除失败');
    } finally {
      setSaving(false);
    }
  }

  function createQuotationForCustomer(customer: Customer) {
    router.push(`/quotations?create=1&customerId=${customer.id}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="客户"
        description="维护客户档案并查看关联报价与业务资料。"
        actions={(
          <>
          <Button
            onClick={() => void load(true)}
            disabled={refreshing || saving}
            icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}
          >
            刷新
          </Button>
          <Button variant="primary" onClick={openCreateDrawer} disabled={saving} icon={<Plus size={15} />}>
            新建客户
          </Button>
          </>
        )}
      />

      <MetricGrid>
        <MetricCard value={String(customers.length)} label="客户数量" delay={0.02} />
        <MetricCard value={String(quotations.length)} label="报价总数" delay={0.04} />
        <MetricCard value={money(totalQuotationPrice)} label="总报价额" delay={0.06} />
        <MetricCard value={selectedCustomer ? selectedCustomer.name : '-'} label="当前客户" delay={0.08} />
      </MetricGrid>

      {error && (
        <div className="flex items-center gap-2 rounded-panel border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <CircleAlert size={16} />
          {error}
        </div>
      )}

      <div className="grid min-w-0 gap-4 min-[1440px]:grid-cols-[360px_minmax(0,1fr)]">
        <FadePanel className="min-w-0 rounded-panel border border-line bg-white shadow-panel">
          <div className="border-b border-line p-4">
            <div>
              <div className="text-sm font-semibold text-ink">客户列表</div>
              <div className="mt-1 text-xs text-muted">选择客户后查看报价历史与附件</div>
            </div>
          </div>

          <ListToolbar
            query={query}
            onQueryChange={setQuery}
            searchLabel="搜索客户"
            placeholder="搜索客户、联系方式或备注"
            resultText={`显示 ${filteredCustomers.length} / ${customers.length} 个客户`}
            hasActiveFilters={Boolean(query.trim())}
            onReset={() => setQuery('')}
          />

          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-md bg-slate-100" />
              ))}
            </div>
          ) : filteredCustomers.length === 0 ? (
            <EmptyState
              icon={UserRound}
              title={customers.length === 0 ? '还没有客户' : '没有匹配的客户'}
              description={customers.length === 0 ? '先建立客户档案，再从客户详情发起报价。' : '调整搜索词，或清空搜索查看全部客户。'}
              action={customers.length === 0 ? (
                <Button size="sm" variant="primary" onClick={openCreateDrawer} icon={<Plus size={14} />}>新建客户</Button>
              ) : null}
            />
          ) : (
            <div className="min-[1440px]:max-h-[620px] min-[1440px]:overflow-y-auto">
              {filteredCustomers.map((customer) => {
                const selected = customer.id === selectedCustomerId;
                const quoteCount = quotationCounts.get(customer.id) || 0;
                return (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => setSelectedCustomerId(customer.id)}
                    className={`flex min-h-20 w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors duration-150 ${
                      selected ? 'bg-slate-950 text-white' : 'text-ink hover:bg-slate-50'
                    }`}
                  >
                    <span className={`mt-0.5 rounded-md border p-2 ${selected ? 'border-white/20 bg-white/10' : 'border-line bg-slate-50 text-muted'}`}>
                      <UserRound size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{customer.name || '未命名客户'}</span>
                      <span className={`mt-1 block truncate text-xs ${selected ? 'text-white/70' : 'text-muted'}`}>
                        {customer.contactInfo || customer.remark || '无联系方式'}
                      </span>
                      <StatusBadge tone="custom" className={`mt-2 h-6 min-w-0 px-2 ${selected ? 'border-white/20 bg-white/10 text-white/80' : 'border-line bg-slate-50 text-muted'}`}>
                        {quoteCount} 张报价
                      </StatusBadge>
                    </span>
                    <span className={`text-xs ${selected ? 'text-white/70' : 'text-muted'}`}>
                      {marginLabel(customer.defaultMargin)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </FadePanel>

        <FadePanel className="min-w-0 rounded-panel border border-line bg-white shadow-panel">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
            <div>
              <div className="text-sm font-semibold text-ink">{selectedCustomer ? selectedCustomer.name : '选择客户'}</div>
              <div className="mt-1 text-xs text-muted">
                {selectedCustomer
                  ? `${selectedCustomer.contactInfo || '无联系方式'} · 默认加价 ${marginLabel(selectedCustomer.defaultMargin)}`
                  : '点击左侧客户查看报价历史'}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-line px-2 py-1 text-muted">{selectedStats.count} 张报价</span>
              <span className="rounded-full border border-line px-2 py-1 text-muted">{money(selectedStats.totalPrice)}</span>
              <span className="rounded-full border border-line px-2 py-1 text-muted">
                最近 {selectedStats.latest ? selectedStats.latest.toLocaleDateString('zh-CN') : '-'}
              </span>
            </div>
            {selectedCustomer ? (
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={() => createQuotationForCustomer(selectedCustomer)} disabled={saving} icon={<Plus size={14} />}>
                  新建报价
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openEditDrawer(selectedCustomer)} disabled={saving} icon={<Pencil size={14} />}>
                  编辑
                </Button>
                <Button size="sm" variant="danger" onClick={() => void removeCustomer(selectedCustomer)} disabled={saving} icon={<Trash2 size={14} />}>
                  删除
                </Button>
              </div>
            ) : null}
          </div>

          {!selectedCustomer ? (
            <div className="p-10 text-center text-sm text-muted">请先选择一个客户</div>
          ) : customerQuotations.length === 0 ? (
            <div className="p-10 text-center">
              <FileText className="mx-auto text-slate-300" size={32} />
              <div className="mt-3 text-sm font-medium text-ink">该客户还没有报价单</div>
              <div className="mt-1 text-sm text-muted">可以直接为该客户创建第一张报价。</div>
              <div className="mt-4">
                <Button size="sm" variant="primary" onClick={() => createQuotationForCustomer(selectedCustomer)} disabled={saving} icon={<Plus size={14} />}>
                  新建报价
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="divide-y divide-line md:hidden">
                {customerQuotations.map((quotation) => (
                  <article key={quotation.id} className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <StatusBadge tone={quotationStatusTone(quotation.status)}>{quotation.status}</StatusBadge>
                      <span className="text-xs text-muted">{dateShort(quotation.createdAt)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3">
                      <div>
                        <div className="text-xs text-muted">总报价</div>
                        <div className="mt-1 text-base font-semibold text-ink">{money(quotation.totalPrice)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted">总成本</div>
                        <div className="mt-1 text-sm font-medium text-muted">{money(quotation.totalCost)}</div>
                      </div>
                    </div>
                    {quotation.remark ? <div className="line-clamp-2 text-xs leading-5 text-muted">备注：{quotation.remark}</div> : null}
                  </article>
                ))}
              </div>
              <div className="hidden md:block">
            <TableScrollArea label="客户报价历史">
              <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-muted">
                  <tr>
                    <th className="border-b border-line px-4 py-3">状态</th>
                    <th className="border-b border-line px-4 py-3 text-right">总成本</th>
                    <th className="border-b border-line px-4 py-3 text-right">总报价</th>
                    <th className="border-b border-line px-4 py-3">备注</th>
                    <th className="border-b border-line px-4 py-3">创建</th>
                  </tr>
                </thead>
                <tbody>
                  {customerQuotations.map((quotation) => (
                    <tr key={quotation.id} className="transition-colors duration-150 hover:bg-slate-50">
                      <td className="border-b border-line px-4 py-3 whitespace-nowrap">
                        <StatusBadge tone={quotationStatusTone(quotation.status)}>{quotation.status}</StatusBadge>
                      </td>
                      <td className="border-b border-line px-4 py-3 text-right text-muted">{money(quotation.totalCost)}</td>
                      <td className="border-b border-line px-4 py-3 text-right font-medium text-ink">{money(quotation.totalPrice)}</td>
                      <td className="border-b border-line px-4 py-3 text-muted">{quotation.remark || '-'}</td>
                      <td className="border-b border-line px-4 py-3 text-muted">{dateShort(quotation.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollArea>
              </div>
            </>
          )}
          {selectedCustomer ? (
            <div className="border-t border-line">
              <FactoryFileAttachments
                targetType="customer"
                targetId={selectedCustomer.id}
                title="客户附件"
                description="保存客户提供的资料、图片和往来文件。上传后会与当前客户建立可追溯关联。"
                embedded
              />
            </div>
          ) : null}
        </FadePanel>
      </div>

      <SlideOver open={drawerOpen} onClose={requestDrawerClose} ariaLabelledBy="customer-form-title">
        <form onSubmit={submitCustomer} onChange={markFormDirty} className="flex min-h-full flex-col">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-white p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Customer</div>
              <h2 id="customer-form-title" className="mt-2 text-xl font-semibold tracking-tight text-ink">
                {editingCustomer ? '编辑客户' : '新建客户'}
              </h2>
            </div>
            <button
              type="button"
              aria-label="关闭"
              disabled={saving}
              onClick={requestDrawerClose}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-4 p-5">
            <FormError message={formError} />

            <label className="block">
              <span className="text-sm font-medium text-ink">客户名称</span>
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                placeholder="例如：上海某某泵业"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-ink">联系方式</span>
              <input
                value={form.contactInfo}
                onChange={(event) => setForm((current) => ({ ...current, contactInfo: event.target.value }))}
                className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                placeholder="电话、微信或联系人"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-ink">默认加价率</span>
              <div className="mt-2 flex h-10 items-center rounded-md border border-line px-3 focus-within:border-slate-400">
                <input
                  value={form.defaultMarginPercent}
                  onChange={(event) => setForm((current) => ({ ...current, defaultMarginPercent: event.target.value }))}
                  type="number"
                  min="0"
                  step="1"
                  className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none"
                />
                <span className="text-sm text-muted">%</span>
              </div>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-ink">备注</span>
              <textarea
                value={form.remark}
                onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))}
                rows={5}
                className="mt-2 w-full resize-none rounded-md border border-line px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-slate-400"
                placeholder="客户偏好、付款习惯或交付注意事项"
              />
            </label>
          </div>

          <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-line bg-white p-4 sm:p-5">
            <div className="text-xs text-muted" aria-live="polite">{formDirty ? '有未保存修改' : '尚未修改'}</div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={requestDrawerClose} disabled={saving}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={saving} icon={<Save size={15} />}>
                {saving ? '保存中' : '保存'}
              </Button>
            </div>
          </div>
        </form>
      </SlideOver>
    </div>
  );
}
