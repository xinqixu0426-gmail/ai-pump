'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  PackageMinus,
  RefreshCw,
  ShoppingCart,
  Store,
  TrendingUp,
} from 'lucide-react';
import {
  getManagementActionCenter,
  getWorkbenchSummary,
  severityClassName,
  type BusinessSummary,
  type ManagementActionCenter,
} from '@/lib/dashboard';
import { dateShort, money } from '@/lib/format';
import { FadePanel } from '@/components/motion/fade-panel';
import { Button } from '@/components/ui/button';
import { MetricCard, MetricGrid } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import { QualityView } from '@/components/quality-view';
import { getDataQualitySummary } from '@/lib/quality';
import { KnowledgeView } from '@/components/knowledge-view';
import { OrderReadinessOverviewView } from '@/components/order-readiness-overview';
import { getOrderReadinessOverview, type OrderReadinessOverview } from '@/lib/order-readiness';
import { ManagementActionCenterView } from '@/components/management-action-center';

type DashboardMode = 'overview' | 'actions' | 'readiness' | 'quality' | 'knowledge';

function statusTone(status: string): StatusBadgeTone {
  if (status === '采购完成') return 'green';
  if (status === '已关闭') return 'slate';
  if (status === '已取消') return 'red';
  if (status === '采购中') return 'blue';
  return 'amber';
}

