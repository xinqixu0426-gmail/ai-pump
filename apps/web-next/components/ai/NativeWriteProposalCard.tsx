'use client';

/**
 * NATIVE-W2 —— 零件库存调整提案卡片（唯一获批写能力的确认界面）。
 *
 * 展示契约：
 *   - 所有数字都直接渲染服务端冻结提案（含 nextStock / clampedToZero），前端不做任何算术；
 *   - 增量带显式符号与方向文字（不依赖颜色表达方向）；
 *   - 只有服务端核实成功（verified）才显示成功态；
 *   - 失败/过期/取消的卡片明显失活，且不可能再发起执行；
 *   - 不显示任何内部枚举、operationId、幂等键、哈希或凭据。
 */

import { AlertTriangle, CheckCircle2, Loader2, PackageSearch, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  WRITE_CARD_STATUS,
  canCancelWriteCard,
  canConfirmWriteCard,
  pendingMessage,
  toProposalCardModel,
  type NativeWriteCard,
} from '@/lib/ai-write-proposal.cjs';

function Row({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-1.5 last:border-b-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={emphasis ? 'text-sm font-semibold tabular-nums text-ink' : 'text-sm tabular-nums text-ink'}>{value}</span>
    </div>
  );
}

export function NativeWriteProposalCard({
  card,
  onConfirm,
  onCancel,
}: {
  card: NativeWriteCard;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const model = card.event ? toProposalCardModel(card.event) : null;
  const inactive = card.status === WRITE_CARD_STATUS.CANCELLED
    || card.status === WRITE_CARD_STATUS.EXPIRED
    || card.status === WRITE_CARD_STATUS.SUCCEEDED
    || card.status === WRITE_CARD_STATUS.FAILED;
  const pending = pendingMessage(card.status);

  if (card.success) {
    return (
      <div className="rounded-panel border border-emerald-200 bg-emerald-50/70 p-3 shadow-panel">
        <div className="flex items-start gap-2">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-700" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-emerald-950">{card.success.title}</div>
            <div className="mt-2 space-y-0.5">
              {card.success.rows.map((row: { key: string; label: string; value: string }) => <Row key={row.key} label={row.label} value={row.value} emphasis={row.key === 'verified'} />)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!model) {
    // 没有可执行的服务端提案（历史/重载/过期）：只渲染失活说明，永不重建执行请求。
    return (
      <div className="rounded-panel border border-line bg-slate-50 p-3 shadow-panel">
        <div className="flex items-start gap-2">
          <PackageSearch size={17} className="mt-0.5 shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-muted">库存调整确认</div>
            <p className="mt-1 text-sm text-muted">{card.notice || '该库存调整方案已失效，请重新生成方案。'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-panel border p-3 shadow-panel ${inactive ? 'border-line bg-slate-50 opacity-80' : 'border-line bg-white'}`}
      aria-busy={card.busy ? true : undefined}
    >
      <div className="flex items-start gap-2">
        <PackageSearch size={17} className={`mt-0.5 shrink-0 ${inactive ? 'text-muted' : 'text-ink'}`} />
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold ${inactive ? 'text-muted' : 'text-ink'}`}>{model.title}</div>
          <div className={`mt-0.5 text-sm ${inactive ? 'text-muted' : 'text-ink'}`}>{model.partLabel}</div>

          <div className="mt-2">
            <Row label="当前库存" value={model.rows[0].value} />
            <Row label="本次调整" value={`${model.rows[1].value}（${model.directionLabel}）`} emphasis />
            <Row label="调整后库存" value={model.rows[2].value} />
          </div>

          {/* 关键安全提示：文字表达，不依赖颜色。 */}
          {model.notice ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-900">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{model.notice}</span>
            </p>
          ) : null}

          {pending ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted" role="status" aria-live="polite">
              <Loader2 size={13} className="animate-spin" />
              <span>{pending}</span>
            </p>
          ) : null}

          {card.failure ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-rose-800" role="alert">
              <XCircle size={13} className="mt-0.5 shrink-0" />
              <span>{card.failure.message}</span>
            </p>
          ) : null}

          {card.status === WRITE_CARD_STATUS.CANCELLED && card.notice ? (
            <p className="mt-2 text-xs text-muted">{card.notice}</p>
          ) : null}
          {card.status === WRITE_CARD_STATUS.EXPIRED && card.notice ? (
            <p className="mt-2 text-xs text-muted">{card.notice}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancel}
              disabled={!canCancelWriteCard(card)}
            >
              {model.cancelLabel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={onConfirm}
              disabled={!canConfirmWriteCard(card)}
            >
              {model.confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
