'use client';

import { useEffect, useState } from 'react';
import { getCatalogNamingRules, previewCatalogName, previewCatalogRename, saveCatalogRename, type CatalogRenamePreview, type CatalogNamingRule, type SavedCatalogNaming } from '@/lib/catalog-naming';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input, Select, Checkbox } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';

type Target = { entityType: 'part' | 'coil' | 'template' | 'recipe' | 'modelVariant'; entityId: number; name: string; updatedAt: string; category?: string; naming?: SavedCatalogNaming | null };
type Preview = CatalogRenamePreview;
export function CatalogRenameDialog({ target, onClose, onSaved }: { target: Target | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [rules, setRules] = useState<CatalogNamingRule[]>([]);
  const [ruleId, setRuleId] = useState('');
  const [spec, setSpec] = useState<Record<string, string | number>>({});
  const [name, setName] = useState('');
  const [sameItem, setSameItem] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setName(''); setPreview(null); setError(null); setSameItem(false);
    if (!target) return;
    getCatalogNamingRules().then(items => {
      if (!active) return;
      const matching = items.filter(item => target.entityType === 'part' ? (item.category === target.category || item.id === 'custom-part' && !items.some(rule => rule.category === target.category)) : item.entityType === target.entityType);
      setRules(matching);
      const rule = matching.find(item => item.id === target.naming?.ruleId) || matching[0];
      setRuleId(rule?.id || '');
      setSpec(target.naming?.spec || Object.fromEntries((rule?.fields || []).filter(field => field.values?.length === 1).map(field => [field.key, field.values![0]])));
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '规则加载失败'); });
    return () => { active = false; };
  }, [target]);
  useEffect(() => {
    let active = true;
    setName(''); setPreview(null);
    if (!target || !ruleId) return;
    const timer = setTimeout(() => {
      previewCatalogName({ ruleId, spec }).then(value => { if (active) { setName(value); setError(null); } })
        .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '请补齐规格'); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [target, ruleId, spec]);
  const rule = rules.find(item => item.id === ruleId);
  async function review() {
    if (!target) return;
    setBusy(true); setError(null);
    try {
      setPreview(await previewCatalogRename({ entityType: target.entityType, entityId: target.entityId, naming: { ruleId, spec }, samePhysicalItem: sameItem, expectedUpdatedAt: target.updatedAt }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '改名预览失败'); } finally { setBusy(false); }
  }
  async function save() {
    if (!preview) return;
    setBusy(true); setError(null);
    try {
      await saveCatalogRename(preview);
      await onSaved(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '名称保存失败'); } finally { setBusy(false); }
  }
  return <Dialog layer="top" open={Boolean(target)} onClose={busy ? () => {} : onClose} ariaLabel="规范名称">
    <DialogHeader><h2 className="text-lg font-semibold">按规格规范名称</h2><p className="mt-1 text-sm text-muted">当前：{target?.name || ''}。填写规格，系统自动生成新名称。</p></DialogHeader>
    <DialogBody>
      <div className="grid gap-4 sm:grid-cols-2">
        {rule?.fields.filter(field => field.values?.length !== 1).map(field => <Field key={field.key} label={`${field.label}${field.unit ? `（${field.unit}）` : ''}`} required={!field.optional}>
          {field.type === 'choice' ? <Select value={String(spec[field.key] ?? '')} onChange={event => setSpec(current => ({ ...current, [field.key]: event.target.value }))} disabled={busy}><option value="">请选择</option>{field.values?.map(value => <option key={value}>{value}</option>)}</Select>
            : <Input value={spec[field.key] ?? ''} type={field.type === 'number' ? 'number' : 'text'} onChange={event => setSpec(current => {
              const next = { ...current };
              if (field.optional && event.target.value === '') delete next[field.key];
              else next[field.key] = field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value;
              return next;
            })} disabled={busy} />}
        </Field>)}
      </div>
      <div className="mt-4 rounded-md border border-line bg-slate-50 p-3 text-sm">生成名称：{name || '请补齐规格'}</div>
      <label className="mt-4 flex items-start gap-2 text-sm"><Checkbox checked={sameItem} onChange={event => { setSameItem(event.target.checked); setPreview(null); }} disabled={busy} />确认只是整理同一实物的名称；尺寸、材质和供应商没有改变。</label>
      {preview ? <div className="mt-4 text-sm"><p>将保留 ID，续接 {preview.entries.length} 处引用。库存、采购进度和锁定金额保持原值。</p><ul className="mt-2 max-h-36 overflow-y-auto space-y-1">{preview.affectedResources?.map(item => <li key={`${item.entityType}:${item.entityId}`}>{item.label}：{item.name}（{item.referenceCount} 处）</li>)}</ul></div> : null}
      {error ? <FormError message={error} /> : null}
    </DialogBody>
    <DialogFooter><Button onClick={onClose} disabled={busy}>取消</Button>{preview ? <Button variant="primary" onClick={() => void save()} disabled={busy}>确认保存名称</Button> : <Button variant="primary" onClick={() => void review()} disabled={busy || !sameItem || !name}>检查引用与新名称</Button>}</DialogFooter>
  </Dialog>;
}
export type CatalogRenameTarget = Target;
