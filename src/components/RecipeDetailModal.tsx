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
  Users as UsersIcon
} from 'lucide-react';
import { Recipe, CostResult, Part } from '../types';
import { batchDeductStock } from '../utils/api';
import {
  StockCheck,
  buildRecipeStockChecks,
  stockChecksAllSufficient,
  stockChecksError,
  stockDeductionsFromChecks,
} from '../utils/recipeProductionRules';
import { getTechnicalDataEntries, parseTechnicalDataJson } from './recipe/StepTechnicalData';

interface RecipeDetailModalProps {
  recipe: Recipe;
  costResult: CostResult;
  parts: Part[];
  onClose: () => void;
  onStockUpdated?: () => void;
}

function getSurfaceTreatmentLabel(mode?: string | null): string {
  if (mode === 'painting') return '喷漆费';
  if (mode === 'electrophoresis') return '电泳外加工费';
  if (mode === 'powder_coating') return '喷塑外加工费';
  if (mode === 'electrophoresis_powder_coating') return '电泳+喷塑外加工费';
  return '表面处理费';
}

function screwLengthFromModel(model?: string): number | null {
  const match = String(model || '').match(/\*(\d+(?:\.\d+)?)$/);
  const length = match ? Number(match[1]) : NaN;
  return Number.isFinite(length) && length > 0 ? length : null;
}

function money(value: number) {
  return value.toFixed(2);
}

