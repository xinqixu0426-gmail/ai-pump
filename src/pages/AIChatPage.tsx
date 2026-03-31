import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  IconButton,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Fade,
  Collapse,
  Tooltip,
  alpha,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert
} from '@mui/material';
import {
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  AutoAwesome as SparkleIcon,
  Psychology as ThinkIcon,
  Api as ApiIcon,
  DataObject as DataIcon,
  CheckCircle as DoneIcon,
  Error as ErrorIcon,
  Delete as DeleteIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';

// ─── Types ────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  status?: 'thinking' | 'calling_api' | 'formatting' | 'done' | 'error';
  statusMessage?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  toolResults?: Array<{ name: string; result: unknown }>;
}

// ─── 结构化结果渲染组件 ──────────────────────────────
function CostDetailsTable({ data }: { data: { details: Array<{ name: string; model: string; price: string; qty: number; subtotal: string; source?: string }>, totalCost: string, recipeName?: string, recipeSpec?: string } }) {
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

function CopperPriceCard({ data }: { data: { livePrice: number; livePricePerKg: string; dbPrice: string; lastUpdate: string } }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, mt: 1.5, flexWrap: 'wrap' }}>
      <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 160, borderRadius: 3, background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', border: 'none' }}>
        <Typography variant="caption" sx={{ color: '#92400e', fontWeight: 600 }}>🔴 实时铜价</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, color: '#78350f', mt: 0.5 }}>¥{data.livePricePerKg}/kg</Typography>
        <Typography variant="caption" sx={{ color: '#92400e' }}>({data.livePrice?.toLocaleString()} 元/吨)</Typography>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 160, borderRadius: 3, background: 'linear-gradient(135deg, #dbeafe 0%, #93c5fd 100%)', border: 'none' }}>
        <Typography variant="caption" sx={{ color: '#1e40af', fontWeight: 600 }}>📊 数据库铜价</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, color: '#1e3a8a', mt: 0.5 }}>¥{data.dbPrice}/kg</Typography>
        {data.lastUpdate && <Typography variant="caption" sx={{ color: '#1e40af' }}>更新: {new Date(data.lastUpdate).toLocaleString('zh-CN')}</Typography>}
      </Paper>
    </Box>
  );
}