export function DashboardView({
  initialMode = 'overview',
  initialKnowledgeEntryId = null,
}: {
  initialMode?: DashboardMode;
  initialKnowledgeEntryId?: number | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<DashboardMode>(initialMode);
  const [summary, setSummary] = useState<BusinessSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [qualityRefreshKey, setQualityRefreshKey] = useState(0);
  const [qualityRefreshing, setQualityRefreshing] = useState(false);
  const [knowledgeRefreshKey, setKnowledgeRefreshKey] = useState(0);
  const [knowledgeRefreshing, setKnowledgeRefreshing] = useState(false);
  const [readinessOverview, setReadinessOverview] = useState<OrderReadinessOverview | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(initialMode === 'readiness');
  const [readinessRefreshing, setReadinessRefreshing] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [actionCenter, setActionCenter] = useState<ManagementActionCenter | null>(null);
  const [actionLoading, setActionLoading] = useState(true);
  const [actionRefreshing, setActionRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  async function load(force = false) {
    setError(null);
    if (force) setRefreshing(true);
    else setLoading(true);

    try {
      setSummary(await getWorkbenchSummary());
      setLastUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : '看板加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadReadiness(force = false) {
    setReadinessError(null);
    if (force) setReadinessRefreshing(true);
    else setReadinessLoading(true);
    try {
      setReadinessOverview(await getOrderReadinessOverview());
      setLastUpdatedAt(new Date());
    } catch (err) {
      setReadinessError(err instanceof Error ? err.message : '订单准备总览加载失败');
    } finally {
      setReadinessLoading(false);
      setReadinessRefreshing(false);
    }
  }

  async function loadActionCenter(force = false) {
    setActionError(null);
    if (force) setActionRefreshing(true);
    else setActionLoading(true);
    try {
      setActionCenter(await getManagementActionCenter());
      setLastUpdatedAt(new Date());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '管理待办加载失败');
    } finally {
      setActionLoading(false);
      setActionRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
    void loadActionCenter();
    if (initialMode === 'readiness') void loadReadiness();
    void getDataQualitySummary()
      .then((quality) => setQualityScore(quality.score))
      .catch(() => undefined);
  }, [initialMode]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const readinessAttention = readinessOverview?.metrics.attentionRequired
    ?? actionCenter?.metrics.categoryCounts.order_readiness;
  const dashboardModeOptions: Array<{ value: DashboardMode; label: string; badge?: string | number }> = [
    { value: 'overview', label: '经营概览' },
    { value: 'actions', label: '今日待办', ...(actionCenter ? { badge: `${actionCenter.metrics.attentionRequired}项` } : {}) },
    { value: 'readiness', label: '订单准备', ...(readinessAttention === undefined ? {} : { badge: `${readinessAttention}单` }) },
    { value: 'quality', label: '数据质量', ...(qualityScore === null ? {} : { badge: `${qualityScore}分` }) },
    { value: 'knowledge', label: '知识库' },
  ];
  const actionableWorkbenchItems = summary?.workbench.items.filter((item) => item.count > 0) || [];

  function changeMode(nextMode: DashboardMode) {
    setMode(nextMode);
    router.push(nextMode === 'overview' ? '/dashboard' : `/dashboard?view=${nextMode}`, { scroll: false });
    if (nextMode === 'readiness' && !readinessOverview && !readinessLoading) {
      void loadReadiness();
    }
  }

  function refreshCurrentView() {
    if (mode === 'overview') void load(true);
    else if (mode === 'actions') void loadActionCenter(true);
    else if (mode === 'readiness') void loadReadiness(true);
    else if (mode === 'quality') {
      setQualityRefreshing(true);
      setQualityRefreshKey((current) => current + 1);
    } else {
      setKnowledgeRefreshing(true);
      setKnowledgeRefreshKey((current) => current + 1);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="管理看板"
        description="集中查看经营进度、供应链状态和基础数据质量。"
        actions={(
          <>
          <div className="max-w-full overflow-x-auto pb-1">
            <SegmentedControl
              value={mode}
              options={dashboardModeOptions}
              onChange={changeMode}
              ariaLabel="看板内容"
              className="w-max"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={refreshCurrentView}
              disabled={mode === 'overview' ? refreshing : mode === 'actions' ? actionRefreshing : mode === 'readiness' ? readinessRefreshing : mode === 'quality' ? qualityRefreshing : knowledgeRefreshing}
              icon={<RefreshCw size={15} className={(mode === 'overview' ? refreshing : mode === 'actions' ? actionRefreshing : mode === 'readiness' ? readinessRefreshing : mode === 'quality' ? qualityRefreshing : knowledgeRefreshing) ? 'animate-spin' : ''} />}
            >
              刷新
            </Button>
            <span className="whitespace-nowrap text-xs text-muted">
              {lastUpdatedAt
                ? `最近刷新 ${lastUpdatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
                : '正在读取最新数据'}
            </span>
          </div>
          </>
        )}
      />

      {mode === 'quality' ? (
        <QualityView
          embedded
          refreshKey={qualityRefreshKey}
          onScoreChange={setQualityScore}
          onRefreshComplete={() => {
            setQualityRefreshing(false);
            setLastUpdatedAt(new Date());
          }}
        />
      ) : null}

      {mode === 'knowledge' ? (
        <KnowledgeView
          initialEntryId={initialKnowledgeEntryId}
          refreshKey={knowledgeRefreshKey}
          onRefreshComplete={() => {
            setKnowledgeRefreshing(false);
            setLastUpdatedAt(new Date());
          }}
        />
      ) : null}

      {mode === 'actions' ? (
        <ManagementActionCenterView center={actionCenter} loading={actionLoading} error={actionError} />
      ) : null}

      {mode === 'readiness' ? (
        <OrderReadinessOverviewView overview={readinessOverview} loading={readinessLoading} error={readinessError} />
      ) : null}

      {mode === 'overview' && error && (
        <div className="flex items-center gap-2 rounded-panel border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <CircleAlert size={16} />
          {error}
        </div>
      )}

      {mode === 'overview' && (loading || !summary) ? (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-panel bg-slate-100" />
          ))}
        </div>
      ) : mode === 'overview' && summary ? (
        <>
          <MetricGrid>
            <MetricCard
              href="/orders"
              ariaLabel="查看累计销售额对应订单"
              value={money(summary.financials.totalRevenue)}
              label="累计销售额"
              delay={0.02}
            />
            <MetricCard
              href="/orders"
              ariaLabel="查看累计利润对应订单"
              value={money(summary.financials.totalProfit)}
              label="预计利润"
              note={`锁定成本已计采购价差 ${money(summary.financials.procurementVariance)}，利润率 ${summary.financials.profitRate}%`}
              delay={0.04}
            />
            <MetricCard
              href="/orders"
              ariaLabel="查看未完成订单"
              value={String(summary.orders.active)}
              label="未完成订单"
              delay={0.06}
            />
            <MetricCard
              href="/parts?stock=attention"
              ariaLabel="查看库存预警零件"
              value={String(summary.kpis.lowStockPartCount + summary.kpis.outOfStockPartCount)}
              label="库存预警"
              tone={summary.kpis.lowStockPartCount + summary.kpis.outOfStockPartCount > 0 ? 'attention' : 'default'}
              delay={0.08}
            />
          </MetricGrid>

          <div className={`grid gap-4 ${summary.workbench.supplierFocus.length > 0 ? 'xl:grid-cols-[1fr_420px]' : ''}`}>
            <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
              <div className="flex items-center justify-between gap-3 border-b border-line p-4">
                <div>
                  <div className="text-sm font-semibold text-ink">今日工作台</div>
                  <div className="mt-1 text-xs text-muted">需要优先处理的业务状态</div>
                </div>
                <ClipboardList size={18} className="text-muted" />
              </div>
              <div className="grid gap-3 p-4 md:grid-cols-2">
                {actionableWorkbenchItems.map((item) => (
                  <a
                    key={item.key}
                    href={item.path}
                    className={`block rounded-panel border p-4 transition hover:brightness-[0.98] focus:outline-none focus:ring-2 focus:ring-slate-400 ${severityClassName(item.severity)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{item.label}</div>
                        <div className="mt-1 text-xs opacity-80">{item.desc}</div>
                      </div>
                      <div className="text-2xl font-semibold">{item.count}</div>
                    </div>
                  </a>
                ))}
                {actionableWorkbenchItems.length === 0 ? (
                  <div className="col-span-full flex items-center gap-2 py-1 text-emerald-700">
                    <CheckCircle2 size={18} className="shrink-0" />
                    <div className="text-sm font-medium">当前没有待处理业务状态</div>
                  </div>
                ) : null}
                <div className="col-span-full flex flex-wrap gap-2 border-t border-line pt-3">
                  {summary.workbench.supplierFocus.length === 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                      <CheckCircle2 size={13} />
                      供应商采购无待办
                    </span>
                  ) : null}
                  {summary.workbench.pendingPurchaseItems.length === 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                      <CheckCircle2 size={13} />
                      当前无待采购物料
                    </span>
                  ) : null}
                </div>
              </div>
            </FadePanel>

            {summary.workbench.supplierFocus.length > 0 ? (
              <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
                <div className="flex items-center justify-between gap-3 border-b border-line p-4">
                  <div>
                    <div className="text-sm font-semibold text-ink">供应商关注</div>
                    <div className="mt-1 text-xs text-muted">按未采购数量排序</div>
                  </div>
                  <Store size={18} className="text-muted" />
                </div>
                <div className="divide-y divide-line">
                  {summary.workbench.supplierFocus.slice(0, 6).map((supplier) => (
                    <a key={supplier.supplier} href="/purchase" className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">{supplier.supplier}</div>
                        <div className="mt-1 text-xs text-muted">{supplier.orderCount} 个订单</div>
                      </div>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                        {supplier.pendingQty}
                      </span>
                    </a>
                  ))}
                </div>
              </FadePanel>
            ) : null}
          </div>

          <div className={`grid gap-4 ${summary.workbench.pendingPurchaseItems.length > 0 ? 'xl:grid-cols-2' : ''}`}>
            {summary.workbench.pendingPurchaseItems.length > 0 ? (
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
                          <td className="border-b border-line px-4 py-3 font-medium text-ink">
                            <a href="/purchase" className="hover:underline">{item.model}</a>
                          </td>
                          <td className="border-b border-line px-4 py-3 text-muted">{item.supplier}</td>
                          <td className="border-b border-line px-4 py-3 text-right text-rose-600">{item.needToBuy}</td>
                          <td className="border-b border-line px-4 py-3 text-right text-muted">{item.orderCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </FadePanel>
            ) : null}

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
                  <a key={order.id} href={`/orders?orderId=${order.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{order.customerName || '未命名客户'}</div>
                      <div className="mt-1 text-xs text-muted">
                        {order.contractNo || '-'} · {order.itemCount} 个型号 · {dateShort(order.createdAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge tone={statusTone(order.status)}>{order.status}</StatusBadge>
                      <span className="text-sm font-medium text-ink">{money(order.totalPrice)}</span>
                    </div>
                  </a>
                ))}
              </div>
            </FadePanel>
          </div>

          <FadePanel className="rounded-panel border border-line bg-white shadow-panel">
            <div className="flex items-center justify-between gap-3 border-b border-line p-4">
              <div>
                  <div className="text-sm font-semibold text-ink">缺货零件</div>
                  <div className="mt-1 text-xs text-muted">库存为 0 的前 6 项</div>
                </div>
              <div className="flex items-center gap-3">
                <a href="/parts?stock=out" className="text-xs font-medium text-muted hover:text-ink hover:underline">查看全部</a>
                <PackageMinus size={18} className="text-muted" />
              </div>
            </div>
            <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
              {summary.workbench.outOfStockParts.slice(0, 6).map((part) => (
                <a
                  key={part.id}
                  href={`/parts?stock=out&query=${encodeURIComponent(part.model)}`}
                  className="rounded-md border border-line p-3 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="truncate text-sm font-medium text-ink">{part.model}</div>
                  <div className="mt-1 text-xs text-muted">{part.category || '未分类'} · {part.supplier || '无供应商'}</div>
                </a>
              ))}
              {summary.workbench.outOfStockParts.length === 0 && (
                <div className="col-span-full p-6 text-center text-sm text-muted">暂无缺货零件</div>
              )}
            </div>
          </FadePanel>
        </>
      ) : null}
    </div>
  );
}
