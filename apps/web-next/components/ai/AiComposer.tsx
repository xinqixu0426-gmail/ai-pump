'use client';

import { forwardRef, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { Loader2, Mic, MicOff, Paperclip, ReceiptText, Send, X } from 'lucide-react';
import type { AiAttachment, AiCapabilities } from '@/lib/ai';
import type { AiPageContext } from '@/lib/page-context';
import { AiPendingAttachmentStrip } from '@/components/ai/AiAttachmentDisplays';
import { restoreRejectedDraft } from '@/components/ai/ai-composer-state';
import { useAiSpeechInput } from '@/components/ai/useAiSpeechInput';
import { Button } from '@/components/ui/button';

export type AiComposerHandle = {
  append: (value: string) => void;
  clear: () => void;
  element: () => HTMLTextAreaElement | null;
  focus: () => void;
  hasDraft: () => boolean;
  isFocused: () => boolean;
  replace: (value: string) => void;
};

type AiComposerProps = {
  panel: boolean;
  pageContext: AiPageContext | null;
  loading: boolean;
  pendingAttachments: AiAttachment[];
  uploadingAttachment: boolean;
  attachmentError: string;
  aiCapabilities: AiCapabilities | null;
  fileInputRef: RefObject<HTMLInputElement>;
  onSelectAttachments: (files: FileList | null) => void;
  onRemoveAttachment: (attachment: AiAttachment) => void;
  onStop: () => void;
  onSend: (input: string) => Promise<boolean>;
};

export const AiComposer = forwardRef<AiComposerHandle, AiComposerProps>(function AiComposer({
  panel,
  pageContext,
  loading,
  pendingAttachments,
  uploadingAttachment,
  attachmentError,
  aiCapabilities,
  fileInputRef,
  onSelectAttachments,
  onRemoveAttachment,
  onStop,
  onSend,
}, ref) {
  const [input, setInput] = useState('');
  const inputValueRef = useRef('');
  const submitInFlightRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    speechSupported,
    isListening,
    speechError,
    stopVoiceInput,
    toggleVoiceInput,
  } = useAiSpeechInput(input, setInput);
  inputValueRef.current = input;

  function stopVoiceAndSetInput(value: string | ((current: string) => string)) {
    stopVoiceInput();
    setInput(value);
  }

  async function submitDraft() {
    if ((!input.trim() && pendingAttachments.length === 0) || uploadingAttachment || loading || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    stopVoiceInput();
    const submittedDraft = input;
    setInput('');
    let persisted = false;
    try {
      persisted = await onSend(submittedDraft);
    } catch {
      persisted = false;
    } finally {
      submitInFlightRef.current = false;
    }
    if (!persisted) {
      setInput((current) => restoreRejectedDraft(submittedDraft, current));
    }
  }

  useImperativeHandle(ref, () => ({
    append(value) {
      stopVoiceAndSetInput((current) => current.trim() ? `${current.trimEnd()}\n${value}` : value);
    },
    clear() {
      stopVoiceAndSetInput('');
    },
    element() {
      return textareaRef.current;
    },
    focus() {
      textareaRef.current?.focus({ preventScroll: true });
    },
    hasDraft() {
      return Boolean(inputValueRef.current.trim());
    },
    isFocused() {
      return document.activeElement === textareaRef.current;
    },
    replace(value) {
      stopVoiceAndSetInput(value);
    },
  }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submitDraft();
      }}
      className={`ai-mobile-composer shrink-0 border-t border-line bg-white ${panel ? 'p-3' : 'px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:p-4'}`}
    >
      {panel && pageContext ? (
        <div className="mb-2 flex min-w-0 items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-900" aria-label="AI 页面上下文">
          <ReceiptText size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{pageContext.label}</span>
          <span className="shrink-0 text-sky-700">实时查询</span>
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={(event) => onSelectAttachments(event.target.files)}
      />
      <AiPendingAttachmentStrip
        attachments={pendingAttachments}
        disabled={loading}
        onRemove={onRemoveAttachment}
      />
      <div className="flex items-end gap-2 rounded-2xl border border-line bg-slate-50 p-1.5 shadow-panel md:rounded-panel md:p-2">
        <Button
          type="button"
          variant="secondary"
          className="h-10 w-10 shrink-0 rounded-full px-0 md:h-9 md:w-9"
          icon={uploadingAttachment ? <Loader2 size={17} className="animate-spin" /> : <Paperclip size={17} />}
          onClick={() => fileInputRef.current?.click()}
          disabled={loading || uploadingAttachment || pendingAttachments.length >= (aiCapabilities?.maxAttachments || 4)}
          aria-label="上传文件或图片"
          title="上传文件或图片"
        />
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => {
            if (isListening) stopVoiceInput();
            setInput(event.target.value);
          }}
          placeholder={panel ? '输入问题…' : '输入要查询或处理的事情...'}
          rows={1}
          className="max-h-28 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-base leading-6 text-ink outline-none [field-sizing:content] placeholder:text-slate-400 md:min-h-9 md:py-1.5 md:text-sm"
          disabled={loading}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submitDraft();
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          className={`h-10 w-10 shrink-0 rounded-full px-0 md:h-9 md:w-9 ${isListening ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100' : ''}`}
          icon={isListening ? <MicOff size={17} /> : <Mic size={17} />}
          onClick={toggleVoiceInput}
          disabled={loading || !speechSupported}
          aria-label={isListening ? '停止语音输入' : '开始语音输入'}
          aria-pressed={isListening}
          title={speechSupported ? (isListening ? '停止语音输入' : '语音输入') : '当前浏览器不支持语音输入'}
        />
        {loading ? (
          <Button variant="secondary" className={`h-10 w-10 rounded-full px-0 md:h-9 ${panel ? 'md:w-9' : 'md:w-auto md:rounded-md md:px-3'}`} icon={<X size={16} />} onClick={onStop} aria-label="停止">
            <span className={panel ? 'sr-only' : 'hidden md:inline'}>停止</span>
          </Button>
        ) : (
          <Button type="submit" variant="primary" className={`h-10 w-10 rounded-full px-0 md:h-9 ${panel ? 'md:w-9' : 'md:w-auto md:rounded-md md:px-3'}`} icon={<Send size={16} />} disabled={(!input.trim() && pendingAttachments.length === 0) || uploadingAttachment} aria-label="发送">
            <span className={panel ? 'sr-only' : 'hidden md:inline'}>发送</span>
          </Button>
        )}
      </div>
      {isListening || speechError ? (
        <div className="px-2 pt-1.5 text-xs text-rose-600">
          {speechError || '正在聆听…再次点击麦克风结束'}
        </div>
      ) : null}
      {attachmentError || (pendingAttachments.some((item) => item.detectedType === 'image') && aiCapabilities && !aiCapabilities.supportsImages) ? (
        <div className={`px-2 pt-1.5 text-xs ${attachmentError ? 'text-rose-600' : 'text-amber-700'}`}>
          {attachmentError || `图片会保存在会话中，但当前 ${aiCapabilities?.displayName} 模型不支持识图。`}
        </div>
      ) : null}
    </form>
  );
});

AiComposer.displayName = 'AiComposer';