function CoilCostCard({ data }: { data: { spec: string; sheets: number; totalCost: number; formula: string; source: string; wireWeight: number; copperBase: number; coilFee: number; rotorFee: number; wireGauge?: string; isCustomWireWeight?: boolean } }) {
  return (
    <Box sx={{ mt: 1.5 }}>
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, background: 'linear-gradient(135deg, #f0fdf4 0%, #bbf7d0 100%)', border: 'none' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="caption" sx={{ color: '#166534', fontWeight: 600 }}>⚡ 线圈转子成本</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#14532d' }}>¥{data.totalCost?.toFixed(2)}</Typography>
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
              <Typography variant="caption" sx={{ color: '#166534', opacity: 0.8 }}>{item.label}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, color: '#14532d' }}>{item.value}</Typography>
            </Box>
          ))}
        </Box>
        {data.formula && (
          <Paper sx={{ mt: 1.5, p: 1.5, bgcolor: 'rgba(255,255,255,0.8)', borderRadius: 2, fontFamily: 'monospace', fontSize: '0.85rem', color: '#166534', border: 'none' }}>
            📐 {data.formula} = ¥{data.totalCost?.toFixed(2)}
          </Paper>
        )}
      </Paper>
    </Box>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FullCalculateCard({ data }: { data: { totalCost: string; recipeCost?: Record<string, any>; statorCost?: Record<string, any>; dynamicCost?: Record<string, any>; breakdown?: Record<string, string> } }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ recipe: true, stator: true, dynamic: true });
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <Box sx={{ mt: 1.5 }}>
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, background: 'linear-gradient(135deg, #ede9fe 0%, #c4b5fd 100%)', border: 'none', mb: 2 }}>
        <Typography variant="caption" sx={{ color: '#5b21b6', fontWeight: 600 }}>🧮 一站式BOM综合成本</Typography>
        <Typography variant="h3" sx={{ fontWeight: 800, color: '#3b0764' }}>¥{data.totalCost}</Typography>
        {data.breakdown && (
          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
            <Chip label={`配方: ¥${data.breakdown.recipeCost}`} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.6)' }} />
            <Chip label={`线圈: ¥${data.breakdown.statorCost}`} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.6)' }} />
            <Chip label={`动态: ¥${data.breakdown.dynamicCost}`} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.6)' }} />
          </Box>
        )}
      </Paper>

      {/* 配方成本明细 */}
      {data.recipeCost && !('error' in data.recipeCost) ? (
        <Box sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', mb: 0.5 }} onClick={() => toggle('recipe')}>
            {expanded.recipe ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>📋 配方成本明细</Typography>
          </Box>
          <Collapse in={expanded.recipe}>
            <CostDetailsTable data={data.recipeCost as Parameters<typeof CostDetailsTable>[0]['data']} />
          </Collapse>
        </Box>
      ) : null}

      {/* 线圈成本 */}
      {data.statorCost && !('error' in data.statorCost) ? (
        <Box sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', mb: 0.5 }} onClick={() => toggle('stator')}>
            {expanded.stator ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
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

      {/* 动态配置成本 */}
      {data.dynamicCost && Array.isArray(data.dynamicCost.details) && data.dynamicCost.details.length > 0 ? (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', mb: 0.5 }} onClick={() => toggle('dynamic')}>
            {expanded.dynamic ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>📦 动态配置成本: ¥{String(data.dynamicCost.totalCost)}</Typography>
          </Box>
          <Collapse in={expanded.dynamic}>
            <CostDetailsTable data={data.dynamicCost as Parameters<typeof CostDetailsTable>[0]['data']} />
          </Collapse>
        </Box>
      ) : null}
    </Box>
  );
}

// ─── 结构化结果判断和渲染 ──────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StructuredResult({ toolName, result }: { toolName: string; result: any }) {
  if (!result || !result.success) {
    if (result && result.error) return <Alert severity="error" sx={{ mt: 1 }}>{result.error}</Alert>;
    return null;
  }

  // 新建零件
  if (toolName === 'create_part') {
    return (
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#f0fdf4', borderRadius: 2, border: '1px solid #bbf7d0' }}>
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
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#f0fdf4', borderRadius: 2, border: '1px solid #bbf7d0' }}>
        <Typography variant="subtitle2" color="success.dark" sx={{ fontWeight: 700, mb: 1 }}>✅ 零件修改成功 (ID: {result.part.id})</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          <strong>型号:</strong> {result.part['型号']}
        </Typography>
        <Box sx={{ pl: 2, borderLeft: '2px solid #4ade80' }}>
          {result.changes.map((c: string, i: number) => (
            <Typography key={i} variant="body2" sx={{ fontFamily: 'monospace', color: '#166534' }}>
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
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#eff6ff', borderRadius: 2, border: '1px solid #bfdbfe' }}>
        <Typography variant="subtitle2" color="primary.dark" sx={{ fontWeight: 700, mb: 1 }}>✅ 订单新建成功 (ID: {result.order.id})</Typography>
        <Typography variant="body2" color="text.secondary" component="div">
          <strong>客户名称:</strong> {result.order.customerName} <br/>
          <strong>合同号:</strong> {result.order.contractNo || '-'} <br/>
          <strong>状态:</strong> <Chip label={result.order.status} size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} /> <br/>
          {result.order.remark && <><br/><strong>备注:</strong> {result.order.remark}</>}
        </Typography>
        {result.order.items && result.order.items.length > 0 && (
          <Box sx={{ mt: 1, pl: 2, borderLeft: '2px solid #60a5fa' }}>
            <Typography variant="body2" color="primary.dark" sx={{ fontWeight: 600 }}>包含产品：</Typography>
            {result.order.items.map((it: any, i: number) => (
              <Typography key={i} variant="body2" sx={{ color: '#1d4ed8' }}>
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
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#eff6ff', borderRadius: 2, border: '1px solid #bfdbfe' }}>
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
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#f0fdf4', borderRadius: 2, border: '1px solid #86efac' }}>
        <Typography variant="subtitle2" color="success.dark" sx={{ fontWeight: 700, mb: 1 }}>📊 订单详情 (ID: {o.id})</Typography>
        <Typography variant="body2" component="div" color="text.secondary">
          <strong>客户:</strong> {o.customerName} | <strong>状态:</strong> {o.status} | <strong>备注:</strong> {o.remark || '-'}
        </Typography>
        {o.items && o.items.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>📦 配方列表 ({o.items.length}项):</Typography>
            {o.items.map((it: any, i: number) => (
              <Typography key={i} variant="body2" sx={{ pl: 1, color: '#1d4ed8' }}>
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
              <Typography key={i} variant="body2" sx={{ pl: 1, color: t.done ? '#10b981' : '#f59e0b' }}>
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
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#eff6ff', borderRadius: 2, border: '1px solid #bfdbfe' }}>
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
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#fef2f2', borderRadius: 2, border: '1px solid #fecaca' }}>
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
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#eff6ff', borderRadius: 2, border: '1px solid #bfdbfe' }}>
        <Typography variant="subtitle2" color="primary.dark" sx={{ fontWeight: 700 }}>✅ 订单条目已更新</Typography>
        <Typography variant="body2" color="text.secondary">
          订单 {result.orderId} · {result.recipeName}
        </Typography>
        {result.changes?.map((c: string, i: number) => (
          <Typography key={i} variant="body2" sx={{ pl: 1, color: '#059669' }}>• {c}</Typography>
        ))}
      </Box>
    );
  }

  // 采购清单
  if (toolName === 'generate_purchase_list' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#f0fdf4', borderRadius: 2, border: '1px solid #86efac' }}>
        <Typography variant="subtitle2" color="success.dark" sx={{ fontWeight: 700, mb: 1 }}>✅ 采购清单已生成</Typography>
        <Typography variant="body2" color="text.secondary">
          共 {result.summary?.totalParts} 种零件，其中 {result.summary?.needToBuy} 种需采购，涉及 {result.summary?.suppliers?.length} 个供应商
        </Typography>
        {result.todos?.map((t: any, i: number) => (
          <Typography key={i} variant="body2" sx={{ pl: 1, color: '#1d4ed8', mt: 0.3 }}>📞 {t.description}</Typography>
        ))}
      </Box>
    );
  }

  // 删除订单
  if (toolName === 'delete_order' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#fef2f2', borderRadius: 2, border: '1px solid #fecaca' }}>
        <Typography variant="subtitle2" color="error.dark" sx={{ fontWeight: 700 }}>✅ 订单已删除</Typography>
        <Typography variant="body2" color="text.secondary">订单 {result.orderId}({result.customerName}) 已彻底删除</Typography>
      </Box>
    );
  }

  // 新建配方
  if (toolName === 'create_recipe' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#f0fdf4', borderRadius: 2, border: '1px solid #86efac' }}>
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
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#fef2f2', borderRadius: 2, border: '1px solid #fecaca' }}>
        <Typography variant="subtitle2" color="error.dark" sx={{ fontWeight: 700 }}>✅ 配方已删除</Typography>
        <Typography variant="body2" color="text.secondary">配方"{result.recipeName}"已删除</Typography>
      </Box>
    );
  }

  // 修改配方
  if (toolName === 'update_recipe' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#eff6ff', borderRadius: 2, border: '1px solid #bfdbfe' }}>
        <Typography variant="subtitle2" color="primary.dark" sx={{ fontWeight: 700 }}>✅ 配方已修改</Typography>
        <Typography variant="body2" color="text.secondary">
          {result.recipeName} | 零件数: {result.partsCount} | 新成本: ¥{result.newCost}
        </Typography>
        {result.changes?.map((c: string, i: number) => (
          <Typography key={i} variant="body2" sx={{ pl: 1, color: '#059669' }}>• {c}</Typography>
        ))}
      </Box>
    );
  }

  // 配方对比
  if (toolName === 'compare_recipes' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#faf5ff', borderRadius: 2, border: '1px solid #d8b4fe' }}>
        <Typography variant="subtitle2" color="secondary.dark" sx={{ fontWeight: 700, mb: 1 }}>🔍 配方对比结果</Typography>
        <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
          <Box sx={{ flex: 1, p: 1, bgcolor: '#f5f3ff', borderRadius: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{result.recipe1?.name}</Typography>
            <Typography variant="caption" color="text.secondary">规格: {result.recipe1?.spec} | 成本: ¥{result.recipe1?.cost} | {result.recipe1?.partsCount}个零件</Typography>
          </Box>
          <Box sx={{ flex: 1, p: 1, bgcolor: '#f5f3ff', borderRadius: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{result.recipe2?.name}</Typography>
            <Typography variant="caption" color="text.secondary">规格: {result.recipe2?.spec} | 成本: ¥{result.recipe2?.cost} | {result.recipe2?.partsCount}个零件</Typography>
          </Box>
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 600, color: Number(result.costDiff) > 0 ? '#dc2626' : '#059669' }}>
          成本差异: ¥{result.costDiff} ({result.recipe1?.name}比{result.recipe2?.name}{Number(result.costDiff) > 0 ? '贵' : '便宜'})
        </Typography>
      </Box>
    );
  }

  // 搜索零件
  if (toolName === 'search_parts' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>🔍 找到 {result.count} 个零件</Typography>
        {result.parts?.slice(0, 15).map((p: any, i: number) => (
          <Typography key={i} variant="body2" sx={{ color: '#475569' }}>
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
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#fef2f2', borderRadius: 2, border: '1px solid #fecaca' }}>
        <Typography variant="subtitle2" color="error.dark" sx={{ fontWeight: 700 }}>✅ 零件已删除</Typography>
        <Typography variant="body2" color="text.secondary">零件"{result.model}"已删除</Typography>
      </Box>
    );
  }

  // 批量调价
  if (toolName === 'batch_update_prices' && result.success) {
    return (
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#fffbeb', borderRadius: 2, border: '1px solid #fde68a' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#92400e', mb: 1 }}>✅ 批量调价完成</Typography>
        <Typography variant="body2" color="text.secondary">
          类别"{result.category}" · {result.count}个零件 · {result.changeType}
        </Typography>
        {result.details?.slice(0, 10).map((d: any, i: number) => (
          <Typography key={i} variant="body2" sx={{ pl: 1, color: '#059669' }}>• {d.model}: ¥{d.oldPrice} → ¥{d.newPrice}</Typography>
        ))}
        {(result.details?.length || 0) > 10 && <Typography variant="caption" color="text.secondary">...还有 {result.details.length - 10} 个未显示</Typography>}
      </Box>
    );
  }

  // 运营汇总
  if (toolName === 'get_dashboard_summary' && result.summary) {
    const s = result.summary;
    return (
      <Box sx={{ mt: 1.5, p: 2, bgcolor: '#f0fdf4', borderRadius: 2, border: '1px solid #86efac' }}>
        <Typography variant="subtitle2" color="success.dark" sx={{ fontWeight: 700, mb: 1 }}>📊 运营数据汇总</Typography>
        <Typography variant="body2" component="div" color="text.secondary">
          <strong>订单:</strong> 共{s.orders?.total}个 (待采购:{s.orders?.['待采购']} / 采购中:{s.orders?.['采购中']} / 已完成:{s.orders?.['已完成']})<br/>
          <strong>配方:</strong> {s.recipes?.total}个 | <strong>零件:</strong> {s.parts?.total}个<br/>
          <strong>统计:</strong> 总成本 ¥{s.financials?.totalCost} | 总营收 ¥{s.financials?.totalRevenue} | 总利润 ¥{s.financials?.totalProfit}
        </Typography>
      </Box>
    );
  }

  // 通用成功/失败卡片（兼容未单独处理的工具）
  if (result.success !== undefined && !result.data) {
    return (
      <Box sx={{ mt: 1.5, p: 2, bgcolor: result.success ? '#f0fdf4' : '#fef2f2', borderRadius: 2, border: `1px solid ${result.success ? '#86efac' : '#fecaca'}` }}>
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
    return <CostDetailsTable data={data as unknown as Parameters<typeof CostDetailsTable>[0]['data']} />;
  }

  // 铜价
  if (toolName === 'get_copper_price' && data.livePrice !== undefined) {
    return <CopperPriceCard data={data as unknown as Parameters<typeof CopperPriceCard>[0]['data']} />;
  }

  // 线圈成本
  if (toolName === 'calculate_coil_cost' && data.totalCost !== undefined && data.formula) {
    return <CoilCostCard data={data as unknown as Parameters<typeof CoilCostCard>[0]['data']} />;
  }

  // 一站式计算
  if (toolName === 'full_calculate' && data.totalCost !== undefined && data.breakdown) {
    return <FullCalculateCard data={data as unknown as Parameters<typeof FullCalculateCard>[0]['data']} />;
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
                <TableCell sx={{ fontWeight: 700, bgcolor: '#f1f5f9' }}>型号</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#f1f5f9' }}>类别</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#f1f5f9' }}>单价</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#f1f5f9' }}>供应商</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#f1f5f9' }}>库存</TableCell>
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
    return <CostDetailsTable data={data as unknown as Parameters<typeof CostDetailsTable>[0]['data']} />;
  }

  return null;
}

// ─── AI 状态动画组件 ──────────────────────────────────
function StatusIndicator({ status, message }: { status: string; message: string }) {
  const config: Record<string, { icon: React.ReactNode; color: string; animate: boolean }> = {
    thinking: { icon: <ThinkIcon fontSize="small" />, color: '#7c3aed', animate: true },
    calling_api: { icon: <ApiIcon fontSize="small" />, color: '#2563eb', animate: true },
    formatting: { icon: <DataIcon fontSize="small" />, color: '#059669', animate: true },
    done: { icon: <DoneIcon fontSize="small" />, color: '#059669', animate: false },
    error: { icon: <ErrorIcon fontSize="small" />, color: '#dc2626', animate: false },
  };
  const c = config[status] || config.thinking;

  return (
    <Fade in>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 0.5,
        px: 1.5,
        borderRadius: 2,
        bgcolor: alpha(c.color, 0.08),
        color: c.color,
        mb: 1,
        ...(c.animate ? {
          animation: 'pulse 1.5s ease-in-out infinite',
          '@keyframes pulse': {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0.5 },
          }
        } : {})
      }}>
        {c.animate ? <CircularProgress size={16} sx={{ color: c.color }} /> : c.icon}
        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>
          {message}
        </Typography>
      </Box>
    </Fade>
  );
}

// ─── 示例问题 ─────────────────────────────────────────
const EXAMPLE_QUESTIONS = [
  { text: 'V750的成本是多少？', icon: '💰' },
  { text: '当前铜价是多少？', icon: '🔴' },
  { text: '12规格200片线圈成本', icon: '⚡' },
  { text: '系统运营数据汇总', icon: '📊' },
  { text: '帮我新建一个台州李总的订单，加2台V750(1.5寸)', icon: '📝' },
  { text: '看看订单5的详情', icon: '🔍' },
  { text: '生成订单5的采购清单', icon: '🛠' },
  { text: '对比一下V750和V550的成本差异', icon: '🧩' },
];

// ─── 主页面组件 ───────────────────────────────────────
export default function AIChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 加载 system prompt
  const loadSystemPrompt = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/system-prompt');
      const json = await res.json();
      if (json.success) setSystemPrompt(json.data);
    } catch { /* ignore */ }
  }, []);

  const handleOpenSettings = () => {
    loadSystemPrompt();
    setPromptSaved(false);
    setSettingsOpen(true);
  };

  const handleSavePrompt = async () => {
    setPromptLoading(true);
    try {
      const res = await fetch('/api/ai/system-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: systemPrompt }),
      });
      const json = await res.json();
      if (json.success) {
        setPromptSaved(true);
        setTimeout(() => setPromptSaved(false), 2000);
      }
    } catch { /* ignore */ }
    setPromptLoading(false);
  };

  const handleSend = async (text?: string) => {
    const userMessage = text || input.trim();
    if (!userMessage || isLoading) return;

    setInput('');
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };

    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      status: 'thinking',
      statusMessage: '正在理解您的问题...',
      toolCalls: [],
      toolResults: [],
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);

    // 构造发送给后端的消息历史
    const apiMessages = [...messages, userMsg]
      .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
      .map(m => ({ role: m.role, content: m.content }));

    try {
      abortControllerRef.current = new AbortController();
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
        signal: abortControllerRef.current.signal,
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('无法读取响应流');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            setMessages(prev => {
              const updated = [...prev];
              const lastAssistant = updated[updated.length - 1];
              if (!lastAssistant || lastAssistant.role !== 'assistant') return prev;

              const newAssistant = { ...lastAssistant };
              updated[updated.length - 1] = newAssistant;

              switch (event.type) {
                case 'status':
                  newAssistant.status = event.status;
                  newAssistant.statusMessage = event.message;
                  break;
                case 'tool_call':
                  newAssistant.toolCalls = [
                    ...(newAssistant.toolCalls || []),
                    { name: event.name, args: event.args }
                  ];
                  break;
                case 'tool_result':
                  newAssistant.toolResults = [
                    ...(newAssistant.toolResults || []),
                    { name: event.name, result: event.result }
                  ];
                  break;
                case 'content':
                  newAssistant.content = event.content;
                  newAssistant.status = 'done';
                  newAssistant.statusMessage = '';
                  break;
                case 'done':
                  newAssistant.status = 'done';
                  break;
                case 'error':
                  newAssistant.status = 'error';
                  newAssistant.statusMessage = event.message;
                  newAssistant.content = `❌ ${event.message}`;
                  break;
              }
              return updated;
            });
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant') {
          last.status = 'error';
          last.content = `❌ 请求失败: ${(err as Error).message}`;
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleClear = () => {
    if (isLoading && abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setIsLoading(false);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', maxWidth: 900, mx: 'auto' }}>
      {/* 消息区域 */}
      <Box sx={{ flex: 1, overflow: 'auto', pb: 2, px: 1 }}>
        {messages.length === 0 ? (
          // 欢迎界面
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 3 }}>
            <Box sx={{
              width: 80, height: 80, borderRadius: '50%',
              background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #06b6d4 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 32px rgba(124, 58, 237, 0.3)',
              animation: 'float 3s ease-in-out infinite',
              '@keyframes float': {
                '0%, 100%': { transform: 'translateY(0px)' },
                '50%': { transform: 'translateY(-10px)' },
              }
            }}>
              <SparkleIcon sx={{ fontSize: 40, color: 'white' }} />
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h5" sx={{ fontWeight: 800, mb: 0.5, background: 'linear-gradient(135deg, #7c3aed, #2563eb)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                BOM 智能助手
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                用自然语言查询成本、配方、铜价和线圈数据
              </Typography>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 1.5, width: '100%', maxWidth: 700, mt: 1 }}>
              {EXAMPLE_QUESTIONS.map((q, idx) => (
                <Paper
                  key={idx}
                  variant="outlined"
                  sx={{
                    p: 2, cursor: 'pointer', borderRadius: 3,
                    transition: 'all 0.2s',
                    '&:hover': {
                      borderColor: 'primary.main',
                      bgcolor: alpha('#2563eb', 0.04),
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 12px rgba(37, 99, 235, 0.1)',
                    }
                  }}
                  onClick={() => handleSend(q.text)}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <span>{q.icon}</span> {q.text}
                  </Typography>
                </Paper>
              ))}
            </Box>
          </Box>
        ) : (
          // 消息列表
          messages.map((msg) => (
            <Fade in key={msg.id}>
              <Box sx={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                mb: 2,
                gap: 1.5,
              }}>
                {msg.role === 'assistant' && (
                  <Box sx={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #7c3aed, #2563eb)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    mt: 0.5,
                  }}>
                    <BotIcon sx={{ fontSize: 20, color: 'white' }} />
                  </Box>
                )}

                <Box sx={{
                  maxWidth: '80%',
                  ...(msg.role === 'user' ? {
                    bgcolor: 'primary.main',
                    color: 'white',
                    borderRadius: '20px 20px 4px 20px',
                    px: 2.5, py: 1.5,
                    boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)',
                  } : {
                    bgcolor: 'background.paper',
                    borderRadius: '4px 20px 20px 20px',
                    px: 2.5, py: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                    minWidth: 200,
                  })
                }}>
                  {msg.role === 'assistant' && msg.status && msg.status !== 'done' && (
                    <StatusIndicator status={msg.status} message={msg.statusMessage || ''} />
                  )}

                  {/* Tool Results — 结构化展示 */}
                  {msg.role === 'assistant' && msg.toolResults && msg.toolResults.length > 0 && (
                    <Box>
                      {msg.toolResults.map((tr, idx) => (
                        <StructuredResult key={idx} toolName={tr.name} result={tr.result as Parameters<typeof StructuredResult>[0]['result']} />
                      ))}
                    </Box>
                  )}

                  {/* 文本内容 */}
                  {msg.content && (
                    <Typography
                      variant="body1"
                      sx={{
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.7,
                        '& strong': { fontWeight: 700 },
                        mt: msg.toolResults && msg.toolResults.length > 0 ? 1.5 : 0,
                      }}
                    >
                      {msg.content}
                    </Typography>
                  )}
                </Box>

                {msg.role === 'user' && (
                  <Box sx={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    bgcolor: 'primary.main',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    mt: 0.5,
                  }}>
                    <PersonIcon sx={{ fontSize: 20, color: 'white' }} />
                  </Box>
                )}
              </Box>
            </Fade>
          ))
        )}
        <div ref={messagesEndRef} />
      </Box>

      {/* 输入区域 */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          bgcolor: 'background.paper',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.05)',
          border: '1px solid',
          borderColor: isLoading ? 'primary.main' : 'divider',
          transition: 'border-color 0.3s',
        }}
      >
        <Tooltip title="清空对话">
          <IconButton size="small" onClick={handleClear} sx={{ color: 'text.secondary' }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="编辑 System Prompt">
          <IconButton size="small" onClick={handleOpenSettings} sx={{ color: 'text.secondary' }}>
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <TextField
          inputRef={inputRef}
          fullWidth
          placeholder="输入你的问题，如：V750的成本是多少？"
          variant="standard"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={isLoading}
          InputProps={{
            disableUnderline: true,
            sx: { fontSize: '1rem', fontWeight: 500 },
          }}
          autoFocus
        />
        <IconButton
          onClick={() => handleSend()}
          disabled={!input.trim() || isLoading}
          sx={{
            bgcolor: input.trim() && !isLoading ? 'primary.main' : alpha('#000', 0.05),
            color: input.trim() && !isLoading ? 'white' : 'text.disabled',
            width: 40, height: 40,
            transition: 'all 0.2s',
            '&:hover': {
              bgcolor: 'primary.dark',
              transform: 'scale(1.05)',
            },
            '&.Mui-disabled': {
              bgcolor: alpha('#000', 0.05),
              color: 'text.disabled',
            }
          }}
        >
          {isLoading ? <CircularProgress size={20} sx={{ color: 'text.secondary' }} /> : <SendIcon fontSize="small" />}
        </IconButton>
      </Paper>

      {/* System Prompt 编辑弹窗 */}
      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: { borderRadius: 3, minHeight: 500 }
        }}
      >
        <DialogTitle sx={{
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}>
          <SettingsIcon color="primary" />
          编辑 System Prompt
          {promptSaved && (
            <Chip label="✓ 已保存" size="small" color="success" sx={{ ml: 'auto', fontWeight: 600 }} />
          )}
        </DialogTitle>
        <DialogContent sx={{ p: 3, pt: 3 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', mb: 2, display: 'block' }}>
            System Prompt 定义了 AI 助手的行为和规则。修改后立即生效（运行时），重启服务会恢复默认值。
          </Typography>
          <TextField
            multiline
            fullWidth
            minRows={16}
            maxRows={24}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            variant="outlined"
            placeholder="输入 System Prompt..."
            sx={{
              '& .MuiOutlinedInput-root': {
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                borderRadius: 2,
              }
            }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
            字符数: {systemPrompt.length}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button
            onClick={() => setSettingsOpen(false)}
            variant="outlined"
            sx={{ borderRadius: 2, minWidth: 80 }}
          >
            关闭
          </Button>
          <Button
            onClick={handleSavePrompt}
            variant="contained"
            disabled={promptLoading}
            sx={{ borderRadius: 2, minWidth: 100 }}
          >
            {promptLoading ? '保存中...' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
