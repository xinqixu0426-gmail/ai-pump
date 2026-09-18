'use client';

import { useEffect, useRef, useState } from 'react';
import { getCatalogNamingRules, previewCatalogName, type CatalogNamingInput, type CatalogNamingRule } from '@/lib/catalog-naming';

export function CatalogCreateNaming({ ruleId, naming, lockedSpec = {}, name, onChange, previewEnabled = true, previewError }: {
  ruleId: string;
  naming?: CatalogNamingInput;
  lockedSpec?: Record<string, string | number | undefined>;
  name: string;
  onChange: (naming: CatalogNamingInput, name: string) => void;
  previewEnabled?: boolean;
  previewError?: string;
}) {
  const [rule, setRule] = useState<CatalogNamingRule>();
  const [error, setError] = useState<string | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const spec = { ...(naming?.spec || {}) };
  for (const [key, value] of Object.entries(lockedSpec)) {
    if (value === undefined) delete spec[key];
    else spec[key] = value;
  }
  const signature = JSON.stringify({ ruleId, spec });
  useEffect(() => {
    let active = true;
    getCatalogNamingRules().then(rules => { if (active) setRule(rules.find(item => item.id === ruleId)); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [ruleId]);
  useEffect(() => {
    if (!previewEnabled) return;
    let active = true;
    const input: CatalogNamingInput = JSON.parse(signature);
    const timer = setTimeout(() => {
      previewCatalogName(input).then(generated => {
        if (active) { setError(null); callback.current(input, generated); }
      }).catch(error => { if (active) { setError(error.message); callback.current(input, ''); } });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [signature, previewEnabled]);
  return <div className="space-y-3 rounded-md border border-line p-3">
    <div className="text-sm font-medium text-ink">按规格生成名称</div>
    <div className="grid gap-3 sm:grid-cols-2">
      {rule?.fields.filter(field => !Object.prototype.hasOwnProperty.call(lockedSpec, field.key)).map(field => <label key={field.key} className="block min-w-0">
        <span className="text-xs text-muted">{field.label}{field.optional ? '（可选）' : ''}{field.unit ? ` · ${field.unit}` : ''}</span>
        <input aria-label={`命名${field.label}`} type={field.type === 'number' ? 'number' : 'text'} value={naming?.spec[field.key] ?? ''} onChange={event => {
          const next = { ...spec };
          if (event.target.value === '') delete next[field.key];
          else next[field.key] = field.type === 'number' ? Number(event.target.value) : event.target.value;
          onChange({ ruleId, spec: next }, '');
        }} className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm" />
      </label>)}
    </div>
    <div className="break-words text-sm text-ink" aria-live="polite">生成名称：{name || '请补齐规格'}</div>
    {previewError || error ? <div className="text-xs text-amber-700">{previewError || error}</div> : null}
  </div>;
}
