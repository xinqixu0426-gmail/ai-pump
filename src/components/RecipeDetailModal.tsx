import { useState, useMemo } from 'react';
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
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  X as CloseIcon,
  Play as ProduceIcon,
  ChevronDown as ExpandMoreIcon,
  Factory as FactoryIcon,
  Zap as ZapIcon,
  Wrench as WrenchIcon,
  Package as PackageIcon,
  Users as UsersIcon
} from 'lucide-react';
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

function getSurfaceTreatmentLabel(mode?: string | null): string {
  if (mode === 'painting') return '喷漆费';
  if (mode === 'electrophoresis') return '电泳外加工费';
  if (mode === 'powder_coating') return '喷塑外加工费';
  return '表面处理费';
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

  const { totalCostValue, groupedDetails } = useMemo(() => {
    const surfaceTreatmentMode = recipe.surfaceTreatmentMode || (recipe.paintingWage != null ? 'painting' : 'none');
    const surfaceTreatmentCost = recipe.surfaceTreatmentCost ?? recipe.paintingWage ?? 0;
    let laborWage = (recipe.assemblyWage || 0) + (recipe.packingWage || 0) + surfaceTreatmentCost;
    let mgmtFee = recipe.managementFee || 0;
    let laborTotal = laborWage + mgmtFee;

    const groups = {
      template: { id: 'template', title: '泵壳模板', icon: <FactoryIcon size={18} />, items: [] as any[], total: 0, snapshotTotal: 0 },
      coil: { id: 'coil', title: '线圈转子', icon: <ZapIcon size={18} />, items: [] as any[], total: 0, snapshotTotal: 0 },
      optional: { id: 'optional', title: '选配配件', icon: <WrenchIcon size={18} />, items: [] as any[], total: 0, snapshotTotal: 0 },
      dynamic: { id: 'dynamic', title: '动态配置', icon: <PackageIcon size={18} />, items: [] as any[], total: 0, snapshotTotal: 0 },
      labor: { id: 'labor', title: '人工与管理', icon: <UsersIcon size={18} />, items: [] as any[], total: laborTotal, snapshotTotal: laborTotal },
    };

    let extraModels = new Set<string>();
    try {
      const extras = JSON.parse(recipe.extraPartsJson || '[]');
      extras.forEach((p: any) => extraModels.add(`${p.model}||${p.supplier||''}`));
    } catch {}

    const displayDetails = (() => {
      const cable = costResult.details.find(detail => detail.name === '电缆线');
      const cableAccessory = costResult.details.find(detail => detail.model === '电缆配件费');
      if (!cable || !cableAccessory) return costResult.details;

      const cableSubtotal = parseFloat(cable.subtotal) || 0;
      const accessorySubtotal = parseFloat(cableAccessory.subtotal) || 0;
      const cableSnapshotSubtotal = parseFloat(cable.snapshotSubtotal || '0') || 0;
      const accessorySnapshotSubtotal = parseFloat(cableAccessory.snapshotSubtotal || '0') || 0;
      const combinedSubtotal = cableSubtotal + accessorySubtotal;
      const combinedSnapshotSubtotal = cableSnapshotSubtotal + accessorySnapshotSubtotal;
      const displayModel = cable.model.startsWith('电缆-') ? cable.model.replace('电缆-', '电缆线-') : cable.model;
      const combinedCable = {
        ...cable,
        model: displayModel,
        price: combinedSubtotal.toFixed(2),
        qty: 1,
        subtotal: combinedSubtotal.toFixed(2),
        source: cable.source === cableAccessory.source ? cable.source : `${cable.source} / ${cableAccessory.source}`,
        ...(combinedSnapshotSubtotal > 0 ? {
          snapshotPrice: combinedSnapshotSubtotal.toFixed(2),
          snapshotSubtotal: combinedSnapshotSubtotal.toFixed(2),
        } : {})
      };

      return costResult.details.reduce((list: any[], detail) => {
        if (detail === cable) list.push(combinedCable);
        if (detail === cableAccessory) return list;
        if (detail !== cable) list.push(detail);
        return list;
      }, []);
    })();

    displayDetails.forEach(detail => {
      const name = detail.name;
      const sub = parseFloat(detail.subtotal) || 0;
      const snapSub = parseFloat(detail.snapshotSubtotal || '0') || 0;
      const extraKey = `${detail.model}||${detail.supplier||''}`;
      const extraKeyNoSup = `${detail.model}||`;

      let groupKey: keyof typeof groups = 'template';

      if (['线圈转子', '电容'].includes(name)) {
        groupKey = 'coil';
      } else if (['浮球', '电缆线', '电缆接头配件', '木箱', '纸箱'].includes(name)) {
        groupKey = 'dynamic';
      } else if (name === '泵壳') {
        groupKey = 'template';
      } else if (extraModels.has(extraKey) || extraModels.has(extraKeyNoSup)) {
        groupKey = 'optional';
      } else if (name === detail.model) {
        groupKey = 'optional';
      }

      groups[groupKey].items.push(detail);
      groups[groupKey].total += sub;
      groups[groupKey].snapshotTotal += snapSub;
    });

    if (recipe.assemblyWage) groups.labor.items.push({ name: '安装工资', model: '-', supplier: '-', price: recipe.assemblyWage.toFixed(2), qty: 1, subtotal: recipe.assemblyWage.toFixed(2), source: '配方预设' });
    if (recipe.packingWage) groups.labor.items.push({ name: '打包工资', model: '-', supplier: '-', price: recipe.packingWage.toFixed(2), qty: 1, subtotal: recipe.packingWage.toFixed(2), source: '配方预设' });
    if (surfaceTreatmentCost) groups.labor.items.push({ name: getSurfaceTreatmentLabel(surfaceTreatmentMode), model: '-', supplier: '-', price: surfaceTreatmentCost.toFixed(2), qty: 1, subtotal: surfaceTreatmentCost.toFixed(2), source: '配方预设' });
    if (recipe.managementFee) groups.labor.items.push({ name: '管理费用', model: '-', supplier: '-', price: recipe.managementFee.toFixed(2), qty: 1, subtotal: recipe.managementFee.toFixed(2), source: '系统设定' });

    // 兼容老数据：如果数据库里没记录人工字段，但历史快照文本里有，就把它们提取出来放进分组
    if (laborTotal === 0 && recipe.savedCostDetails) {
      const lines = recipe.savedCostDetails.split('\n');
      lines.forEach(line => {
        if (line.includes('工资') || line.includes('费用')) {
          const match = line.match(/(.+?):\s*¥([\d.]+)/);
          if (match) {
            const name = match[1].trim();
            const price = parseFloat(match[2]);
            groups.labor.items.push({ name, model: '-', supplier: '-', price: price.toFixed(2), qty: 1, subtotal: price.toFixed(2), source: '历史快照' });
            laborTotal += price;
            groups.labor.total += price;
            groups.labor.snapshotTotal += price;
          }
        }
      });
    }

    const partsTotal = parseFloat(costResult.totalCost) || 0;
    const savedTotalCost = Number(recipe.savedTotalCost);
    const totalCost = Number.isFinite(savedTotalCost) && savedTotalCost > 0
      ? savedTotalCost
      : partsTotal + laborTotal;

    return {
      totalCostValue: totalCost,
      groupedDetails: [groups.template, groups.coil, groups.optional, groups.dynamic, groups.labor].filter(g => g.items.length > 0)
    };
  }, [costResult.details, costResult.totalCost, recipe]);

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
    const partsJson = recipe.partsJson;
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
          <IconButton aria-label="关闭配方详情" onClick={onClose} size="small">
            <CloseIcon size={20} />
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
                ¥{totalCostValue.toFixed(2)}
              </Typography>
            </Typography>
            {hasSnapshot && (
              <Typography variant="body1" component="div" sx={{ display: 'flex', alignItems: 'center' }}>
                <strong>保存时成本：</strong>
                <Typography component="span" variant="h6" color="text.secondary" sx={{ ml: 1 }}>
                  ¥{costResult.snapshotTotalCost}
                </Typography>
                {(() => {
                  const diff = totalCostValue - parseFloat(costResult.snapshotTotalCost!);
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

        <Typography variant="subtitle1" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1, mb: 2 }}>
          配件与人工明细
        </Typography>

        {groupedDetails.map(group => {
          const percent = totalCostValue > 0 ? ((group.total / totalCostValue) * 100).toFixed(1) : '0.0';
          return (
            <Accordion key={group.id} defaultExpanded disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', mb: 1.5, '&:before': { display: 'none' }, borderRadius: 1 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon size={20} />} sx={{ bgcolor: 'grey.50', minHeight: 48, '& .MuiAccordionSummary-content': { my: 1, alignItems: 'center' } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                  {group.icon}
                </Box>
                <Typography variant="subtitle2" sx={{ ml: 1, fontWeight: 700 }}>
                  {group.title}
                </Typography>
                <Chip label={`${group.items.length} 项`} size="small" sx={{ ml: 2, height: 20, fontSize: '0.7rem' }} />
                <Typography variant="subtitle2" color="primary.main" sx={{ ml: 'auto', mr: 2, fontWeight: 700 }}>
                  ¥{group.total.toFixed(2)}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1, fontWeight: 'normal' }}>
                    ({percent}%)
                  </Typography>
                </Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
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
                      {group.items.map((detail, index) => (
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
                    </TableBody>
                  </Table>
                </TableContainer>
              </AccordionDetails>
            </Accordion>
          );
        })}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', p: 2, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'divider', mt: 2 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mr: 3 }}>
            合计
          </Typography>
          {hasSnapshot && (
            <Typography variant="body1" color="text.secondary" fontWeight="bold" sx={{ mr: 3 }}>
              保存时: ¥{costResult.snapshotTotalCost}
            </Typography>
          )}
          <Typography variant="h6" color="error" fontWeight="bold">
            当前: ¥{totalCostValue.toFixed(2)}
          </Typography>
        </Box>

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

        {hasSnapshot && recipe.savedCostDetails && (
          <Accordion elevation={0} sx={{ mt: 2, bgcolor: 'info.50', border: '1px solid', borderColor: 'info.light', borderRadius: 1, '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon size={20} color="#0288d1" />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
              <Typography variant="subtitle2" color="info.dark" sx={{ fontWeight: 700 }}>
                查看原始保存的明细快照 (包含历史人工记录)
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box component="pre" sx={{ mt: 0, mb: 0, whiteSpace: 'pre-wrap', fontSize: '0.8rem', fontFamily: 'monospace', color: 'info.dark' }}>
                {recipe.savedCostDetails}
              </Box>
            </AccordionDetails>
          </Accordion>
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
                startIcon={<ProduceIcon size={20} />}
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
            startIcon={<ProduceIcon size={20} />}
            onClick={() => setShowProduce(true)}
          >
            确认生产
          </Button>
        )}
        <Button autoFocus onClick={onClose} variant="outlined">
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
}
