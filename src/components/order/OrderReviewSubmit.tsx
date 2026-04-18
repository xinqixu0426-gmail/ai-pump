import { Box, Typography, TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Chip, Divider, Alert } from '@mui/material';
import { Warning as WarningIcon, CheckCircle as CheckIcon } from '@mui/icons-material';
import { PurchaseItem, TodoItem } from '../../types';
import { DraftItem } from './OrderItemsManager';
import { formatMoney as fmt } from '../../utils/format';

export interface OrderReviewSubmitProps {
  activeStep: number;
  purchaseList: PurchaseItem[];
  todos: TodoItem[];
  needCount: number;
  orderTotals: { totalCost: number; totalPrice: number; totalProfit: number };
  customerName: string;
  contractNo: string;
  remark: string;
  draftItems: DraftItem[];
  isEdit: boolean;
}

export default function OrderReviewSubmit(props: OrderReviewSubmitProps) {
  const {
    activeStep, purchaseList, todos, needCount, orderTotals,
    customerName, contractNo, remark, draftItems, isEdit
  } = props;

  if (activeStep === 2) {
    return (
      <Box>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <Typography variant="subtitle1" fontWeight={700}>采购汇总清单</Typography>
          {needCount > 0 ? (
            <Chip
              icon={<WarningIcon />}
              label={`${needCount} 种零件需采购`}
              color="warning"
              size="small"
            />
          ) : (
            <Chip icon={<CheckIcon />} label="库存全部充足" color="success" size="small" />
          )}
        </Box>

        <TableContainer sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                <TableCell>型号</TableCell>
                <TableCell>名称</TableCell>
                <TableCell>供应商</TableCell>
                <TableCell align="right">需要总量</TableCell>
                <TableCell align="right">当前库存</TableCell>
                <TableCell align="right">需采购</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {purchaseList.map((p) => (
                <TableRow
                  key={`${p.model}|${p.supplier}`}
                  sx={{
                    backgroundColor: p.needToBuy > 0
                      ? 'rgba(239,68,68,0.05)'
                      : 'rgba(34,197,94,0.03)',
                  }}
                >
                  <TableCell>{p.model}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{p.supplier}</TableCell>
                  <TableCell align="right">{p.totalQty}</TableCell>
                  <TableCell align="right">{p.currentStock}</TableCell>
                  <TableCell align="right">
                    {p.needToBuy > 0 ? (
                      <Typography variant="body2" color="error.main" fontWeight={700}>
                        {p.needToBuy}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="success.main">✓</Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {todos.length > 0 && (
          <>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="subtitle2" mb={1.5} color="warning.dark">
              📋 采购 To-Do（保存后可逐条打勾）
            </Typography>
            {todos.map((todo) => (
              <Box
                key={todo.id}
                sx={{
                  p: 1.5,
                  mb: 1,
                  borderRadius: 1.5,
                  border: '1px solid',
                  borderColor: 'warning.light',
                  backgroundColor: 'rgba(251,191,36,0.06)',
                }}
              >
                <Typography variant="body2" fontWeight={500}>
                  ☐ {todo.description}
                </Typography>
              </Box>
            ))}
          </>
        )}
      </Box>
    );
  }

  if (activeStep === 3) {
    return (
      <Box sx={{ maxWidth: 560 }}>
        <Alert severity="info" sx={{ mb: 2 }}>
          {isEdit ? '请确认修改后的订单信息。' : '请确认订单信息，提交后保存到数据库。'}
        </Alert>
        <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          <Typography variant="body2" mb={1}><b>客户：</b>{customerName}</Typography>
          {contractNo && <Typography variant="body2" mb={1}><b>合同号：</b>{contractNo}</Typography>}
          {remark && <Typography variant="body2" mb={1}><b>备注：</b>{remark}</Typography>}
          <Typography variant="body2" mb={1}><b>型号数：</b>{draftItems.length} 个</Typography>
          <Typography variant="body2" component="div" mb={1} display="flex" alignItems="center">
            <b>需采购零件：</b>
            {needCount > 0 ? (
              <Chip label={`${needCount} 种`} size="small" color="warning" sx={{ ml: 0.5 }} />
            ) : (
              <Chip label="库存充足" size="small" color="success" sx={{ ml: 0.5 }} />
            )}
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Box display="flex" gap={3} flexWrap="wrap">
            <Typography variant="body2">
              <b>总成本：</b>¥{fmt(orderTotals.totalCost)}
            </Typography>
            <Typography variant="body2" color="primary.main">
              <b>总出厂价：</b>¥{fmt(orderTotals.totalPrice)}
            </Typography>
            <Typography variant="body2" color={orderTotals.totalProfit >= 0 ? 'success.main' : 'error.main'}>
              <b>总利润：</b>¥{fmt(orderTotals.totalProfit)}
              {orderTotals.totalCost > 0 && ` (${Math.round(orderTotals.totalProfit / orderTotals.totalCost * 100)}%)`}
            </Typography>
          </Box>
        </Box>
      </Box>
    );
  }

  return null;
}
