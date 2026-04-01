import { useState } from 'react';
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
  IconButton,
  TextField
} from '@mui/material';
import {
  Close as CloseIcon,
  PlayArrow as ProduceIcon
} from '@mui/icons-material';
import { Recipe, CostResult, Part, RecipePart } from '../types';
import { batchDeductStock } from '../utils/api';

interface RecipeDetailModalProps {
  recipe: Recipe;
  costResult: CostResult;
  parts: Part[];
  onClose: () => void;
  onStockUpdated?: () => void;
}

// 库存检查结果
interface StockCheck {
  name: string;
  model: string;
  supplier: string;
  qtyNeeded: number;
  currentStock: number;
  sufficient: boolean;
  partId?: number;
}

export default function RecipeDetailModal({
  recipe,
  costResult,
  parts,
  onClose,
  onStockUpdated
}: RecipeDetailModalProps) {
  const [produceQty, setProduceQty] = useState(1);
  const [showProduce, setShowProduce] = useState(false);
  const [producing, setProducing] = useState(false);
  const [produceError, setProduceError] = useState('');
  const [produceSuccess, setProduceSuccess] = useState('');

  const getSourceColor = (source: string) => {
    if (source === '精确匹配') return 'success';
    if (source.includes('型号回退')) return 'warning';
    return 'error';
  };

  const hasSnapshot = costResult.snapshotTotalCost !== undefined;

  const getPriceDiffColor = (current: string, snapshot?: string) => {
    if (!snapshot) return 'inherit';
    const cur = parseFloat(current);
    const snap = parseFloat(snapshot);
    if (cur > snap) return '#d32f2f';
    if (cur < snap) return '#2e7d32';
    return 'inherit';
  };

  // 检查库存是否足够
  const checkStock = (): StockCheck[] => {
    const partsJson = recipe.parts_json;
    let recipeParts: RecipePart[] = [];
    try {
      recipeParts = JSON.parse(partsJson);
    } catch {
      return [];
    }

    return recipeParts.map(rp => {
      const totalNeeded = rp.qty * produceQty;

      // 查找匹配的零件（精确匹配 model+supplier，回退到 model）
      let matchedPart = parts.find(
        p => p.model === rp.model && p.supplier === rp.supplier
      );
      if (!matchedPart) {
        matchedPart = parts.find(p => p.model === rp.model);
      }

      const currentStock = matchedPart ? matchedPart.stock : 0;

      return {
        name: rp.name || rp.model,
        model: rp.model,
        supplier: rp.supplier,
        qtyNeeded: totalNeeded,
        currentStock,
        sufficient: currentStock >= totalNeeded,
        partId: matchedPart?.Id
      };
    });
  };

  // 执行生产扣减
  const handleProduce = async () => {
    const checks = checkStock();
    const insufficient = checks.filter(c => !c.sufficient);
    if (insufficient.length > 0) {
      setProduceError(`库存不足：${insufficient.map(c => `${c.name}(需${c.qtyNeeded}，仅${c.currentStock})`).join('、')}`);
      return;
    }

    const missingParts = checks.filter(c => !c.partId);
    if (missingParts.length > 0) {
      setProduceError(`以下配件在零件表中不存在：${missingParts.map(c => c.name).join('、')}`);
      return;
    }

    setProducing(true);
    setProduceError('');
    try {
      const deductions = checks
        .filter(c => c.partId)
        .map(c => ({
          partId: c.partId!,
          currentStock: c.currentStock,
          deductQty: c.qtyNeeded
        }));

      await batchDeductStock(deductions);
      setProduceSuccess(`成功！已扣减 ${produceQty} 台生产用料。`);
      setShowProduce(false);
      if (onStockUpdated) onStockUpdated();
      setTimeout(() => setProduceSuccess(''), 5000);
    } catch (err) {
      setProduceError('扣减库存失败，请重试');
      console.error(err);
    } finally {
      setProducing(false);
    }
  };

  const stockChecks = showProduce ? checkStock() : [];
  const allSufficient = stockChecks.every(c => c.sufficient);

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('zh-CN', { hour12: false });
  };

  return (
    <Dialog open maxWidth="lg" fullWidth onClose={onClose}>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">
            配方详情 - {recipe.name}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 4, mb: 1, flexWrap: 'wrap' }}>
            <Typography variant="body1">
              <strong>规格：</strong> {recipe.spec || '-'}
            </Typography>
            <Typography variant="body1">
              <strong>创建时间：</strong> {formatDate(recipe.CreatedAt)}
            </Typography>
            {recipe.UpdatedAt && recipe.UpdatedAt !== recipe.CreatedAt && (
              <Typography variant="body1">
                <strong>最后更新：</strong> {formatDate(recipe.UpdatedAt)}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
            <Typography variant="body1" component="div" sx={{ display: 'flex', alignItems: 'center' }}>
              <strong>当前成本：</strong>
              <Typography component="span" variant="h6" color="error" sx={{ ml: 1 }}>
                ¥{costResult.totalCost}
              </Typography>
            </Typography>
            {hasSnapshot && (
              <Typography variant="body1" component="div" sx={{ display: 'flex', alignItems: 'center' }}>
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

        {/* 生产扣减区域 */}
        {showProduce && (
          <Box sx={{ mt: 3, p: 2, border: '2px solid', borderColor: 'primary.main', borderRadius: 2, bgcolor: 'primary.50' }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom color="primary">
              📦 确认生产 - 库存预检
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <TextField
                label="生产数量（台）"
                type="number"
                inputProps={{ min: 1, step: 1 }}
                value={produceQty}
                onChange={(e) => setProduceQty(Math.max(1, parseInt(e.target.value) || 1))}
                size="small"
                sx={{ width: 150 }}
              />
              <Typography variant="body2" color="text.secondary">
                总材料成本：<strong>¥{(parseFloat(costResult.totalCost) * produceQty).toFixed(2)}</strong>
              </Typography>
            </Box>

            <TableContainer sx={{ mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell>配件</TableCell>
                    <TableCell align="center">单台用量</TableCell>
                    <TableCell align="center">总需</TableCell>
                    <TableCell align="center">当前库存</TableCell>
                    <TableCell align="center">状态</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stockChecks.map((check, i) => (
                    <TableRow key={i} sx={{ bgcolor: check.sufficient ? 'inherit' : 'error.50' }}>
                      <TableCell>{check.name}</TableCell>
                      <TableCell align="center">{check.qtyNeeded / produceQty}</TableCell>
                      <TableCell align="center">{check.qtyNeeded}</TableCell>
                      <TableCell align="center">
                        <Chip
                          label={check.partId ? check.currentStock : '未找到'}
                          size="small"
                          color={!check.partId ? 'default' : check.sufficient ? 'success' : 'error'}
                          variant="outlined"
                          sx={{ fontWeight: 600 }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        {!check.partId ? (
                          <Chip label="零件缺失" size="small" color="default" />
                        ) : check.sufficient ? (
                          <Chip label="✓ 充足" size="small" color="success" />
                        ) : (
                          <Chip label={`缺 ${check.qtyNeeded - check.currentStock}`} size="small" color="error" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {produceError && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setProduceError('')}>
                {produceError}
              </Alert>
            )}

            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                color="primary"
                disabled={!allSufficient || producing}
                onClick={handleProduce}
                startIcon={<ProduceIcon />}
              >
                {producing ? '扣减中...' : `确认生产 ${produceQty} 台`}
              </Button>
              <Button variant="outlined" onClick={() => setShowProduce(false)}>
                取消
              </Button>
            </Box>
          </Box>
        )}

        {produceSuccess && (
          <Alert severity="success" sx={{ mt: 2 }} onClose={() => setProduceSuccess('')}>
            {produceSuccess}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        {!showProduce && (
          <Button
            variant="contained"
            color="primary"
            startIcon={<ProduceIcon />}
            onClick={() => setShowProduce(true)}
          >
            确认生产
          </Button>
        )}
        <Button onClick={onClose} variant="outlined">
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
}
