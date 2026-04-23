import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Collapse,
  Alert,
  alpha,
} from '@mui/material';
import { colors, gradients, sxInfoPanel, sxSuccessPanel, sxErrorPanel, sxPurplePanel, sxWarningPanel, costDiffColor } from '../../utils/theme';
import {
  ChevronDown as ExpandMoreIcon,
  ChevronUp as ExpandLessIcon,
} from 'lucide-react';

// ─── 成本明细表格 ──────────────────────────────────────
interface CostDetail {
  name: string;
  model: string;
  price: string;
  qty: number;
  subtotal: string;
  source?: string;
}

interface CostDetailsData {
  details: CostDetail[];
  totalCost: string;
  recipeName?: string;
  recipeSpec?: string;
}

function CostDetailsTable({ data }: { data: CostDetailsData }) {
  return (
    <Box sx={{ mt: 1.5 }}>
      {data.recipeName && (
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
          <Chip label={`配方: ${data.recipeName}`} size="small" color="primary" variant="outlined" />
          {data.recipeSpec && <Chip label={`规格: ${data.recipeSpec}`} size="small" variant="outlined" />}
        </Box>
      )}
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'primary.main' }}>
              <TableCell sx={{ color: 'white', fontWeight: 700, py: 1 }}>名称</TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 700, py: 1 }}>型号</TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 700, py: 1 }}>单价</TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 700, py: 1 }}>数量</TableCell>
              <TableCell align="right" sx={{ color: 'white', fontWeight: 700, py: 1 }}>小计</TableCell>
              <TableCell sx={{ color: 'white', fontWeight: 700, py: 1 }}>来源</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.details?.map((item, idx) => (
              <TableRow key={idx} sx={{ '&:nth-of-type(even)': { bgcolor: alpha('#2563eb', 0.03) } }}>
                <TableCell sx={{ py: 0.8 }}>{item.name}</TableCell>
                <TableCell sx={{ py: 0.8, color: 'text.secondary', fontSize: '0.8rem' }}>{item.model}</TableCell>
                <TableCell align="right" sx={{ py: 0.8 }}>¥{item.price}</TableCell>
                <TableCell align="right" sx={{ py: 0.8 }}>{item.qty}</TableCell>
                <TableCell align="right" sx={{ py: 0.8, fontWeight: 600 }}>¥{item.subtotal}</TableCell>
                <TableCell sx={{ py: 0.8 }}>
                  {item.source && <Chip label={item.source} size="small" sx={{ fontSize: '0.7rem', height: 20 }}
                    color={item.source === '精确匹配' ? 'success' : item.source === '未找到' ? 'error' : 'warning'} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
        <Chip
          label={`总计: ¥${data.totalCost}`}
          color="primary"
          sx={{ fontWeight: 700, fontSize: '1rem', px: 1.5, py: 2.5, borderRadius: 2 }}
        />
      </Box>
    </Box>
  );
}

// ─── 铜价卡片 ──────────────────────────────────────────
function CopperPriceCard({ data }: { data: { livePrice: number; livePricePerKg: string; dbPrice: string; lastUpdate: string } }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, mt: 1.5, flexWrap: 'wrap' }}>
      <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 160, borderRadius: 3, background: gradients.copperCard, border: 'none' }}>
        <Typography variant="caption" sx={{ color: colors.amber.text, fontWeight: 600 }}>🔴 实时铜价</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, color: colors.amber.deepText, mt: 0.5 }}>¥{data.livePricePerKg}/kg</Typography>
        <Typography variant="caption" sx={{ color: colors.amber.text }}>({data.livePrice?.toLocaleString()} 元/吨)</Typography>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 160, borderRadius: 3, background: gradients.dbCard, border: 'none' }}>
        <Typography variant="caption" sx={{ color: colors.blue.dark, fontWeight: 600 }}>📊 数据库铜价</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, color: colors.blue.deepText, mt: 0.5 }}>¥{data.dbPrice}/kg</Typography>
        {data.lastUpdate && <Typography variant="caption" sx={{ color: colors.blue.dark }}>更新: {new Date(data.lastUpdate).toLocaleString('zh-CN')}</Typography>}
      </Paper>
    </Box>
  );
}

