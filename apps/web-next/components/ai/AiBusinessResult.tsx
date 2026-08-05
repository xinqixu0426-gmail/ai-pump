'use client';

import {
  AlertCircle,
} from 'lucide-react';
import type { AiToolResult } from '@/lib/ai';
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/status-badge';
import {
  arrayValue,
  asRecord,
  ChangesList,
  DataTable,
  dateText,
  KeyValueRows,
  MetricGrid,
  money,
  pickMetrics,
  textValue,
  unwrapResult,
} from '@/components/ai/AiResultPrimitives';
import {
  FactoryExecutionPlanResult,
  FactoryWorkflowActionResult,
  ManagementActionCenterResult,
  OrderReadinessActionResult,
  OrderReadinessOverviewResult,
  OrderReadinessPlanResult,
  OrderReadinessResult,
} from '@/components/ai/AiWorkflowResults';

export function PartsResult({ name, result }: { name: string; result: Record<string, unknown> }) {
  const rows = arrayValue(result.data || result.parts);
  const part = asRecord(result.part);
  if (Object.keys(part).length > 0) {
    return (
      <>
        <KeyValueRows rows={[
          { label: '型号', value: part.model },
          { label: '类别', value: part.category },
          { label: '单价', value: money(part.price) || part.price },
          { label: '库存', value: part.stock },
          { label: '供应商', value: part.supplier },
        ]} />
        <ChangesList changes={result.changes} />
      </>
    );
  }
  return (
    <>
      <div className="mt-2 text-sm text-muted">共 {textValue(result.count ?? rows.length, '0')} 条结果</div>
      <DataTable
        rows={rows}
        columns={[
          { key: 'model', label: '型号' },
          { key: 'category', label: '类别' },
          { key: 'price', label: '单价', render: (row) => money(row.price) || textValue(row.price) },
          { key: 'stock', label: '库存' },
          { key: 'supplier', label: '供应商' },
        ]}
        emptyText={name === 'search_parts' ? '没有匹配的零件' : '暂无零件'}
      />
    </>
  );
}

export function RecipesResult({ result }: { result: Record<string, unknown> }) {
  const rows = arrayValue(result.data);
  const recipe = asRecord(result.recipe);
  if (Object.keys(recipe).length > 0 || result.recipeName) {
    return (
      <>
        <KeyValueRows rows={[
          { label: '配方', value: recipe.name || result.recipeName },
          { label: '规格', value: recipe.spec },
          { label: '零件数', value: recipe.partsCount || result.partsCount },
          { label: '成本', value: money(recipe.totalCost || result.newCost) || recipe.totalCost || result.newCost },
        ]} />
        <ChangesList changes={result.changes} />
      </>
    );
  }
  return (
    <DataTable
      rows={rows}
      columns={[
        { key: 'name', label: '配方' },
        { key: 'spec', label: '规格' },
        { key: 'savedCost', label: '保存成本', render: (row) => money(row.savedCost) || textValue(row.savedCost) },
      ]}
      emptyText="暂无配方"
    />
  );
}

export function CostResult({ result }: { result: Record<string, unknown> }) {
  const data = unwrapResult(result);
  const metrics = pickMetrics(data);
  const parts = arrayValue(data.parts || data.breakdownParts || data.items);
  return (
    <>
      <MetricGrid metrics={metrics} />
      <KeyValueRows rows={[
        { label: '配方', value: data.recipeName || data.name || data.recipeSpec },
        { label: '规格', value: data.spec },
        { label: '线圈', value: data.coilSpec || data.resolvedSpec },
        { label: '说明', value: data.message },
      ]} />
      {parts.length > 0 ? (
        <DataTable
          rows={parts}
          columns={[
            { key: 'model', label: '零件' },
            { key: 'qty', label: '数量' },
            { key: 'price', label: '单价', render: (row) => money(row.price ?? row.snapshotPrice ?? row.unitPrice) || textValue(row.price ?? row.snapshotPrice ?? row.unitPrice) },
            { key: 'cost', label: '金额', render: (row) => money(row.cost ?? row.totalCost) || textValue(row.cost ?? row.totalCost) },
          ]}
        />
      ) : null}
    </>
  );
}

