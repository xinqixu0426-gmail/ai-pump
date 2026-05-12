import { Box, Typography, Autocomplete, TextField, InputAdornment, Button, TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Tooltip, Chip, IconButton } from '@mui/material';
import { Search as SearchIcon, Plus as AddIcon, Clock as HistoryIcon, Trash2 as DeleteIcon } from 'lucide-react';
import { Recipe } from '../../types';
import { HistoryPrice } from '../../utils/orderStore';
import { formatMoney as fmt } from '../../utils/format';

export interface DraftItem {
  id: string;
  recipeId?: number;
  recipeName: string;
  spec?: string;
  qty: number;
  partsJson: string;
  unitCost: number;
  profitMargin: number;
  unitPrice: number;
  history?: HistoryPrice | null;
}

export interface OrderItemsManagerProps {
  draftItems: DraftItem[];
  recipeOptions: { label: string; recipe: Recipe }[];
  selectedRecipe: Recipe | null;
  setSelectedRecipe: (v: Recipe | null) => void;
  addQty: number;
  setAddQty: (v: number) => void;
  addRecipeToOrder: () => void;
  removeItem: (id: string) => void;
  updateItemQty: (id: string, qty: number) => void;
  updateItemMargin: (id: string, margin: number) => void;
  updateItemPrice: (id: string, price: number) => void;
  orderTotals: { totalCost: number; totalPrice: number; totalProfit: number };
}

export default function OrderItemsManager(props: OrderItemsManagerProps) {
  const {
    draftItems, recipeOptions, selectedRecipe, setSelectedRecipe, addQty, setAddQty,
    addRecipeToOrder, removeItem, updateItemQty, updateItemMargin, updateItemPrice, orderTotals
  } = props;

  return (
    <Box>
      {/* 添加配方区 */}
      <Box
        sx={{
          p: 2,
          mb: 3,
          border: '1px dashed',
          borderColor: 'primary.light',
          borderRadius: 2,
          backgroundColor: 'primary.50',
        }}
      >
        <Typography variant="subtitle2" mb={1.5} color="primary">
          从已有配方中选择
        </Typography>
        <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
          <Autocomplete
            options={recipeOptions}
            value={recipeOptions.find((o) => o.recipe.Id === selectedRecipe?.Id) ?? null}
            onChange={(_, v) => setSelectedRecipe(v?.recipe ?? null)}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                label="搜索配方"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <>
                      <InputAdornment position="start"><SearchIcon size={18} /></InputAdornment>
                      {params.InputProps.startAdornment}
                    </>
                  ),
                }}
              />
            )}
            sx={{ width: 320 }}
            noOptionsText="无匹配配方"
          />
          <TextField
            size="small"
            label="生产数量"
            type="number"
            value={addQty}
            onChange={(e) => setAddQty(Math.max(1, Number(e.target.value)))}
            inputProps={{ min: 1 }}
            sx={{ width: 120 }}
            InputProps={{ endAdornment: <InputAdornment position="end">台</InputAdornment> }}
          />
          <Button
            variant="contained"
            startIcon={<AddIcon size={18} />}
            onClick={addRecipeToOrder}
            disabled={!selectedRecipe}
          >
            加入订单
          </Button>
        </Box>
      </Box>

      {/* 型号列表 */}
      {draftItems.length === 0 ? (
        <Box textAlign="center" py={3} color="text.secondary">
          请先添加型号
        </Box>
      ) : (
        <>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: 'grey.100' }}>
                  <TableCell>型号/配方</TableCell>
                  <TableCell>规格</TableCell>
                  <TableCell align="center">数量</TableCell>
                  <TableCell align="right">单台成本</TableCell>
                  <TableCell align="center">利润率 %</TableCell>
                  <TableCell align="right">出厂价</TableCell>
                  <TableCell align="right">小计</TableCell>
                  <TableCell align="center" sx={{ width: 80 }}>历史</TableCell>
                  <TableCell align="center" sx={{ width: 50 }}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {draftItems.map((item) => {
                  const subtotal = item.unitPrice * item.qty;
                  const marginPct = Math.round((item.profitMargin - 1) * 100);
                  return (
                    <TableRow key={item.id} hover>
                      <TableCell sx={{ fontWeight: 600, maxWidth: 160 }}>
                        {item.recipeName}
                      </TableCell>
                      <TableCell>{item.spec || '-'}</TableCell>
                      <TableCell align="center">
                        <TextField
                          size="small"
                          type="number"
                          value={item.qty}
                          onChange={(e) => updateItemQty(item.id, Number(e.target.value))}
                          inputProps={{ min: 1, style: { textAlign: 'center', width: 50 } }}
                          InputProps={{ endAdornment: <InputAdornment position="end">台</InputAdornment> }}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                        ¥{fmt(item.unitCost)}
                      </TableCell>
                      <TableCell align="center">
                        <TextField
                          size="small"
                          type="number"
                          value={marginPct}
                          onChange={(e) => updateItemMargin(item.id, 1 + Number(e.target.value) / 100)}
                          inputProps={{ min: 0, step: 1, style: { textAlign: 'center', width: 50 } }}
                          InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          size="small"
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) => updateItemPrice(item.id, Number(e.target.value))}
                          inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right', width: 80 } }}
                          InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        ¥{fmt(subtotal)}
                      </TableCell>
                      <TableCell align="center">
                        {item.history ? (
                          <Tooltip
                            title={
                              `上次出厂价 ¥${fmt(item.history.unitPrice)}（${item.history.customerName}，${new Date(item.history.date).toLocaleDateString('zh-CN')}）`
                            }
                          >
                            <Chip
                              icon={<HistoryIcon size={16} />}
                              label={`¥${fmt(item.history.unitPrice)}`}
                              size="small"
                              color={item.unitPrice > item.history.unitPrice ? 'error' : item.unitPrice < item.history.unitPrice ? 'success' : 'default'}
                              variant="outlined"
                              sx={{ fontSize: '0.75rem' }}
                            />
                          </Tooltip>
                        ) : (
                          <Typography variant="caption" color="text.disabled">无</Typography>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        <Tooltip title="移除">
                          <IconButton size="small" color="error" aria-label="删除订单型号" onClick={() => removeItem(item.id)}>
                            <DeleteIcon size={18} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* 汇总栏 */}
          <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 2, display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Typography variant="body2">
              总成本: <b>¥{fmt(orderTotals.totalCost)}</b>
            </Typography>
            <Typography variant="body2">
              总出厂价: <b style={{ color: '#1976d2' }}>¥{fmt(orderTotals.totalPrice)}</b>
            </Typography>
            <Typography variant="body2">
              总利润: <b style={{ color: orderTotals.totalProfit >= 0 ? '#2e7d32' : '#d32f2f' }}>
                ¥{fmt(orderTotals.totalProfit)}
              </b>
              {orderTotals.totalCost > 0 && (
                <span style={{ marginLeft: 4, color: '#888' }}>
                  ({Math.round(orderTotals.totalProfit / orderTotals.totalCost * 100)}%)
                </span>
              )}
            </Typography>
          </Box>
        </>
      )}
    </Box>
  );
}