// ─── 线圈成本卡片 ──────────────────────────────────────
function CoilCostCard({ data }: { data: { spec: string; sheets: number; totalCost: number; formula: string; source: string; wireWeight: number; copperBase: number; coilFee: number; rotorFee: number; wireGauge?: string; isCustomWireWeight?: boolean } }) {
  return (
    <Box sx={{ mt: 1.5 }}>
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, background: gradients.coilCost, border: 'none' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="caption" sx={{ color: colors.green.text, fontWeight: 600 }}>⚡ 线圈转子成本</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: colors.green.deepText }}>¥{data.totalCost?.toFixed(2)}</Typography>
          </Box>
          <Chip label={data.source} size="small" color="success" variant="outlined" />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 1.5 }}>
          {[
            { label: '规格', value: data.spec },
            { label: '片数', value: data.sheets },
            { label: '线重', value: `${data.wireWeight}kg${data.isCustomWireWeight ? ' (自定义)' : ''}` },
            { label: '铜价基数', value: `¥${data.copperBase}/kg` },
            { label: '线圈加工费', value: `¥${data.coilFee}` },
            { label: '转子加工费', value: `¥${data.rotorFee}` },
            ...(data.wireGauge ? [{ label: '线径', value: data.wireGauge }] : []),
          ].map((item, idx) => (
            <Box key={idx} sx={{ bgcolor: 'rgba(255,255,255,0.7)', p: 1, borderRadius: 1.5 }}>
              <Typography variant="caption" sx={{ color: colors.green.text, opacity: 0.8 }}>{item.label}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, color: colors.green.deepText }}>{item.value}</Typography>
            </Box>
          ))}
        </Box>
        {data.formula && (
          <Paper sx={{ mt: 1.5, p: 1.5, bgcolor: 'rgba(255,255,255,0.8)', borderRadius: 2, fontFamily: 'monospace', fontSize: '0.85rem', color: colors.green.text, border: 'none' }}>
            📐 {data.formula} = ¥{data.totalCost?.toFixed(2)}
          </Paper>
        )}
      </Paper>
    </Box>
  );
}

// ─── 一站式计算卡片 ────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FullCalculateCard({ data }: { data: { totalCost: string; recipeCost?: Record<string, any>; statorCost?: Record<string, any>; dynamicCost?: Record<string, any>; breakdown?: Record<string, string> } }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ recipe: true, stator: true, dynamic: true });
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <Box sx={{ mt: 1.5 }}>
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, background: gradients.fullCalc, border: 'none', mb: 2 }}>
        <Typography variant="caption" sx={{ color: colors.purple.text, fontWeight: 600 }}>🧮 一站式BOM综合成本</Typography>
        <Typography variant="h3" sx={{ fontWeight: 800, color: colors.purple.deepText }}>¥{data.totalCost}</Typography>
        {data.breakdown && (
          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
            <Chip label={`配方: ¥${data.breakdown.recipeCost}`} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.6)' }} />
            <Chip label={`线圈: ¥${data.breakdown.statorCost}`} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.6)' }} />
            <Chip label={`动态: ¥${data.breakdown.dynamicCost}`} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.6)' }} />
          </Box>
        )}
      </Paper>

      {data.recipeCost && !('error' in data.recipeCost) ? (
        <Box sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', mb: 0.5 }} onClick={() => toggle('recipe')}>
            {expanded.recipe ? <ExpandLessIcon size={18} /> : <ExpandMoreIcon size={18} />}
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>📋 配方成本明细</Typography>
          </Box>
          <Collapse in={expanded.recipe}>
            <CostDetailsTable data={data.recipeCost as CostDetailsData} />
          </Collapse>
        </Box>
      ) : null}

      {data.statorCost && !('error' in data.statorCost) ? (
        <Box sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', mb: 0.5 }} onClick={() => toggle('stator')}>
            {expanded.stator ? <ExpandLessIcon size={18} /> : <ExpandMoreIcon size={18} />}
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>⚡ 线圈转子成本: ¥{String(data.statorCost.cost)}</Typography>
          </Box>
          <Collapse in={expanded.stator}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography variant="body2">规格: {String(data.statorCost.spec)} | 片数: {String(data.statorCost.sheets)} | 来源: {String(data.statorCost.source)}</Typography>
              {data.statorCost.formula ? (
                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                  公式: {String(data.statorCost.formula)}
                </Typography>
              ) : null}
            </Paper>
          </Collapse>
        </Box>
      ) : null}

      {data.dynamicCost && Array.isArray(data.dynamicCost.details) && data.dynamicCost.details.length > 0 ? (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', mb: 0.5 }} onClick={() => toggle('dynamic')}>
            {expanded.dynamic ? <ExpandLessIcon size={18} /> : <ExpandMoreIcon size={18} />}
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>📦 动态配置成本: ¥{String(data.dynamicCost.totalCost)}</Typography>
          </Box>
          <Collapse in={expanded.dynamic}>
            <CostDetailsTable data={data.dynamicCost as CostDetailsData} />
          </Collapse>
        </Box>
      ) : null}
    </Box>
  );
}

