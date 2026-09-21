'use client';

import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Recipe, RecipePart } from '@/lib/recipes';
import { money } from '@/lib/format';
import { recipeFeeRows, recipePartModel } from './recipe-detail-presentation';

type PrintGroup = {
  category: string;
  rows: { part: RecipePart; qty: number; snapshotPrice: number | null; savedSubtotal: number | null }[];
};

export function RecipePrintSheet({ recipe, templateName, groups, savedTotal, barrelLength, technicalEntries }: {
  recipe: Recipe;
  templateName: string;
  groups: PrintGroup[];
  savedTotal: number | null;
  barrelLength: number | null;
  technicalEntries: { id: string; label?: string; value?: string; unit?: string }[];
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = (recipe.name || '未命名配方').replace(/[\\/:*?"<>|]/g, '-');
    return () => { document.title = previousTitle; };
  }, [recipe.name]);
  if (!mounted) return null;
  return createPortal(
    <article className="recipe-print-sheet" aria-hidden="true">
      <header className="print-header"><h1>{recipe.name || '未命名配方'}</h1>
      <p>{recipe.externalModel ? `对外型号：${recipe.externalModel} · ` : ''}规格：{recipe.spec || '-'} · 模板：{templateName || '-'}</p>
      <p>保存时间：{recipe.updatedAt || recipe.createdAt || '未记录'} · 金额口径：保存快照（元 / 台）</p>
      </header>
      <div className="print-overview">
        <div><span>保存成本</span><strong>{savedTotal != null ? money(savedTotal) : '未记录'}</strong></div>
        <div><span>BOM 项数</span><strong>{groups.reduce((count, group) => count + group.rows.length, 0)}</strong></div>
        <div><span>泵壳模板</span><strong>{templateName || '-'}</strong></div>
      </div>
      <section className="print-panel">
      <h2>BOM 快照</h2>
      <table className="print-bom">
        <colgroup><col style={{ width: '19%' }} /><col style={{ width: '33%' }} /><col style={{ width: '20%' }} /><col style={{ width: '8%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /></colgroup>
        <thead><tr><th>名称</th><th>型号 / 参数</th><th>供应商</th><th>数量</th><th>快照单价</th><th>快照小计</th></tr></thead>
        <tbody>
          {groups.map(group => <Fragment key={group.category}>
            {!group.category.startsWith('single-') ? <tr className="print-group"><th colSpan={6}>{group.category}</th></tr> : null}
            {group.rows.map((row, index) => <tr key={`${group.category}-${index}`}>
              <td className={group.category.startsWith('single-') ? '' : 'print-indent'}>{row.part.name || row.part.model}</td>
              <td>{recipePartModel(row.part, recipe)}</td><td>{row.part.supplier || '-'}</td>
              <td>{row.part.cableAssembly ? `1根 / ${row.part.cableLength || row.part.inventoryQty || 0}m` : row.qty}</td>
              <td>{row.snapshotPrice != null ? money(row.snapshotPrice) : '未记录'}</td>
              <td>{row.savedSubtotal != null ? money(row.savedSubtotal) : '未记录'}</td>
            </tr>)}
          </Fragment>)}
          {groups.length === 0 ? <tr><td colSpan={6}>暂无 BOM 快照</td></tr> : null}
        </tbody>
      </table>
      <div className="print-fees">
      <h2>人工、表面处理与管理费用</h2>
      <div className="print-fee-grid">
        {recipeFeeRows(recipe).map(fee => <div key={fee.name}><span>{fee.name}{fee.process ? ` · ${fee.process}` : ''}</span><strong>{fee.amount != null ? money(fee.amount) : '未记录'}</strong></div>)}
      </div>
      <p className="print-total">保存完整成本：{savedTotal != null ? money(savedTotal) : '未记录'} / 台</p>
      </div></section>
      <section className="print-panel print-key-parameters">
      <h2>关键参数</h2>
      <div className="print-parameters">
        <div>机筒长度：{barrelLength != null ? `${barrelLength} mm` : '未记录'}</div>
        <div>叶轮：{[recipe.impellerModel, recipe.impellerThickness ? `${recipe.impellerThickness}厚` : '', recipe.impellerDiameter ? `直径${recipe.impellerDiameter}` : '', recipe.impellerBladeCount ? `${recipe.impellerBladeCount}片` : ''].filter(Boolean).join(' / ') || '-'}</div>
        <div>浮球：{recipe.hasFloat ? recipe.floatWire || '已启用' : '未启用'}</div>
        <div>电缆：{recipe.hasCable ? `${recipe.cableWire || '-'} / ${recipe.cableLength || 0}m` : '未启用'}</div>
        {technicalEntries.map(entry => <div key={entry.id}>{entry.label}：{entry.value || '-'} {entry.unit || ''}</div>)}
      </div>
      </section>
    </article>, document.body
  );
}
