'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  businessAlertClassName,
  getBusinessAlerts,
  type BusinessAlert,
  type BusinessAlertScope,
  type BusinessAlertsSummary,
} from '@/lib/quality';

type Props = {
  scope?: BusinessAlertScope;
  limit?: number;
};

const severityLabel = {
  high: '高风险',
  medium: '需关注',
  low: '提示',
};

export function BusinessAlertsBanner({ scope, limit = 3 }: Props) {
  const [summary, setSummary] = useState<BusinessAlertsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setSummary(await getBusinessAlerts());
    } catch (err) {
      setError(err instanceof Error ? err.message : '经营异常提醒加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const alerts = useMemo(() => {
    const all = summary?.alerts || [];
    return all.filter((item) => !scope || item.scope === scope).slice(0, limit);
  }, [limit, scope, summary]);

  const total = useMemo(() => {
    const all = summary?.alerts || [];
    return all.filter((item) => !scope || item.scope === scope).length;
  }, [scope, summary]);

  if (loading) {
    return (
      <div className="rounded-panel border border-line bg-white p-4 text-sm text-muted shadow-panel">
        经营异常提醒加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-panel border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <span>{error}</span>
        <Button size="sm" type="button" onClick={() => void load()} icon={<RefreshCw size={14} />}>重试</Button>
      </div>
    );
  }

  if (alerts.length === 0) return null;

  return (
    <div className="rounded-panel border border-line bg-white p-4 shadow-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <AlertTriangle size={16} className="text-amber-600" />
            经营异常提醒
          </div>
          <div className="mt-1 text-xs text-muted">当前范围共 {total} 条提醒，优先处理高风险项。</div>
        </div>
        <Button size="sm" type="button" variant="ghost" onClick={() => void load()} icon={<RefreshCw size={14} />}>
          刷新
        </Button>
      </div>

      <div className="mt-3 grid gap-2">
        {alerts.map((alert) => (
          <AlertRow key={`${alert.scope}-${alert.entityId}-${alert.title}`} alert={alert} />
        ))}
      </div>
    </div>
  );
}

function AlertRow({ alert }: { alert: BusinessAlert }) {
  return (
    <div className={`flex flex-col gap-2 rounded-md border px-3 py-2 text-sm md:flex-row md:items-center md:justify-between ${businessAlertClassName(alert.severity)}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold">{severityLabel[alert.severity]}</span>
          <span className="font-medium">{alert.title}</span>
        </div>
        <div className="mt-1 text-xs opacity-85">{alert.detail}</div>
      </div>
      <Button
        size="sm"
        type="button"
        variant="ghost"
        onClick={() => {
          window.location.href = alert.path;
        }}
      >
        处理
      </Button>
    </div>
  );
}
