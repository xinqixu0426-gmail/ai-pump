'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownContent({
  id: _id,
  children,
  className,
}: {
  id: string;
  children: string;
  className?: string;
}) {
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
          code: ({ node: _node, children: codeChildren, ...props }) => {
            const path = String(codeChildren || '').trim();
            if (isSafeInternalHref(path)) {
              return (
                <a
                  href={path}
                  title={path}
                  className="inline-flex rounded bg-sky-50 px-1.5 py-0.5 text-[0.92em] font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:bg-sky-100"
                >
                  打开页面
                </a>
              );
            }
            return <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.92em] text-slate-800" {...props}>{codeChildren}</code>;
          },
          a: ({ node: _node, href, children: linkChildren, ...props }) => href ? (
            <a
              href={href}
              target={isSafeInternalHref(href) ? undefined : '_blank'}
              rel={isSafeInternalHref(href) ? undefined : 'noreferrer'}
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

  return <MarkdownContent id={id} className={className}>{displayText}</MarkdownContent>;
}

function safeHref(value: string) {
  const href = value.trim();
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) return href;
  return '';
}

function isSafeInternalHref(value: string) {
  return /^\/(?!\/)[^\s]*$/.test(value);
}
