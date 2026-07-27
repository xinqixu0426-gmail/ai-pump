'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, FormEvent, HTMLAttributes, KeyboardEvent, ReactNode, TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ChatContainer({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-line bg-white', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export const ChatMessages = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ChatMessages({ className, children, ...props }, ref) {
  return (
    <div ref={ref} className={clsx('min-h-0 flex-1 space-y-4 overflow-y-auto p-4', className)} {...props}>
      {children}
    </div>
  );
});

export function Message({ role, className, children }: {
  role: 'user' | 'assistant';
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={clsx('flex', role === 'user' ? 'justify-end' : 'justify-start', className)}>
      <div
        className={clsx(
          'max-w-[92%] rounded-panel border px-3 py-2.5 text-sm leading-6 shadow-panel md:max-w-[78%]',
          role === 'user' ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink'
        )}
      >
        {children}
      </div>
    </article>
  );
}

export function MessageHeader({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <div className={clsx('mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium', muted ? 'text-slate-200' : 'text-muted')}>
      {children}
    </div>
  );
}

export function MarkdownContent({ id: _id, children, className }: { id: string; children: string; className?: string }) {
  return (
    <div className={clsx('space-y-2 text-sm leading-6', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeHref}
        components={{
          h1: ({ node: _node, ...props }) => <h1 className="pt-1 text-lg font-semibold text-ink" {...props} />,
          h2: ({ node: _node, ...props }) => <h2 className="pt-1 text-base font-semibold text-ink" {...props} />,
          h3: ({ node: _node, ...props }) => <h3 className="pt-1 text-sm font-semibold text-ink" {...props} />,
          h4: ({ node: _node, ...props }) => <h4 className="pt-1 text-sm font-semibold text-ink" {...props} />,
          h5: ({ node: _node, ...props }) => <h5 className="pt-1 text-sm font-semibold text-ink" {...props} />,
          h6: ({ node: _node, ...props }) => <h6 className="pt-1 text-sm font-semibold text-ink" {...props} />,
          p: ({ node: _node, ...props }) => <p className="break-words" {...props} />,
          strong: ({ node: _node, ...props }) => <strong className="font-semibold text-ink" {...props} />,
          em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
          del: ({ node: _node, ...props }) => <del className="text-slate-500" {...props} />,
          ul: ({ node: _node, ...props }) => <ul className="list-disc space-y-1 pl-5 [&_ul]:mt-1" {...props} />,
          ol: ({ node: _node, ...props }) => <ol className="list-decimal space-y-1 pl-5 [&_ol]:mt-1" {...props} />,
          li: ({ node: _node, ...props }) => <li className="pl-0.5" {...props} />,
          input: ({ node: _node, ...props }) => <input className="mr-1.5 align-middle accent-sky-700" {...props} />,
          blockquote: ({ node: _node, ...props }) => (
            <blockquote className="border-l-4 border-slate-200 bg-slate-50 px-3 py-2 text-slate-700" {...props} />
          ),
          hr: ({ node: _node, ...props }) => <hr className="border-slate-200" {...props} />,
          table: ({ node: _node, ...props }) => (
            <div className="max-w-full overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[360px] border-collapse text-left text-sm" {...props} />
            </div>
          ),
          thead: ({ node: _node, ...props }) => <thead className="bg-slate-100 text-xs font-semibold text-slate-600" {...props} />,
          tbody: ({ node: _node, ...props }) => <tbody className="divide-y divide-slate-100 bg-white" {...props} />,
          th: ({ node: _node, ...props }) => <th className="border-b border-slate-200 px-3 py-2" {...props} />,
          td: ({ node: _node, ...props }) => <td className="px-3 py-2 text-slate-700" {...props} />,
          pre: ({ node: _node, ...props }) => (
            <pre
              className="max-w-full overflow-x-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit"
              {...props}
            />
          ),
          code: ({ node: _node, ...props }) => (
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.92em] text-slate-800" {...props} />
          ),
          a: ({ node: _node, href, children: linkChildren, ...props }) => href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-sky-700 underline underline-offset-2"
              {...props}
            >
              {linkChildren}
            </a>
          ) : <>{linkChildren}</>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function StreamingText({
  id,
  text,
  streaming = false,
  className,
}: {
  id: string;
  text: string;
  streaming?: boolean;
  className?: string;
}) {
  const [displayText, setDisplayText] = useState(streaming ? '' : text);
  const displayedRef = useRef(streaming ? '' : text);
  const targetRef = useRef(text);

  useEffect(() => {
    targetRef.current = text;
    if (!streaming) {
      displayedRef.current = text;
      setDisplayText(text);
    }
  }, [text, streaming]);

  useEffect(() => {
    if (!streaming) return;

    let frame = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const target = targetRef.current;
      const current = displayedRef.current;

      if (current.length < target.length) {
        const step = Math.max(1, Math.ceil((target.length - current.length) / 6));
        const next = target.slice(0, current.length + step);
        displayedRef.current = next;
        setDisplayText(next);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [id, streaming]);

  return <MarkdownContent id={id} className={className} >{displayText}</MarkdownContent>;
}

export function PromptInput({ onSubmit, className, children }: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className={clsx('border-t border-line bg-white p-3', className)}>
      <div className="rounded-panel border border-line bg-slate-50 p-2 shadow-panel">
        {children}
      </div>
    </form>
  );
}

export function PromptInputTextarea({
  onSubmitShortcut,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { onSubmitShortcut?: () => void }) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    props.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmitShortcut?.();
    }
  }

  return (
    <textarea
      rows={2}
      className={clsx(
        'max-h-32 min-h-12 w-full resize-none border-0 bg-transparent px-2 py-2 text-sm leading-6 text-ink outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}
      {...props}
      onKeyDown={handleKeyDown}
    />
  );
}

export function PromptInputActions({ className, children }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('mt-2 flex items-center justify-between gap-2', className)}>{children}</div>;
}

export function PromptSuggestion({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={clsx(
        'min-h-10 shrink-0 rounded-md border border-line bg-white px-3 text-left text-sm text-ink shadow-panel transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function safeHref(value: string) {
  const href = value.trim();
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) return href;
  return '';
}