export function OrderResult({ name, result }: { name: string; result: Record<string, unknown> }) {
  const order = asRecord(result.order);
  const rows = name === 'get_recent_orders' ? arrayValue(result.data) : [];
  if (rows.length > 0) {
    return (
      <DataTable
        rows={rows}
        columns={[
          { key: 'id', label: 'ID' },
          { key: 'customer', label: '客户' },
          { key: 'contract', label: '合同号' },
          { key: 'status', label: '状态' },
          { key: 'createdAt', label: '时间', render: (row) => dateText(row.createdAt) },
        ]}
      />
    );
  }

  const target = Object.keys(order).length > 0 ? order : result;
  const items = arrayValue(target.items);
  const purchaseList = arrayValue(result.purchaseList || target.purchaseList);
  return (
    <>
      <KeyValueRows rows={[
        { label: '订单 ID', value: target.id || result.orderId },
        { label: '客户', value: target.customerName || result.customerName },
        { label: '合同号', value: target.contractNo },
        { label: '状态', value: target.status || result.newStatus },
      ]} />
      <MetricGrid metrics={pickMetrics(target)} />
      <ChangesList changes={result.changes} />
      {items.length > 0 ? (
        <DataTable
          rows={items}
          columns={[
            { key: 'recipeName', label: '型号' },
            { key: 'qty', label: '数量' },
            { key: 'unitCost', label: '成本', render: (row) => money(row.unitCost) || textValue(row.unitCost) },
            { key: 'unitPrice', label: '出厂价', render: (row) => money(row.unitPrice) || textValue(row.unitPrice) },
          ]}
        />
      ) : null}
      {purchaseList.length > 0 ? (
        <DataTable
          rows={purchaseList}
          columns={[
            { key: 'model', label: '零件' },
            { key: 'supplier', label: '供应商' },
            { key: 'requiredQty', label: '需求' },
            { key: 'stock', label: '库存' },
            { key: 'needToBuy', label: '采购' },
          ]}
        />
      ) : null}
    </>
  );
}

