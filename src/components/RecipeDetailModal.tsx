import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Box,
  Alert,
  Chip,
  IconButton
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { Recipe, CostResult } from '../types';

interface RecipeDetailModalProps {
  recipe: Recipe;
  costResult: CostResult;
  onClose: () => void;
}

export default function RecipeDetailModal({
  recipe,
  costResult,
  onClose
}: RecipeDetailModalProps) {
  const getSourceColor = (source: string) => {
    switch (source) {
      case '精确匹配':
        return 'success';
      case '型号回退':
        return 'warning';
      default:
        return 'error';
    }
  };

  const hasSnapshot = costResult.snapshotTotalCost !== undefined;

  // 计算价格差异百分比
  const getPriceDiffColor = (current: string, snapshot?: string) => {
    if (!snapshot) return 'inherit';
    const cur = parseFloat(current);
    const snap = parseFloat(snapshot);
    if (cur > snap) return '#d32f2f'; // 涨价：红
    if (cur < snap) return '#2e7d32'; // 降价：绿
    return 'inherit';
  };

  return (
    <Dialog open maxWidth="lg" fullWidth onClose={onClose}>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">
            配方详情 - {recipe.配方名称 || recipe.name}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body1" gutterBottom>
            <strong>规格：</strong>
            {recipe.规格 || recipe.spec || '-'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
            <Typography variant="body1">
              <strong>当前成本：</strong>
              <Typography component="span" variant="h6" color="error" sx={{ ml: 1 }}>
                ¥{costResult.totalCost}
              </Typography>
            </Typography>
            {hasSnapshot && (
              <Typography variant="body1">
                <strong>保存时成本：</strong>
                <Typography component="span" variant="h6" color="text.secondary" sx={{ ml: 1 }}>
                  ¥{costResult.snapshotTotalCost}
                </Typography>
                {(() => {
                  const diff = parseFloat(costResult.totalCost) - parseFloat(costResult.snapshotTotalCost!);
                  if (Math.abs(diff) < 0.01) return null;
                  const pct = ((diff / parseFloat(costResult.snapshotTotalCost!)) * 100).toFixed(1);
                  return (
                    <Chip
                      size="small"
                      label={diff > 0 ? `↑${pct}%` : `↓${Math.abs(parseFloat(pct))}%`}
                      color={diff > 0 ? 'error' : 'success'}
                      sx={{ ml: 1, fontWeight: 700, fontSize: '0.75rem' }}
                    />
                  );
                })()}
              </Typography>
            )}
          </Box>
        </Box>

        <Typography variant="subtitle1" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
          配件明细
        </Typography>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                <TableCell>名称</TableCell>
                <TableCell>型号</TableCell>
                <TableCell>供应商</TableCell>
                <TableCell align="right">当前单价</TableCell>
                {hasSnapshot && <TableCell align="right">保存时单价</TableCell>}
                <TableCell align="center">数量</TableCell>
                <TableCell align="right">当前小计</TableCell>
                {hasSnapshot && <TableCell align="right">保存时小计</TableCell>}
                <TableCell>来源</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {costResult.details.map((detail, index) => (
                <TableRow key={index}>
                  <TableCell>{detail.name}</TableCell>
                  <TableCell>{detail.model}</TableCell>
                  <TableCell>{detail.supplier}</TableCell>
                  <TableCell
                    align="right"
                    sx={{ color: getPriceDiffColor(detail.price, detail.snapshotPrice), fontWeight: hasSnapshot ? 600 : 'normal' }}
                  >
                    ¥{detail.price}
                  </TableCell>
                  {hasSnapshot && (
                    <TableCell align="right" sx={{ color: 'text.secondary' }}>
                      {detail.snapshotPrice ? `¥${detail.snapshotPrice}` : '-'}
                    </TableCell>
                  )}
                  <TableCell align="center">{detail.qty}</TableCell>
                  <TableCell
                    align="right"
                    sx={{ color: getPriceDiffColor(detail.subtotal, detail.snapshotSubtotal), fontWeight: hasSnapshot ? 600 : 'normal' }}
                  >
                    ¥{detail.subtotal}
                  </TableCell>
                  {hasSnapshot && (
                    <TableCell align="right" sx={{ color: 'text.secondary' }}>
                      {detail.snapshotSubtotal ? `¥${detail.snapshotSubtotal}` : '-'}
                    </TableCell>
                  )}
                  <TableCell>
                    <Chip
                      label={detail.source}
                      color={getSourceColor(detail.source)}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ backgroundColor: 'grey.50' }}>
                <TableCell colSpan={3} />
                <TableCell align="right">
                  <Typography color="error" fontWeight="bold">
                    ¥{costResult.totalCost}
                  </Typography>
                </TableCell>
                {hasSnapshot && (
                  <TableCell align="right">
                    <Typography color="text.secondary" fontWeight="bold">
                      ¥{costResult.snapshotTotalCost}
                    </Typography>
                  </TableCell>
                )}
                <TableCell align="center">
                  <strong>合计</strong>
                </TableCell>
                <TableCell align="right">
                  <Typography color="error" fontWeight="bold">
                    ¥{costResult.totalCost}
                  </Typography>
                </TableCell>
                {hasSnapshot && (
                  <TableCell align="right">
                    <Typography color="text.secondary" fontWeight="bold">
                      ¥{costResult.snapshotTotalCost}
                    </Typography>
                  </TableCell>
                )}
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>

        {costResult.missingParts.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            <strong>注意：</strong>以下配件未在零件表中找到：
            {costResult.missingParts.join(', ')}
          </Alert>
        )}

        {!hasSnapshot && (
          <Alert severity="info" sx={{ mt: 2 }}>
            该配方保存时未记录价格快照（可能是旧版本创建的），仅显示当前实时成本。重新录入后将自动带上快照。
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
}