// ─── 主渲染组件 ────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function StructuredResult({ toolName, result }: { toolName: string; result: any }) {
  if (!result || !result.success) {
    if (result && result.error) return <Alert severity="error" sx={{ mt: 1 }}>{result.error}</Alert>;
    return null;
  }

  // 新建零件
  if (toolName === 'create_part') {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxSuccessPanel }}>
        <Typography variant="subtitle2" color="success.dark" sx={{ fontWeight: 700, mb: 1 }}>✅ 零件录入成功 (ID: {result.id})</Typography>
        <Typography variant="body2" color="text.secondary">
          <strong>型号:</strong> {result.part['型号']} <br/>
          <strong>类别:</strong> {result.part['类别']} <br/>
          <strong>单价:</strong> ¥{result.part['单价']} <br/>
          <strong>供应商:</strong> {result.part['供应商']} <br/>
          <strong>初始库存:</strong> {result.part['库存']}
        </Typography>
      </Box>
    );
  }

  // 修改零件
  if (toolName === 'update_part') {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxSuccessPanel }}>
        <Typography variant="subtitle2" color="success.dark" sx={{ fontWeight: 700, mb: 1 }}>✅ 零件修改成功 (ID: {result.part.id})</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          <strong>型号:</strong> {result.part['型号']}
        </Typography>
        <Box sx={{ pl: 2, borderLeft: `2px solid ${colors.green.accent}` }}>
          {result.changes.map((c: string, i: number) => (
            <Typography key={i} variant="body2" sx={{ fontFamily: 'monospace', color: colors.green.text }}>
              • {c}
            </Typography>
          ))}
        </Box>
      </Box>
    );
  }

  // 新建订单
  if (toolName === 'create_order') {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxInfoPanel }}>
        <Typography variant="subtitle2" color="primary.dark" sx={{ fontWeight: 700, mb: 1 }}>✅ 订单新建成功 (ID: {result.order.id})</Typography>
        <Typography variant="body2" color="text.secondary" component="div">
          <strong>客户名称:</strong> {result.order.customerName} <br/>
          <strong>合同号:</strong> {result.order.contractNo || '-'} <br/>
          <strong>状态:</strong> <Chip label={result.order.status} size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} /> <br/>
          {result.order.remark && <><br/><strong>备注:</strong> {result.order.remark}</>}
        </Typography>
        {result.order.items && result.order.items.length > 0 && (
          <Box sx={{ mt: 1, pl: 2, borderLeft: `2px solid ${colors.blue.light}` }}>
            <Typography variant="body2" color="primary.dark" sx={{ fontWeight: 600 }}>包含产品：</Typography>
            {result.order.items.map((it: any, i: number) => (
              <Typography key={i} variant="body2" sx={{ color: colors.blue.text }}>
                • {it.recipeName} × {it.qty} （预估出厂价: ¥{it.unitPrice}）
              </Typography>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // 追加配方到订单
  if (toolName === 'add_recipe_to_order') {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxInfoPanel }}>
        <Typography variant="subtitle2" color="primary.dark" sx={{ fontWeight: 700, mb: 1 }}>✅ 已将产品入列追加至订单</Typography>
        <Typography variant="body2" color="text.secondary">
          <strong>订单 ID:</strong> {result.orderId} <br/>
          <strong>产品:</strong> {result.itemName} <br/>
          <strong>数量:</strong> {result.qty} <br/>
          <strong>核算台本:</strong> ¥{result.itemCost} <br/>
          <strong>入账单价:</strong> ¥{result.itemPrice}
        </Typography>
      </Box>
    );
  }

  // 订单详情
  if (toolName === 'get_order_detail' && result.order) {
    const o = result.order;
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxSuccessPanel }}>
        <Typography variant="subtitle2" color="success.dark" sx={{ fontWeight: 700, mb: 1 }}>📊 订单详情 (ID: {o.id})</Typography>
        <Typography variant="body2" component="div" color="text.secondary">
          <strong>客户:</strong> {o.customerName} | <strong>状态:</strong> {o.status} | <strong>备注:</strong> {o.remark || '-'}
        </Typography>
        {o.items && o.items.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>📦 配方列表 ({o.items.length}项):</Typography>
            {o.items.map((it: any, i: number) => (
              <Typography key={i} variant="body2" sx={{ pl: 1, color: colors.blue.text }}>
                • {it.recipeName} ×{it.qty} ｜成本:¥{it.unitCost} ｜出厂价:¥{it.unitPrice}
              </Typography>
            ))}
            <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>
              💰 总成本: ¥{o.totalCost} | 总加价: ¥{o.totalPrice} | 利润: ¥{o.totalProfit}
            </Typography>
          </Box>
        )}
        {o.todos && o.todos.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>📝 采购TODO:</Typography>
            {o.todos.map((t: any, i: number) => (
              <Typography key={i} variant="body2" sx={{ pl: 1, color: t.done ? colors.green.main : colors.amber.main }}>
                {t.done ? '✅' : '⬜'} {t.description}
              </Typography>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // 订单状态更新
  if (toolName === 'update_order_status' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxInfoPanel }}>
        <Typography variant="subtitle2" color="primary.dark" sx={{ fontWeight: 700 }}>✅ 订单状态已更新</Typography>
        <Typography variant="body2" color="text.secondary">
          订单 {result.orderId}({result.customerName}): {result.oldStatus} → {result.newStatus}
        </Typography>
      </Box>
    );
  }

  // 移除配方
  if (toolName === 'remove_recipe_from_order' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxErrorPanel }}>
        <Typography variant="subtitle2" color="error.dark" sx={{ fontWeight: 700 }}>✅ 已从订单移除配方</Typography>
        <Typography variant="body2" color="text.secondary">
          订单 {result.orderId}: 移除了 {result.removed} 个配方，剩余 {result.remaining} 个
        </Typography>
      </Box>
    );
  }

  // 修改订单条目
  if (toolName === 'update_order_item' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxInfoPanel }}>
        <Typography variant="subtitle2" color="primary.dark" sx={{ fontWeight: 700 }}>✅ 订单条目已更新</Typography>
        <Typography variant="body2" color="text.secondary">
          订单 {result.orderId} · {result.recipeName}
        </Typography>
        {result.changes?.map((c: string, i: number) => (
          <Typography key={i} variant="body2" sx={{ pl: 1, color: colors.green.dark }}>• {c}</Typography>
        ))}
      </Box>
    );
  }

  // 采购清单
  if (toolName === 'generate_purchase_list' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxSuccessPanel }}>
        <Typography variant="subtitle2" color="success.dark" sx={{ fontWeight: 700, mb: 1 }}>✅ 采购清单已生成</Typography>
        <Typography variant="body2" color="text.secondary">
          共 {result.summary?.totalParts} 种零件，其中 {result.summary?.needToBuy} 种需采购，涉及 {result.summary?.suppliers?.length} 个供应商
        </Typography>
        {result.todos?.map((t: any, i: number) => (
          <Typography key={i} variant="body2" sx={{ pl: 1, color: colors.blue.text, mt: 0.3 }}>📞 {t.description}</Typography>
        ))}
      </Box>
    );
  }

  // 删除订单
  if (toolName === 'delete_order' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxErrorPanel }}>
        <Typography variant="subtitle2" color="error.dark" sx={{ fontWeight: 700 }}>✅ 订单已删除</Typography>
        <Typography variant="body2" color="text.secondary">订单 {result.orderId}({result.customerName}) 已彻底删除</Typography>
      </Box>
    );
  }

  // 新建配方
  if (toolName === 'create_recipe' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxSuccessPanel }}>
        <Typography variant="subtitle2" color="success.dark" sx={{ fontWeight: 700 }}>✅ 配方创建成功</Typography>
        <Typography variant="body2" color="text.secondary">
          ID: {result.recipe?.id} | 名称: {result.recipe?.name} | 规格: {result.recipe?.spec} | 零件数: {result.recipe?.partsCount} | 成本: ¥{result.recipe?.totalCost}
        </Typography>
      </Box>
    );
  }

  // 删除配方
  if (toolName === 'delete_recipe' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxErrorPanel }}>
        <Typography variant="subtitle2" color="error.dark" sx={{ fontWeight: 700 }}>✅ 配方已删除</Typography>
        <Typography variant="body2" color="text.secondary">配方"{result.recipeName}"已删除</Typography>
      </Box>
    );
  }

  // 修改配方
  if (toolName === 'update_recipe' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxInfoPanel }}>
        <Typography variant="subtitle2" color="primary.dark" sx={{ fontWeight: 700 }}>✅ 配方已修改</Typography>
        <Typography variant="body2" color="text.secondary">
          {result.recipeName} | 零件数: {result.partsCount} | 新成本: ¥{result.newCost}
        </Typography>
        {result.changes?.map((c: string, i: number) => (
          <Typography key={i} variant="body2" sx={{ pl: 1, color: colors.green.dark }}>• {c}</Typography>
        ))}
      </Box>
    );
  }

  // 配方对比
  if (toolName === 'compare_recipes' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxPurplePanel }}>
        <Typography variant="subtitle2" color="secondary.dark" sx={{ fontWeight: 700, mb: 1 }}>🔍 配方对比结果</Typography>
        <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
          <Box sx={{ flex: 1, p: 1, bgcolor: colors.purple.bg, borderRadius: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{result.recipe1?.name}</Typography>
            <Typography variant="caption" color="text.secondary">规格: {result.recipe1?.spec} | 成本: ¥{result.recipe1?.cost} | {result.recipe1?.partsCount}个零件</Typography>
          </Box>
          <Box sx={{ flex: 1, p: 1, bgcolor: colors.purple.bg, borderRadius: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{result.recipe2?.name}</Typography>
            <Typography variant="caption" color="text.secondary">规格: {result.recipe2?.spec} | 成本: ¥{result.recipe2?.cost} | {result.recipe2?.partsCount}个零件</Typography>
          </Box>
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 600, color: costDiffColor(Number(result.costDiff)) }}>
          成本差异: ¥{result.costDiff} ({result.recipe1?.name}比{result.recipe2?.name}{Number(result.costDiff) > 0 ? '贵' : '便宜'})
        </Typography>
      </Box>
    );
  }

  // 搜索零件
  if (toolName === 'search_parts' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, bgcolor: colors.slate.bg, borderRadius: 2, border: `1px solid ${colors.slate.border}` }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>🔍 找到 {result.count} 个零件</Typography>
        {result.parts?.slice(0, 15).map((p: any, i: number) => (
          <Typography key={i} variant="body2" sx={{ color: colors.slate.text }}>
            • {p.model} | {p.category} | ¥{p.price} | {p.supplier} | 库存:{p.stock}
          </Typography>
        ))}
        {result.count > 15 && <Typography variant="caption" color="text.secondary">...还有 {result.count - 15} 个未显示</Typography>}
      </Box>
    );
  }

  // 删除零件
  if (toolName === 'delete_part' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxErrorPanel }}>
        <Typography variant="subtitle2" color="error.dark" sx={{ fontWeight: 700 }}>✅ 零件已删除</Typography>
        <Typography variant="body2" color="text.secondary">零件"{result.model}"已删除</Typography>
      </Box>
    );
  }

  // 批量调价
  if (toolName === 'batch_update_prices' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxWarningPanel }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: colors.amber.text, mb: 1 }}>✅ 批量调价完成</Typography>
        <Typography variant="body2" color="text.secondary">
          类别"{result.category}" · {result.count}个零件 · {result.changeType}
        </Typography>
        {result.details?.slice(0, 10).map((d: any, i: number) => (
          <Typography key={i} variant="body2" sx={{ pl: 1, color: colors.green.dark }}>• {d.model}: ¥{d.oldPrice} → ¥{d.newPrice}</Typography>
        ))}
        {(result.details?.length || 0) > 10 && <Typography variant="caption" color="text.secondary">...还有 {result.details.length - 10} 个未显示</Typography>}
      </Box>
    );
  }

  // 运营汇总
  if (toolName === 'get_dashboard_summary' && result.summary) {
    const s = result.summary;
    return (
      <Box sx={{ mt: 1.5, p: 2, ...sxSuccessPanel }}>
        <Typography variant="subtitle2" color="success.dark" sx={{ fontWeight: 700, mb: 1 }}>📊 运营数据汇总</Typography>
        <Typography variant="body2" component="div" color="text.secondary">
          <strong>订单:</strong> 共{s.orders?.total}个 (待采购:{s.orders?.['待采购']} / 采购中:{s.orders?.['采购中']} / 已完成:{s.orders?.['已完成']})<br/>
          <strong>配方:</strong> {s.recipes?.total}个 | <strong>零件:</strong> {s.parts?.total}个<br/>
          <strong>统计:</strong> 总成本 ¥{s.financials?.totalCost} | 总营收 ¥{s.financials?.totalRevenue} | 总利润 ¥{s.financials?.totalProfit}
        </Typography>
      </Box>
    );
  }

  // 通用成功/失败卡片
  if (result.success !== undefined && !result.data) {
    return (
      <Box sx={{ mt: 1.5, p: 2, ...(result.success ? sxSuccessPanel : sxErrorPanel) }}>
        <Typography variant="subtitle2" color={result.success ? 'success.dark' : 'error.dark'} sx={{ fontWeight: 700 }}>
          {result.success ? '✅' : '❌'} {result.message || result.error}
        </Typography>
        {result.changes && result.changes.map((c: string, i: number) => (
          <Typography key={i} variant="body2" sx={{ pl: 1, color: '#059669' }}>• {c}</Typography>
        ))}
      </Box>
    );
  }

  if (!result.data) return null;
  const data = result.data;

  // 配方成本
  if ((toolName === 'query_recipe_cost_by_name' || toolName === 'query_recipe_cost_by_id') && data.details) {
    return <CostDetailsTable data={data as CostDetailsData} />;
  }

  // 铜价
  if (toolName === 'get_copper_price' && data.livePrice !== undefined) {
    return <CopperPriceCard data={data} />;
  }

  // 线圈成本
  if (toolName === 'calculate_coil_cost' && data.totalCost !== undefined && data.formula) {
    return <CoilCostCard data={data} />;
  }

  // 一站式计算
  if (toolName === 'full_calculate' && data.totalCost !== undefined && data.breakdown) {
    return <FullCalculateCard data={data} />;
  }

  // 线圈规格列表
  if (toolName === 'get_coil_specs' && Array.isArray(data)) {
    return (
      <Box sx={{ mt: 1.5 }}>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'secondary.main' }}>
                <TableCell sx={{ color: 'white', fontWeight: 700 }}>规格</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 700 }}>单价</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 700 }}>可用片数</TableCell>
                <TableCell align="right" sx={{ color: 'white', fontWeight: 700 }}>记录数</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data as Array<{ spec: string; unitPrice: string; sheets: number[]; count: number }>).map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell sx={{ fontWeight: 600 }}>{item.spec}</TableCell>
                  <TableCell>¥{item.unitPrice}</TableCell>
                  <TableCell>{item.sheets?.join(', ')}</TableCell>
                  <TableCell align="right">{item.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  }

  // 最近订单列表
  if (toolName === 'get_recent_orders' && Array.isArray(data)) {
    return (
      <Box sx={{ mt: 1.5 }}>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'primary.main' }}>
                <TableCell sx={{ color: 'white', fontWeight: 700 }}>ID</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 700 }}>客户名称</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 700 }}>合同号</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 700 }}>状态</TableCell>
                <TableCell align="right" sx={{ color: 'white', fontWeight: 700 }}>创建时间</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data as Array<{ id: number; customer: string; contract: string; status: string; createdAt: string }>).map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{item.customer}</TableCell>
                  <TableCell>{item.contract}</TableCell>
                  <TableCell>
                    <Chip
                      label={item.status}
                      size="small"
                      color={item.status === '已完成' ? 'success' : item.status === '待生产' ? 'warning' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  }

  // 配方列表
  if (toolName === 'get_all_recipes' && Array.isArray(data)) {
    return (
      <Box sx={{ mt: 1.5 }}>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'primary.main' }}>
                <TableCell sx={{ color: 'white', fontWeight: 700 }}>ID</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 700 }}>配方名称</TableCell>
                <TableCell sx={{ color: 'white', fontWeight: 700 }}>规格</TableCell>
                <TableCell align="right" sx={{ color: 'white', fontWeight: 700 }}>保存时成本</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data as Array<{ id: number; name: string; spec: string; savedCost: number }>).map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{item.name}</TableCell>
                  <TableCell>{item.spec}</TableCell>
                  <TableCell align="right">{item.savedCost ? `¥${parseFloat(String(item.savedCost)).toFixed(2)}` : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  }

  // 零件列表
  if (toolName === 'get_all_parts' && Array.isArray(data)) {
    return (
      <Box sx={{ mt: 1.5, maxHeight: 400, overflow: 'auto' }}>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, bgcolor: colors.slate.light }}>型号</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: colors.slate.light }}>类别</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, bgcolor: colors.slate.light }}>单价</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: colors.slate.light }}>供应商</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, bgcolor: colors.slate.light }}>库存</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data as Array<{ model: string; category: string; price: number; supplier: string; stock: number }>).map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell sx={{ fontWeight: 600 }}>{item.model}</TableCell>
                  <TableCell><Chip label={item.category} size="small" sx={{ fontSize: '0.7rem', height: 20 }} /></TableCell>
                  <TableCell align="right">¥{parseFloat(String(item.price)).toFixed(2)}</TableCell>
                  <TableCell>{item.supplier}</TableCell>
                  <TableCell align="right">
                    <Chip
                      label={item.stock}
                      size="small"
                      color={Number(item.stock) <= 5 ? 'error' : Number(item.stock) <= 20 ? 'warning' : 'success'}
                      sx={{ fontSize: '0.75rem', height: 22, minWidth: 40 }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  }

  // 动态配置成本
  if (toolName === 'dynamic_config_cost' && data.details) {
    return <CostDetailsTable data={data as CostDetailsData} />;
  }

  return null;
}
