'use client';

import {
  AlertCircle,
  Archive,
  Check,
  FileSearch,
  Loader2,
  MessageSquareWarning,
  RefreshCw,
  Save,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/field';
import type {
  AiAnswerFeedbackRating,
  AiAttachment,
} from '@/lib/ai';
import type {
  FactoryFileArchiveTarget,
  FactoryFileArchiveTargetType,
  FactoryFileLink,
} from '@/lib/files';
import type { KnowledgeSyncStats } from '@/lib/knowledge';

const archiveTargetOptions: Array<{ value: FactoryFileArchiveTargetType; label: string }> = [
  { value: 'knowledge_document', label: '知识库资料' },
  { value: 'order', label: '订单' },
  { value: 'recipe', label: '配方' },
  { value: 'customer', label: '客户' },
  { value: 'quotation', label: '报价' },
  { value: 'recipe_analysis_feedback', label: '质量问题（配方检查）' },
  { value: 'ai_answer_feedback', label: '质量问题（AI回答）' },
];

const documentTypeOptions = [
  { value: 'technical_note', label: '技术说明' },
  { value: 'pump_performance_test', label: '性能测试报告' },
  { value: 'drawing', label: '图纸' },
  { value: 'spreadsheet', label: '电子表格' },
  { value: 'other', label: '其他资料' },
] as const;

export type ArchiveDocumentType = typeof documentTypeOptions[number]['value'];

export function defaultArchiveDocumentType(attachment: AiAttachment): ArchiveDocumentType {
  if (attachment.detectedType === 'spreadsheet') return 'spreadsheet';
  if (attachment.detectedType === 'image') return 'drawing';
  if (attachment.detectedType === 'text') return 'technical_note';
  return 'other';
}

export function archiveTargetLabel(value: FactoryFileArchiveTargetType) {
  return archiveTargetOptions.find(option => option.value === value)?.label || value;
}

type AttachmentArchiveDialogProps = {
  attachment: AiAttachment;
  targetType: FactoryFileArchiveTargetType;
  query: string;
  targets: FactoryFileArchiveTarget[];
  targetId: string;
  title: string;
  note: string;
  tags: string;
  documentType: ArchiveDocumentType;
  links: FactoryFileLink[];
  loading: boolean;
  searching: boolean;
  saving: boolean;
  error: string;
  success: string;
  onTargetTypeChange: (value: FactoryFileArchiveTargetType) => void;
  onQueryChange: (value: string) => void;
  onTargetIdChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onDocumentTypeChange: (value: ArchiveDocumentType) => void;
  onSearch: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onClose: () => void;
};

export function AttachmentArchiveDialog({
  attachment,
  targetType,
  query,
  targets,
  targetId,
  title,
  note,
  tags,
  documentType,
  links,
  loading,
  searching,
  saving,
  error,
  success,
  onTargetTypeChange,
  onQueryChange,
  onTargetIdChange,
  onTitleChange,
  onNoteChange,
  onTagsChange,
  onDocumentTypeChange,
  onSearch,
  onSave,
  onClose,
}: AttachmentArchiveDialogProps) {
  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      size="md"
      layer="assistant"
      closeOnBackdrop={false}
      ariaLabelledBy="file-archive-title"
      panelClassName="flex flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="file-archive-title" className="text-base font-semibold text-ink">归档附件</h2>
            <div className="mt-1 truncate text-xs text-muted">{attachment.originalName}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 px-0"
            icon={<X size={16} />}
            aria-label="关闭"
            title="关闭"
            onClick={onClose}
            disabled={saving}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <label className="block">
            <span className="text-xs font-medium text-muted">归档位置</span>
            <select
              value={targetType}
              onChange={event => onTargetTypeChange(event.target.value as FactoryFileArchiveTargetType)}
              className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-slate-400"
              disabled={saving}
            >
              {archiveTargetOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          {targetType === 'knowledge_document' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-muted">资料标题</span>
                <input
                  value={title}
                  onChange={event => onTitleChange(event.target.value)}
                  maxLength={160}
                  className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-slate-400"
                  disabled={saving}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted">资料类型</span>
                <select
                  value={documentType}
                  onChange={event => onDocumentTypeChange(event.target.value as ArchiveDocumentType)}
                  className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-slate-400"
                  disabled={saving}
                >
                  {documentTypeOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted">标签</span>
                <input
                  value={tags}
                  onChange={event => onTagsChange(event.target.value)}
                  placeholder="型号、客户、用途"
                  className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-slate-400"
                  disabled={saving}
                />
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <span className="text-xs font-medium text-muted">查找{archiveTargetLabel(targetType)}</span>
                <div className="mt-2 flex gap-2">
                  <input
                    value={query}
                    onChange={event => onQueryChange(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void onSearch();
                      }
                    }}
                    placeholder="输入名称或关键词"
                    className="h-10 min-w-0 flex-1 rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-slate-400"
                    disabled={searching || saving}
                  />
                  <Button
                    variant="secondary"
                    className="h-10"
                    icon={searching ? <Loader2 size={15} className="animate-spin" /> : <FileSearch size={15} />}
                    onClick={() => void onSearch()}
                    disabled={searching || saving}
                  >
                    搜索
                  </Button>
                </div>
              </div>
              {targets.length > 0 ? (
                <label className="block">
                  <span className="text-xs font-medium text-muted">选择准确对象</span>
                  <select
                    value={targetId}
                    onChange={event => onTargetIdChange(event.target.value)}
                    className="mt-2 h-11 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-slate-400"
                    disabled={saving}
                  >
                    <option value="">请选择</option>
                    {targets.map(target => (
                      <option key={target.id} value={target.id}>
                        {target.label}{target.detail ? ` · ${target.detail}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium text-muted">归档说明（可选）</span>
            <textarea
              value={note}
              onChange={event => onNoteChange(event.target.value)}
              maxLength={1000}
              rows={3}
              className="mt-2 w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-slate-400"
              disabled={saving}
            />
          </label>

          <div className="rounded-md border border-line bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <Archive size={14} />
              已有归档
            </div>
            {loading ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                <Loader2 size={13} className="animate-spin" />
                正在读取
              </div>
            ) : links.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {links.map(link => (
                  <div key={link.id} className="flex items-start justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-slate-700">{link.target?.label || `已删除对象 ${link.targetId}`}</span>
                    <span className="shrink-0 text-muted">{archiveTargetLabel(link.targetType)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-muted">尚未归档</div>
            )}
          </div>

          {success ? (
            <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              <Check size={15} className="mt-0.5 shrink-0" />
              {success}
            </div>
          ) : null}
          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>关闭</Button>
          <Button
            variant="primary"
            icon={saving ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
            onClick={() => void onSave()}
            disabled={loading || saving}
          >
            {saving ? '归档中' : '确认归档'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

type AnswerFeedbackDialogProps = {
  rating: Exclude<AiAnswerFeedbackRating, 'helpful'>;
  note: string;
  learnFromCorrection: boolean;
  saving: boolean;
  error: string;
  onRatingChange: (value: Exclude<AiAnswerFeedbackRating, 'helpful'>) => void;
  onNoteChange: (value: string) => void;
  onLearnFromCorrectionChange: (value: boolean) => void;
  onSave: () => void | Promise<void>;
  onClose: () => void;
};

export function AnswerFeedbackDialog({
  rating,
  note,
  learnFromCorrection,
  saving,
  error,
  onRatingChange,
  onNoteChange,
  onLearnFromCorrectionChange,
  onSave,
  onClose,
}: AnswerFeedbackDialogProps) {
  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      size="md"
      layer="assistant"
      closeOnBackdrop={false}
      ariaLabelledBy="answer-feedback-title"
    >
      <div>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 id="answer-feedback-title" className="text-base font-semibold text-ink">报告回答问题</h2>
            <div className="mt-1 text-xs text-muted">反馈会进入知识库管理中心；长期规则只约束 AI，不会修改业务数据。</div>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 px-0" icon={<X size={16} />} aria-label="关闭" onClick={onClose} disabled={saving} />
        </div>
        <div className="space-y-4 p-4">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="问题类型">
            {([
              ['incorrect', '内容错误'],
              ['outdated', '来源过期'],
              ['missing_source', '资料不足'],
            ] as Array<[Exclude<AiAnswerFeedbackRating, 'helpful'>, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                onClick={() => onRatingChange(value)}
                className={`h-10 rounded-md border px-3 text-sm font-medium ${
                  rating === value ? 'border-ink bg-ink text-white' : 'border-line bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="text-xs font-medium text-muted">
              {rating === 'incorrect' && learnFromCorrection ? '正确做法' : '补充说明（可选）'}
            </span>
            <textarea
              value={note}
              onChange={event => onNoteChange(event.target.value)}
              maxLength={500}
              rows={4}
              placeholder={rating === 'incorrect' && learnFromCorrection
                ? '例如：规格-片数表示线圈成品，入库时必须调整线圈库存，不能查询零件库。'
                : '例如：业务数据已于今天更新，需要重新读取当前值。'}
              className="mt-2 w-full resize-y rounded-md border border-line bg-slate-50 px-3 py-2 text-sm leading-6 text-ink outline-none focus:border-slate-400"
              disabled={saving}
            />
          </label>
          {rating === 'incorrect' ? (
            <label className="flex items-start gap-3 rounded-md border border-line bg-slate-50 px-3 py-2.5">
              <Checkbox
                checked={learnFromCorrection}
                onChange={event => onLearnFromCorrectionChange(event.target.checked)}
                className="mt-0.5"
                disabled={saving}
              />
              <span>
                <span className="block text-sm font-medium text-ink">让 AI 长期记住这条正确做法</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">启用后会成为通用纠正规则，可在知识库管理中心停用。</span>
              </span>
            </label>
          ) : null}
          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
          <Button variant="primary" icon={saving ? <Loader2 size={15} className="animate-spin" /> : <MessageSquareWarning size={15} />} onClick={() => void onSave()} disabled={saving}>
            {saving ? '提交中' : '提交反馈'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

type DeleteConversationDialogProps = {
  title: string;
  deleting: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};

export function DeleteConversationDialog({
  title,
  deleting,
  onConfirm,
  onClose,
}: DeleteConversationDialogProps) {
  return (
    <ConfirmDialog
      open
      layer="assistant"
      title="删除会话"
      description={<>确定删除“{title}”及其历史记录吗？</>}
      confirmLabel="删除"
      confirmVariant="danger"
      busy={deleting}
      onConfirm={() => void onConfirm()}
      onClose={onClose}
    />
  );
}

type KnowledgeSyncDialogProps = {
  result: KnowledgeSyncStats | null;
  syncing: boolean;
  error: string;
  onSync: () => void | Promise<void>;
  onClose: () => void;
};

export function KnowledgeSyncDialog({
  result,
  syncing,
  error,
  onSync,
  onClose,
}: KnowledgeSyncDialogProps) {
  return (
    <Dialog
      open
      onClose={() => {
        if (!syncing) onClose();
      }}
      size="sm"
      layer="assistant"
      closeOnBackdrop={false}
      ariaLabelledBy="knowledge-sync-title"
    >
      <div>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 id="knowledge-sync-title" className="text-base font-semibold text-ink">同步工厂知识库</h2>
            <div className="mt-1 text-xs text-muted">从当前业务数据库刷新 AI 检索条目</div>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 px-0" icon={<X size={16} />} aria-label="关闭" title="关闭" onClick={onClose} disabled={syncing} />
        </div>
        <div className="p-4">
          {result ? (
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <Check size={16} />
                同步完成，共 {result.total} 条知识
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div className="rounded-md border border-line bg-slate-50 p-2 text-center"><div className="font-semibold text-ink">{result.inserted}</div><div className="mt-1 text-xs text-muted">新增</div></div>
                <div className="rounded-md border border-line bg-slate-50 p-2 text-center"><div className="font-semibold text-ink">{result.updated}</div><div className="mt-1 text-xs text-muted">更新</div></div>
                <div className="rounded-md border border-line bg-slate-50 p-2 text-center"><div className="font-semibold text-ink">{result.deleted}</div><div className="mt-1 text-xs text-muted">移除</div></div>
                <div className="rounded-md border border-line bg-slate-50 p-2 text-center"><div className="font-semibold text-ink">{result.unchanged}</div><div className="mt-1 text-xs text-muted">未变化</div></div>
              </div>
            </div>
          ) : (
            <div className="text-sm leading-6 text-slate-700">
              同步会读取零件、模板、配方、线圈、客户、报价、订单、质量问题和业务规则，增量更新 AI 使用的知识索引，不会修改原始业务数据。
            </div>
          )}
          {error ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          {result ? (
            <Button variant="primary" onClick={onClose}>完成</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={syncing}>取消</Button>
              <Button variant="primary" icon={syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} onClick={() => void onSync()} disabled={syncing}>
                {syncing ? '同步中' : '确认同步'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

type SystemPromptDialogProps = {
  draft: string;
  loading: boolean;
  saving: boolean;
  error: string;
  onDraftChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onClose: () => void;
};

export function SystemPromptDialog({
  draft,
  loading,
  saving,
  error,
  onDraftChange,
  onSave,
  onClose,
}: SystemPromptDialogProps) {
  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      size="lg"
      layer="assistant"
      closeOnBackdrop={!saving}
      ariaLabelledBy="ai-prompt-title"
      panelClassName="flex flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 id="ai-prompt-title" className="text-base font-semibold text-ink">编辑工厂配置</h2>
            <p className="mt-1 text-xs text-muted">用于术语、偏好和操作习惯；核心安全与业务规则由系统维护。</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-8 px-0"
            icon={<X size={16} />}
            aria-label="关闭"
            title="关闭"
            onClick={onClose}
            disabled={saving}
          />
        </div>
        <div className="min-h-0 flex-1 p-4">
          {loading ? (
            <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" />
              正在读取工厂配置
            </div>
          ) : (
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              aria-label="工厂个性化配置"
              autoFocus
              className="h-[min(58vh,560px)] min-h-72 w-full resize-y rounded-md border border-line bg-slate-50 px-3 py-3 font-mono text-sm leading-6 text-ink outline-none transition-colors focus:border-slate-400"
              disabled={saving}
            />
          )}
          {error ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-rose-600">
              <AlertCircle size={15} />
              {error}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
          <Button variant="primary" icon={saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} onClick={() => void onSave()} disabled={loading || saving || !draft.trim()}>
            {saving ? '保存中' : '保存'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