export function CompareResult({ result }: { result: Record<string, unknown> }) {
  const recipe1 = asRecord(result.recipe1);
  const recipe2 = asRecord(result.recipe2);
  const rows = arrayValue(result.comparison);
  const differenceTone = (value: unknown): StatusBadgeTone => {
    const label = textValue(value);
    if (label.includes('仅配方1')) return 'amber';
    if (label.includes('仅配方2')) return 'blue';
    if (label.includes('型号')) return 'purple';
    if (label.includes('数量')) return 'orange';
    return 'red';
  };

  return (
    <>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {[recipe1, recipe2].map((recipe, index) => (
          <div key={index} className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-sm font-semibold text-ink">{textValue(recipe.name)}</div>
            <div className="mt-1 text-xs text-muted">{textValue(recipe.spec)}</div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted">成本</span>
              <span className="font-semibold text-ink">{money(recipe.cost) || textValue(recipe.cost)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted">零件数</span>
              <span className="font-semibold text-ink">{textValue(recipe.partsCount)}</span>
            </div>
          </div>
        ))}
      </div>
      <KeyValueRows rows={[{ label: '成本差额', value: money(result.costDiff) || result.costDiff }]} />
      <DataTable
        rows={rows}
        columns={[
          { key: 'name', label: '项目', render: (row) => textValue(row.name || row.model) },
          {
            key: 'difference',
            label: '差异',
            render: (row) => {
              const label = textValue(row.difference || row.onlyIn);
              return <StatusBadge tone={differenceTone(label)}>{label}</StatusBadge>;
            },
          },
          { key: 'model1', label: '配方1型号', render: (row) => textValue(row.model1) },
          { key: 'qty1', label: '配方1数量' },
          { key: 'amount1', label: '配方1金额', render: (row) => money(row.amount1) || textValue(row.amount1) },
          { key: 'model2', label: '配方2型号', render: (row) => textValue(row.model2) },
          { key: 'qty2', label: '配方2数量' },
          { key: 'amount2', label: '配方2金额', render: (row) => money(row.amount2) || textValue(row.amount2) },
          { key: 'diff', label: '差额', render: (row) => money(row.diff) || textValue(row.diff) },
        ]}
      />
    </>
  );
}

export function RotorResult({ result }: { result: Record<string, unknown> }) {
  const templateInfo = asRecord(result.templateInfo);
  const params = asRecord(result.params);
  const history = arrayValue(result.history);
  if (history.length > 0) {
    return (
      <DataTable
        rows={history}
        columns={[
          { key: 'jobId', label: '任务' },
          { key: 'status', label: '状态' },
          { key: 'input', label: '输入' },
          { key: 'createdAt', label: '时间', render: (row) => dateText(row.createdAt) },
        ]}
      />
    );
  }
  return (
    <>
      <KeyValueRows rows={[
        { label: '任务 ID', value: result.jobId },
        { label: '状态', value: result.message },
        { label: '模板', value: templateInfo.model },
        { label: '机筒长度', value: templateInfo.barrelLength },
        { label: '开档偏移', value: templateInfo.openOffset },
        { label: '状态接口', value: result.statusUrl },
      ]} />
      <MetricGrid metrics={pickMetrics(params)} />
    </>
  );
}

export function GenericResult({ result }: { result: Record<string, unknown> }) {
  const source = unwrapResult(result);
  const metrics = pickMetrics(source);
  const rows = arrayValue(source.data || source.items || source.summary);
  return (
    <>
      <MetricGrid metrics={metrics} />
      <KeyValueRows rows={[
        { label: '消息', value: source.message || result.message },
        { label: '名称', value: source.name || source.model },
        { label: '状态', value: source.status },
        { label: '数量', value: source.count },
      ]} />
      {rows.length > 0 ? (
        <DataTable
          rows={rows}
          columns={[
            { key: 'name', label: '名称', render: (row) => textValue(row.name || row.model || row.recipeName || row.customer || row.id) },
            { key: 'category', label: '类别' },
            { key: 'price', label: '价格', render: (row) => money(row.price ?? row.cost ?? row.totalCost) || textValue(row.price ?? row.cost ?? row.totalCost) },
            { key: 'status', label: '状态' },
          ]}
        />
      ) : null}
    </>
  );
}

export function BusinessResult({
  item,
  onSendPrompt,
  shortcutDisabled = false,
}: {
  item: AiToolResult;
  onSendPrompt?: (prompt: string) => void;
  shortcutDisabled?: boolean;
}) {
  const result = asRecord(item.result);
  if (result.success === false) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <span>{textValue(result.error, '执行失败')}</span>
      </div>
    );
  }

  if (['get_all_parts', 'search_parts', 'create_part', 'batch_create_parts', 'update_part', 'batch_update_prices'].includes(item.name)) {
    return <PartsResult name={item.name} result={result} />;
  }
  if (['get_all_recipes', 'create_recipe', 'update_recipe', 'delete_recipe'].includes(item.name)) {
    return <RecipesResult result={result} />;
  }
  if (['query_recipe_cost_by_name', 'query_recipe_cost_by_id', 'full_calculate', 'calculate_coil_cost', 'dynamic_config_cost', 'get_copper_price'].includes(item.name)) {
    return <CostResult result={result} />;
  }
  if (item.name === 'compare_recipes') return <CompareResult result={result} />;
  if (item.name === 'get_management_action_center') return <ManagementActionCenterResult result={result} />;
  if (item.name === 'plan_factory_workflow') {
    return (
      <FactoryExecutionPlanResult
        result={result}
        onRequestAction={onSendPrompt}
        actionDisabled={shortcutDisabled}
      />
    );
  }
  if (item.name === 'execute_factory_workflow_step') {
    return (
      <FactoryWorkflowActionResult
        result={result}
        onRequestAction={onSendPrompt}
        actionDisabled={shortcutDisabled}
      />
    );
  }
  if (item.name === 'get_order_readiness_overview') return <OrderReadinessOverviewResult result={result} />;
  if (item.name === 'check_order_readiness') return <OrderReadinessResult result={result} />;
  if (item.name === 'plan_order_readiness_actions') return <OrderReadinessPlanResult result={result} />;
  if (item.name === 'execute_order_readiness_action') return <OrderReadinessActionResult result={result} />;
  if (item.name.includes('order') || item.name === 'generate_purchase_list') return <OrderResult name={item.name} result={result} />;
  if (item.name.includes('rotor') || item.name.includes('drawing') || item.name.includes('print')) return <RotorResult result={result} />;
  return <GenericResult result={result} />;
}
