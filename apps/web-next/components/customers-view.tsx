'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, FileText, Pencil, Plus, RefreshCw, Save, Search, Trash2, UserRound, X } from 'lucide-react';
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
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';

function statLabel(value: string, sub: string) {
  return (
    <div>
      <div className="text-2xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </div>
  );
}

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
    setEditingCustomer(null);
    setForm(emptyForm);
    setFormError(null);
    setDrawerOpen(true);
  }

  function openEditDrawer(customer: Customer) {
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
        ? await updateCustomer(editingCustomer.id, input)
        : await createCustomer(input);
      await load(true);
      setSelectedCustomerId(saved.id);
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
      await deleteCustomer(customer.id);
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
    <div className="space-y-5">
      <FadePanel className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Customers</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">客户</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            客户档案、报价摘要和基础写操作都走标准 API，保存后重新拉取客户与报价数据。
          </p>
        </div>
        <div className="flex gap-2">
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
        </div>
      </FadePanel>

      <div className="grid gap-3 md:grid-cols-4">
        <FadePanel delay={0.02} className="rounded-panel border border-line bg-white p-4 shadow-panel">
          {statLabel(String(customers.length), '客户数量')}
        </FadePanel>
        <FadePanel delay={0.04} className="rounded-panel border border-line bg-white p-4 shadow-panel">
          {statLabel(String(quotations.length), '报价总数')}
        </FadePanel>
        <FadePanel delay={0.06} className="rounded-panel border border-line bg-white p-4 shadow-panel">
          {statLabel(money(totalQuotationPrice), '总报价额')}
        </FadePanel>
        <FadePanel delay={0.08} className="rounded-panel border border-line bg-white p-4 shadow-panel">
          {statLabel(selectedCustomer ? selectedCustomer.name : '-', '当前客户')}
        </FadePanel>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-panel border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <CircleAlert size={16} />
          {error}
        </div>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
        <FadePanel className="min-w-0 rounded-panel border border-line bg-white shadow-panel">
          <div className="flex items-center justify-between gap-3 border-b border-line p-4">
            <div>
              <div className="text-sm font-semibold text-ink">客户列表</div>
              <div className="mt-1 text-xs text-muted">{filteredCustomers.length} / {customers.length}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={openCreateDrawer} disabled={saving} icon={<Plus size={14} />}>
              新建
            </Button>
          </div>

          <div className="border-b border-line p-4">
            <div className="flex items-center gap-2 rounded-md border border-line bg-white px-3">
              <Search size={16} className="text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索客户、联系方式或备注"
                className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-md bg-slate-100" />
              ))}
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">没有匹配的客户</div>
          ) : (
            <div className="max-h-[620px] overflow-y-auto">
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
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
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
            </div>
          )}
        </FadePanel>
      </div>

      <SlideOver open={drawerOpen} onClose={() => !saving && setDrawerOpen(false)}>
        <form onSubmit={submitCustomer} className="flex min-h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Customer</div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">
                {editingCustomer ? '编辑客户' : '新建客户'}
              </h2>
            </div>
            <button
              type="button"
              aria-label="关闭"
              disabled={saving}
              onClick={() => setDrawerOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted transition-colors duration-150 hover:bg-slate-50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-4 p-5">
            {formError ? (
              <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <CircleAlert size={16} />
                {formError}
              </div>
            ) : null}

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

          <div className="flex justify-end gap-2 border-t border-line p-5">
            <Button type="button" variant="ghost" onClick={() => setDrawerOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={saving} icon={<Save size={15} />}>
              {saving ? '保存中' : '保存'}
            </Button>
          </div>
        </form>
      </SlideOver>
    </div>
  );
}
