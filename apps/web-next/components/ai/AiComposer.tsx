'use client';

import { forwardRef, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { Bot, Loader2, Mic, MicOff, Paperclip, ReceiptText, Send, X } from 'lucide-react';
import type { AiAttachment, AiCapabilities, AiProviderPreference } from '@/lib/ai';
import type { AiPageContext } from '@/lib/page-context';
import { AiPendingAttachmentStrip } from '@/components/ai/AiAttachmentDisplays';
import { restoreRejectedDraft } from '@/components/ai/ai-composer-state';
import { useAiSpeechInput } from '@/components/ai/useAiSpeechInput';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';

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
  providerPreference: AiProviderPreference;
  fileInputRef: RefObject<HTMLInputElement>;
  onSelectAttachments: (files: FileList | null) => void;
  onRemoveAttachment: (attachment: AiAttachment) => void;
  onStop: () => void;
  onProviderPreferenceChange: (preference: AiProviderPreference) => void;
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
  providerPreference,
  fileInputRef,
  onSelectAttachments,
  onRemoveAttachment,
  onStop,
  onProviderPreferenceChange,
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
  const providerOptions = (aiCapabilities?.providerOptions || []).filter((option) => option.available);
  const selectedProvider = providerOptions.find((option) => option.value === providerPreference)
    || providerOptions.find((option) => option.value === 'default');
  const selectedSupportsImages = selectedProvider?.supportsImages ?? aiCapabilities?.supportsImages;

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
      <div className="rounded-2xl border border-line bg-slate-50 p-2 shadow-panel md:rounded-panel">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => {
            if (isListening) stopVoiceInput();
            setInput(event.target.value);
          }}
          placeholder={panel ? '输入问题…' : '输入要查询或处理的事情...'}
          rows={1}
          className="max-h-28 min-h-10 w-full resize-none border-0 bg-transparent px-2 py-1.5 text-base leading-6 text-ink outline-none [field-sizing:content] placeholder:text-slate-400 md:min-h-9 md:text-sm"
          disabled={loading}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submitDraft();
            }
          }}
        />
        <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-9 shrink-0 rounded-full px-0"
              icon={uploadingAttachment ? <Loader2 size={17} className="animate-spin" /> : <Paperclip size={17} />}
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || uploadingAttachment || pendingAttachments.length >= (aiCapabilities?.maxAttachments || 4)}
              aria-label="上传文件或图片"
              title="上传文件或图片"
            />
            <div className="relative min-w-0 max-w-[12rem] flex-1" title={selectedProvider ? `${selectedProvider.displayName}·${selectedProvider.model}` : '模型选择'}>
              <Bot size={14} className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-muted" />
              <Select
                compact
                value={providerPreference}
                onChange={(event) => onProviderPreferenceChange(event.target.value as AiProviderPreference)}
                disabled={loading || providerOptions.length === 0}
                aria-label="选择 AI 模型"
                className="h-8 min-w-0 max-w-full rounded-full border-transparent bg-transparent py-0 pl-8 pr-2 text-xs font-medium hover:border-line hover:bg-white focus:bg-white"
              >
                {providerOptions.map((option) => (
                  <option key={option.value} value={option.value} title={option.model}>
                    {option.displayName}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              className={`h-9 w-9 shrink-0 rounded-full px-0 ${isListening ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : ''}`}
              icon={isListening ? <MicOff size={17} /> : <Mic size={17} />}
              onClick={toggleVoiceInput}
              disabled={loading || !speechSupported}
              aria-label={isListening ? '停止语音输入' : '开始语音输入'}
              aria-pressed={isListening}
              title={speechSupported ? (isListening ? '停止语音输入' : '语音输入') : '当前浏览器不支持语音输入'}
            />
            {loading ? (
              <Button variant="secondary" className="h-9 w-9 rounded-full px-0" icon={<X size={16} />} onClick={onStop} aria-label="停止" />
            ) : (
              <Button type="submit" variant="primary" className={`h-9 w-9 rounded-full px-0 ${panel ? '' : 'md:w-auto md:rounded-md md:px-3'}`} icon={<Send size={16} />} disabled={(!input.trim() && pendingAttachments.length === 0) || uploadingAttachment} aria-label="发送">
                <span className={panel ? 'sr-only' : 'hidden md:inline'}>发送</span>
              </Button>
            )}
          </div>
        </div>
      </div>
      {isListening || speechError ? (
        <div className="px-2 pt-1.5 text-xs text-rose-600">
          {speechError || '正在聆听…再次点击麦克风结束'}
        </div>
      ) : null}
      {attachmentError || (pendingAttachments.some((item) => item.detectedType === 'image') && aiCapabilities && !selectedSupportsImages) ? (
        <div className={`px-2 pt-1.5 text-xs ${attachmentError ? 'text-rose-600' : 'text-amber-700'}`}>
          {attachmentError || `图片会保存在会话中，但当前 ${selectedProvider?.displayName || aiCapabilities?.displayName} 不支持识图。`}
        </div>
      ) : null}
    </form>
  );
});

AiComposer.displayName = 'AiComposer';