function buildLongScrewCalculation(detail: any, partMeta?: any): string {
  const nameAndModel = `${detail?.name || ''}${detail?.model || ''}`;
  if (!nameAndModel.includes('长螺丝')) return '';

  const screwLength = Number(partMeta?.screwLength || partMeta?.requestedScrewLength || screwLengthFromModel(detail?.model) || 0);
  if (!Number.isFinite(screwLength) || screwLength <= 0) return '';

  const formulaPrice = Math.max(0, 0.00424 * screwLength - 0.198);
  const unitPrice = Number(detail?.snapshotPrice || detail?.price || formulaPrice);
  const qty = Number(detail?.qty || partMeta?.qty || 1);
  const subtotal = unitPrice * qty;
  const barrel = Number(partMeta?.barrelLength);
  const extra = Number(partMeta?.longScrewExtraLength);
  const lengthText = Number.isFinite(barrel) && barrel > 0 && Number.isFinite(extra)
    ? `机筒 ${barrel}mm + 补偿 ${extra}mm = 长螺丝 ${screwLength}mm`
    : `长螺丝长度 ${screwLength}mm`;

  return `${lengthText}；单价≈0.00424×${screwLength}-0.198=¥${money(formulaPrice)}；数量 ${qty}；小计 ¥${money(subtotal)}`;
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
    if (source === '保存快照') return 'info';
    if (source.includes('型号回退')) return 'warning';
    return 'error';
  };

  const savedTotalCostValue = Number(recipe.savedTotalCost);
  const hasSnapshot = Number.isFinite(savedTotalCostValue) && savedTotalCostValue > 0;
  const technicalData = useMemo(() => parseTechnicalDataJson(recipe.technicalDataJson), [recipe.technicalDataJson]);
  const technicalEntries = useMemo(() => getTechnicalDataEntries(technicalData), [technicalData]);

  const { totalCostValue, currentCostValue, groupedDetails, isSnapshotView } = useMemo(() => {
    const surfaceTreatmentMode = recipe.surfaceTreatmentMode || (recipe.paintingWage != null ? 'painting' : 'none');
    const surfaceTreatmentCost = recipe.surfaceTreatmentCost ?? recipe.paintingWage ?? 0;
    let laborWage = (recipe.assemblyWage || 0) + (recipe.packingWage || 0) + surfaceTreatmentCost;
    let mgmtFee = recipe.managementFee || 0;
    let laborTotal = laborWage + mgmtFee;

    const groups = {
      template: { id: 'template', title: '泵壳模板', icon: <FactoryIcon size={18} />, items: [] as any[], total: 0, snapshotTotal: 0 },
      coil: { id: 'coil', title: '线圈转子+电容+电缆线', icon: <ZapIcon size={18} />, items: [] as any[], total: 0, snapshotTotal: 0 },
      optional: { id: 'optional', title: '选配配件', icon: <WrenchIcon size={18} />, items: [] as any[], total: 0, snapshotTotal: 0 },
      labor: { id: 'labor', title: '人工与管理', icon: <UsersIcon size={18} />, items: [] as any[], total: laborTotal, snapshotTotal: laborTotal },
    };

    let extraModels = new Set<string>();
    let savedParts: any[] = [];
    try {
      const extras = JSON.parse(recipe.extraPartsJson || '[]');
      extras.forEach((p: any) => extraModels.add(`${p.model}||${p.supplier||''}`));
    } catch {}
    try {
      savedParts = JSON.parse(recipe.partsJson || '[]');
      if (!Array.isArray(savedParts)) savedParts = [];
    } catch { savedParts = []; }
    const savedCost = Number(recipe.savedTotalCost);
    const useSavedSnapshotDetails = Number.isFinite(savedCost) && savedCost > 0 && savedParts.length > 0;
    const sourceDetails = useSavedSnapshotDetails
      ? savedParts.map(part => {
        const price = Number(part?.snapshotPrice ?? part?.price ?? 0);
        const qty = Number(part?.qty ?? 1);
        const subtotal = price * qty;
        return {
          ...part,
          name: part?.name || part?.model || '-',
          model: part?.model || '-',
          supplier: part?.supplier || '-',
          price: price.toFixed(2),
          snapshotPrice: price.toFixed(2),
          qty,
          subtotal: subtotal.toFixed(2),
          snapshotSubtotal: subtotal.toFixed(2),
          source: '保存快照',
        };
      })
      : costResult.details;

    const displayDetails = (() => {
      const cable = sourceDetails.find(detail => detail.name === '电缆线');
      const cableAccessory = sourceDetails.find(detail => detail.model === '电缆配件费');
      if (!cable || !cableAccessory) return sourceDetails;

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

      return sourceDetails.reduce((list: any[], detail) => {
        if (detail === cable) list.push(combinedCable);
        if (detail === cableAccessory) return list;
        if (detail !== cable) list.push(detail);
        return list;
      }, []);
    })();

    const findSavedPart = (detail: any) => savedParts.find(part => (
      String(part?.model || '') === String(detail?.model || '')
      && String(part?.name || part?.model || '') === String(detail?.name || detail?.model || '')
      && String(part?.supplier || '') === String(detail?.supplier === '-' ? '' : detail?.supplier || '')
    )) || savedParts.find(part => (
      String(part?.model || '') === String(detail?.model || '')
      && `${part?.name || ''}${part?.model || ''}`.includes('长螺丝')
    ));

    displayDetails.forEach(detail => {
      const longScrewCalculation = buildLongScrewCalculation(detail, findSavedPart(detail));
      const displayDetail = longScrewCalculation ? { ...detail, longScrewCalculation } : detail;
      const name = detail.name;
      const sub = parseFloat(detail.subtotal) || 0;
      const snapSub = parseFloat(detail.snapshotSubtotal || '0') || 0;
      const extraKey = `${detail.model}||${detail.supplier||''}`;
      const extraKeyNoSup = `${detail.model}||`;

      let groupKey: keyof typeof groups = 'template';

      if (['线圈转子', '电容', '电缆线', '电缆接头配件'].includes(name)) {
        groupKey = 'coil';
      } else if (['浮球', '木箱', '纸箱', '泡沫', '商标', '说明书', '珍珠棉'].includes(name) || detail.packagingMaterial) {
        groupKey = 'optional';
      } else if (name === '泵壳') {
        groupKey = 'template';
      } else if (extraModels.has(extraKey) || extraModels.has(extraKeyNoSup)) {
        groupKey = 'optional';
      } else if (name === detail.model) {
        groupKey = 'optional';
      }

      groups[groupKey].items.push(displayDetail);
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
    const currentCost = partsTotal + laborTotal;
    const totalCost = useSavedSnapshotDetails ? savedCost : currentCost;

    return {
      totalCostValue: totalCost,
      currentCostValue: currentCost,
      groupedDetails: [groups.template, groups.coil, groups.optional, groups.labor].filter(g => g.items.length > 0),
      isSnapshotView: useSavedSnapshotDetails,
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
    return buildRecipeStockChecks(recipe, parts, produceQty);
  };

  // 执行生产扣减
  const handleProduce = async () => {
    const checks = checkStock();
    const validationError = stockChecksError(checks);
    if (validationError) {
      setProduceError(validationError);
      return;
    }

    setProducing(true);
    setProduceError('');
    try {
      await batchDeductStock(stockDeductionsFromChecks(checks));
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
  const allSufficient = stockChecksAllSufficient(stockChecks);

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
              <strong>{isSnapshotView ? '保存快照成本：' : '当前重算成本：'}</strong>
              <Typography component="span" variant="h6" color="error" sx={{ ml: 1 }}>
                ¥{totalCostValue.toFixed(2)}
              </Typography>
            </Typography>
            {isSnapshotView && (
              <Typography variant="body1" component="div" sx={{ display: 'flex', alignItems: 'center' }}>
                <strong>当前重算参考：</strong>
                <Typography component="span" variant="h6" color="text.secondary" sx={{ ml: 1 }}>
                  ¥{currentCostValue.toFixed(2)}
                </Typography>
                {(() => {
                  const diff = currentCostValue - totalCostValue;
                  if (Math.abs(diff) < 0.01) return null;
                  const pct = ((diff / totalCostValue) * 100).toFixed(1);
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
          {(recipe.modelVariantId || recipe.impellerModel) && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
              {recipe.modelVariantId ? <Chip size="small" label={`常用配置 #${recipe.modelVariantId}`} variant="outlined" /> : null}
              {recipe.impellerModel ? <Chip size="small" label={`叶轮 ${recipe.impellerModel}`} color="primary" variant="outlined" /> : null}
              {recipe.impellerThickness ? <Chip size="small" label={`${recipe.impellerThickness}mm厚`} variant="outlined" /> : null}
              {recipe.impellerDiameter ? <Chip size="small" label={`直径${recipe.impellerDiameter}mm`} variant="outlined" /> : null}
              {recipe.impellerBladeCount ? <Chip size="small" label={`${recipe.impellerBladeCount}片叶`} variant="outlined" /> : null}
            </Box>
          )}
          {technicalEntries.length > 0 && (
            <Box sx={{ mt: 1.5, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'grey.50' }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>技术档案</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1 }}>
                {technicalEntries.map(entry => (
                  <Typography key={entry.id} variant="body2" color="text.secondary">
                    {entry.label || '未命名字段'}：<strong>{entry.value || '-'}</strong>{entry.unit ? ` ${entry.unit}` : ''}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}
        </Box>

        <Typography variant="subtitle1" gutterBottom sx={{ borderBottom: 1, borderColor: 'divider', pb: 1, mb: 2 }}>
          配件与人工明细
          {isSnapshotView && (
            <Chip size="small" label="按保存快照展示" color="info" variant="outlined" sx={{ ml: 1, fontWeight: 700 }} />
          )}
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
                        <TableCell align="right">{isSnapshotView ? '快照单价' : '当前单价'}</TableCell>
                        {hasSnapshot && !isSnapshotView && <TableCell align="right">保存时单价</TableCell>}
                        <TableCell align="center">数量</TableCell>
                        <TableCell align="right">{isSnapshotView ? '快照小计' : '当前小计'}</TableCell>
                        {hasSnapshot && !isSnapshotView && <TableCell align="right">保存时小计</TableCell>}
                        <TableCell>来源</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.items.map((detail, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <Typography variant="body2">{detail.name}</Typography>
                            {detail.longScrewCalculation && (
                              <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}>
                                {detail.longScrewCalculation}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>{detail.model}</TableCell>
                          <TableCell>{detail.supplier}</TableCell>
                          <TableCell
                            align="right"
                            sx={{ color: getPriceDiffColor(detail.price, detail.snapshotPrice), fontWeight: hasSnapshot ? 600 : 'normal' }}
                          >
                            ¥{detail.price}
                          </TableCell>
                          {hasSnapshot && !isSnapshotView && (
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
                          {hasSnapshot && !isSnapshotView && (
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
          {isSnapshotView && (
            <Typography variant="body1" color="text.secondary" fontWeight="bold" sx={{ mr: 3 }}>
              当前重算参考: ¥{currentCostValue.toFixed(2)}
            </Typography>
          )}
          <Typography variant="h6" color="error" fontWeight="bold">
            {isSnapshotView ? '保存快照' : '当前重算'}: ¥{totalCostValue.toFixed(2)}
          </Typography>
        </Box>

        {costResult.missingParts.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            <strong>注意：</strong>当前重算时以下配件未在零件表中找到：
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
