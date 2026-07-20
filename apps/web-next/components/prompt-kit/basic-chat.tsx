'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, FormEvent, HTMLAttributes, KeyboardEvent, ReactNode, TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

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
  const blocks = parseMarkdown(children);
  return (
    <div className={clsx('space-y-2 text-sm leading-6', className)}>
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <pre key={index} className="max-w-full overflow-x-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
              <code>{block.content}</code>
            </pre>
          );
        }
        if (block.type === 'list') {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInline(item, `${index}-${itemIndex}`)}</li>)}
            </ul>
          );
        }
        if (block.type === 'table') {
          return (
            <div key={index} className="max-w-full overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[360px] border-collapse text-left text-sm">
                <thead className="bg-slate-100 text-xs font-semibold text-slate-600">
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th key={`${header}-${headerIndex}`} className="border-b border-slate-200 px-3 py-2">
                        {renderInline(header, `${index}-header-${headerIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {block.headers.map((_, cellIndex) => (
                        <td key={cellIndex} className="px-3 py-2 text-slate-700">
                          {renderInline(row[cellIndex] || '', `${index}-${rowIndex}-${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.type === 'ordered-list') {
          return (
            <ol key={index} className="list-decimal space-y-1 pl-5">
              {block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInline(item, `${index}-${itemIndex}`)}</li>)}
            </ol>
          );
        }
        if (block.type === 'heading') {
          return <div key={index} className="pt-1 text-base font-semibold text-ink">{renderInline(block.content, `${index}`)}</div>;
        }
        return <p key={index} className="whitespace-pre-wrap">{renderInline(block.content, `${index}`)}</p>;
      })}
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

type MarkdownBlock =
  | { type: 'paragraph'; content: string }
  | { type: 'heading'; content: string }
  | { type: 'list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'code'; content: string };

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${keyPrefix}-code-${index}`} className="rounded bg-slate-100 px-1 py-0.5 text-[0.92em] text-slate-800">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let orderedList: string[] = [];
  let tableRows: string[][] = [];
  let code: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', content: paragraph.join('\n').trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  };
  const flushOrderedList = () => {
    if (orderedList.length > 0) {
      blocks.push({ type: 'ordered-list', items: orderedList });
      orderedList = [];
    }
  };
  const flushTable = () => {
    if (tableRows.length > 0) {
      const meaningfulRows = tableRows.filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell.trim())));
      if (meaningfulRows.length > 0) {
        blocks.push({ type: 'table', headers: meaningfulRows[0], rows: meaningfulRows.slice(1) });
      }
      tableRows = [];
    }
  };
  const parseTableLine = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        blocks.push({ type: 'code', content: code.join('\n') });
        code = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        flushOrderedList();
        flushTable();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushOrderedList();
      flushTable();
      continue;
    }
    if (line.includes('|') && /^\s*\|?.+\|.+\|?\s*$/.test(line)) {
      flushParagraph();
      flushList();
      flushOrderedList();
      tableRows.push(parseTableLine(line));
      continue;
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      flushOrderedList();
      flushTable();
      blocks.push({ type: 'heading', content: heading[1] });
      continue;
    }
    const listItem = line.match(/^\s*[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      flushOrderedList();
      flushTable();
      list.push(listItem[1]);
      continue;
    }
    const orderedListItem = line.match(/^\s*\d+\.\s+(.+)$/);
    if (orderedListItem) {
      flushParagraph();
      flushList();
      flushTable();
      orderedList.push(orderedListItem[1]);
      continue;
    }
    flushList();
    flushOrderedList();
    flushTable();
    paragraph.push(line);
  }

  if (inCode) blocks.push({ type: 'code', content: code.join('\n') });
  flushParagraph();
  flushList();
  flushOrderedList();
  flushTable();
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', content: markdown }];
}
