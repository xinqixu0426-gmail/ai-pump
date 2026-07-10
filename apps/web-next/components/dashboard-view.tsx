'use client';

import { useEffect, useState } from 'react';
import {
  CircleAlert,
  ClipboardList,
  PackageMinus,
  RefreshCw,
  ShoppingCart,
  Store,
  TrendingUp,
} from 'lucide-react';
import { getWorkbenchSummary, severityClassName, type BusinessSummary } from '@/lib/dashboard';
import { dateShort, money } from '@/lib/format';
import { FadePanel } from '@/components/motion/fade-panel';
import { Button } from '@/components/ui/button';

function statLabel(value: string, sub: string) {
  return (
    <div>
      <div className="text-2xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </div>
  );
}

function statusClassName(status: string) {
  if (status === '已完成') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === '采购中') return 'border-sky-200 bg-sky-50 text-sky-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

export function DashboardView() {
  const [summary, setSummary] = useState<BusinessSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);

    try {
      setSummary(await getWorkbenchSummary());
    } catch (err) {
      setError(err instanceof Error ? err.message : '看板加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-5">
      <FadePanel className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Dashboard</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">看板</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            使用后端 `/api/workbench/summary` 权威汇总，前端只做展示和筛选入口。
          </p>
        </div>
        <Button
          onClick={() => void load(true)}
          disabled={refreshing}
          icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />}
        >
          刷新
        </Button>
      </FadePanel>

      {error && (
        <div className="flex items-center gap-2 rounded-panel border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <CircleAlert size={16} />
          {error}
        </div>
      )}

      {loading || !summary ? (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-panel bg-slate-100" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <FadePanel delay={0.02} className="rounded-panel border border-line bg-white p-4 shadow-panel">
              {statLabel(money(summary.financials.totalRevenue), '总销售额')}
            </FadePanel>
            <FadePanel delay={0.04} className="rounded-panel border border-line bg-white p-4 shadow-panel">
              {statLabel(money(summary.financials.totalProfit), `利润率 ${summary.financials.profitRate}%`)}
            </FadePanel>
            <FadePanel delay={0.06} className="rounded-panel border border-line bg-white p-4 shadow-panel">
              {statLabel(String(summary.orders.active), '未完成订单')}
            </FadePanel>
            <FadePanel delay={0.08} className="rounded-panel border border-line bg-white p-4 shadow-panel">
              {statLabel(String(summary.kpis.lowStockPartCount + summary.kpis.outOfStockPartCount), '库存预警')}
            </FadePanel>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
            <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
              <div className="flex items-center justify-between gap-3 border-b border-line p-4">
                <div>
                  <div className="text-sm font-semibold text-ink">今日工作台</div>
                  <div className="mt-1 text-xs text-muted">需要优先处理的业务状态</div>
                </div>
                <ClipboardList size={18} className="text-muted" />
              </div>
              <div className="grid gap-3 p-4 md:grid-cols-2">
                {summary.workbench.items.map((item) => (
                  <div key={item.key} className={`rounded-panel border p-4 ${severityClassName(item.severity)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{item.label}</div>
                        <div className="mt-1 text-xs opacity-80">{item.desc}</div>
                      </div>
                      <div className="text-2xl font-semibold">{item.count}</div>
                    </div>
                  </div>
                ))}
              </div>
            </FadePanel>

            <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
              <div className="flex items-center justify-between gap-3 border-b border-line p-4">
                <div>
                  <div className="text-sm font-semibold text-ink">供应商关注</div>
                  <div className="mt-1 text-xs text-muted">按未采购数量排序</div>
                </div>
                <Store size={18} className="text-muted" />
              </div>
              <div className="divide-y divide-line">
                {summary.workbench.supplierFocus.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted">暂无供应商待采购事项</div>
                ) : (
                  summary.workbench.supplierFocus.slice(0, 6).map((supplier) => (
                    <div key={supplier.supplier} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">{supplier.supplier}</div>
                        <div className="mt-1 text-xs text-muted">{supplier.orderCount} 个订单</div>
                      </div>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                        {supplier.pendingQty}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </FadePanel>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
              <div className="flex items-center justify-between gap-3 border-b border-line p-4">
                <div>
                  <div className="text-sm font-semibold text-ink">待采购物料</div>
                  <div className="mt-1 text-xs text-muted">前 10 项</div>
                </div>
                <ShoppingCart size={18} className="text-muted" />
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-muted">
                    <tr>
                      <th className="border-b border-line px-4 py-3">型号</th>
                      <th className="border-b border-line px-4 py-3">供应商</th>
                      <th className="border-b border-line px-4 py-3 text-right">需采</th>
                      <th className="border-b border-line px-4 py-3 text-right">订单</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.workbench.pendingPurchaseItems.slice(0, 10).map((item) => (
                      <tr key={item.key} className="transition-colors duration-150 hover:bg-slate-50">
                        <td className="border-b border-line px-4 py-3 font-medium text-ink">{item.model}</td>
                        <td className="border-b border-line px-4 py-3 text-muted">{item.supplier}</td>
                        <td className="border-b border-line px-4 py-3 text-right text-rose-600">{item.needToBuy}</td>
                        <td className="border-b border-line px-4 py-3 text-right text-muted">{item.orderCount}</td>
                      </tr>
                    ))}
                    {summary.workbench.pendingPurchaseItems.length === 0 && (
                      <tr><td colSpan={4} className="p-8 text-center text-sm text-muted">暂无待采购物料</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </FadePanel>

            <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
              <div className="flex items-center justify-between gap-3 border-b border-line p-4">
                <div>
                  <div className="text-sm font-semibold text-ink">最新订单</div>
                  <div className="mt-1 text-xs text-muted">最近录入的订单</div>
                </div>
                <TrendingUp size={18} className="text-muted" />
              </div>
              <div className="divide-y divide-line">
                {(summary.orders.latest || summary.workbench.todayOrders).slice(0, 8).map((order) => (
                  <div key={order.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{order.customerName || '未命名客户'}</div>
                      <div className="mt-1 text-xs text-muted">
                        {order.contractNo || '-'} · {order.itemCount} 个型号 · {dateShort(order.createdAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClassName(order.status)}`}>
                        {order.status}
                      </span>
                      <span className="text-sm font-medium text-ink">{money(order.totalPrice)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </FadePanel>
          </div>

          <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
            <div className="flex items-center justify-between gap-3 border-b border-line p-4">
              <div>
                <div className="text-sm font-semibold text-ink">缺货零件</div>
                <div className="mt-1 text-xs text-muted">库存为 0 的前 12 项</div>
              </div>
              <PackageMinus size={18} className="text-muted" />
            </div>
            <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
              {summary.workbench.outOfStockParts.slice(0, 12).map((part) => (
                <div key={part.id} className="rounded-md border border-line p-3">
                  <div className="truncate text-sm font-medium text-ink">{part.model}</div>
                  <div className="mt-1 text-xs text-muted">{part.category || '未分类'} · {part.supplier || '无供应商'}</div>
                </div>
              ))}
              {summary.workbench.outOfStockParts.length === 0 && (
                <div className="col-span-full p-6 text-center text-sm text-muted">暂无缺货零件</div>
              )}
            </div>
          </FadePanel>
        </>
      )}
    </div>
  );
}
