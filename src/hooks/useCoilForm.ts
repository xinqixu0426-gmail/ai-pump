import { useState, useCallback, useMemo } from 'react';
import { useAppStore } from '../utils/store';
import { proxyRequest } from '../utils/api';

export interface CoilRecord {
  Id: number;
  spec: string;
  material: string;
  unitPrice: string;
  sheets: string;
  wireWeight: string;
  copperBase: string;
  coilFee: string;
  rotorFee: string;
  cost: string;
  defaultCapacitor: string | null;
  defaultWireGauge: string | null;
}

export interface CopperPriceInfo {
  livePrice: number;
  livePricePerKg: string;
  dbPrice: string;
  lastUpdate: string | null;
}

export interface CoilFormData {
  spec: string;
  material: string;
  unitPrice: string;
  sheets: string;
  wireWeight: string;
  copperBase: string;
  coilFee: string;
  rotorFee: string;
  defaultCapacitor: string;
  defaultWireGauge: string;
}

const emptyForm: CoilFormData = {
  spec: '', material: '钢带', unitPrice: '', sheets: '', wireWeight: '', copperBase: '',
  coilFee: '', rotorFee: '', defaultCapacitor: '', defaultWireGauge: ''
};

export const DEFAULT_COIL_MATERIAL = '钢带';
export const MATERIAL_UNIT_PRICE_DEFAULTS: Record<string, string> = {
  钢带: '0.21',
  冷轧800: '0.22',
};
export const coilGroupKey = (spec: string, material = DEFAULT_COIL_MATERIAL) => `${spec}||${material || DEFAULT_COIL_MATERIAL}`;
export const splitCoilGroupKey = (key: string) => {
  const [spec, material = DEFAULT_COIL_MATERIAL] = key.split('||');
  return { spec, material: material || DEFAULT_COIL_MATERIAL };
};

export function useCoilForm() {
  const { showSnackbar } = useAppStore();
  const [coils, setCoils] = useState<CoilRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [copperPrice, setCopperPrice] = useState<CopperPriceInfo | null>(null);
  const [copperLoading, setCopperLoading] = useState(false);
  const [copperUpdating, setCopperUpdating] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<CoilFormData>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const [expandedSpecs, setExpandedSpecs] = useState<Set<string>>(new Set());

  const loadCoils = useCallback(async () => {
    try {
      setLoading(true);
      const json = await proxyRequest<{ success: boolean; data: CoilRecord[] }>('/api/coils');
      if (json.success) {
        setCoils(json.data);
        const specs = new Set(json.data.map((c: CoilRecord) => coilGroupKey(c.spec, c.material)));
        setExpandedSpecs(specs as Set<string>);
      } else setError('加载线圈数据失败');
    } catch (err) { setError('加载线圈数据失败: ' + (err as Error).message); }
    finally { setLoading(false); }
  }, []);

  const loadCopperPrice = useCallback(async () => {
    try {
      setCopperLoading(true);
      const json = await proxyRequest<{ success: boolean; data: CopperPriceInfo }>('/api/copper-price');
      if (json.success) setCopperPrice(json.data);
    } catch { /* ignore */ }
    finally { setCopperLoading(false); }
  }, []);

  const groupedCoils = useMemo(() => {
    const groups: Record<string, CoilRecord[]> = {};
    coils.forEach(c => {
      const key = coilGroupKey(c.spec, c.material);
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    Object.values(groups).forEach(g => g.sort((a, b) => parseInt(a.sheets) - parseInt(b.sheets)));
    return groups;
  }, [coils]);

  const handleCopperUpdate = async () => {
    try {
      setCopperUpdating(true);
      const json = await proxyRequest<{ success: boolean; error?: string }>('/api/copper-price/update', { method: 'POST' });
      if (json.success) {
        showSnackbar(`铜价更新成功`, 'success');
        await loadCoils(); await loadCopperPrice();
      } else setError('铜价更新失败: ' + json.error);
    } catch (err) { setError('铜价更新失败: ' + (err as Error).message); }
    finally { setCopperUpdating(false); }
  };

  const handleAdd = () => {
    setEditingId(null);
    setFormData({ ...emptyForm, unitPrice: MATERIAL_UNIT_PRICE_DEFAULTS[DEFAULT_COIL_MATERIAL], copperBase: copperPrice?.dbPrice || copperPrice?.livePricePerKg || '' });
    setDialogOpen(true);
  };

  // 新增时输入规格后自动带入同规格字段
  const autoFillFromSpec = useCallback((spec: string, material = DEFAULT_COIL_MATERIAL) => {
    const exact = groupedCoils[coilGroupKey(spec, material)];
    const existing = exact || coils.filter(c => c.spec === spec);
    if (!existing || existing.length === 0) return;
    const ref = existing[0];
    setFormData(prev => ({
      ...prev,
      spec,
      material: ref.material || material || DEFAULT_COIL_MATERIAL,
      unitPrice: exact ? (ref.unitPrice || prev.unitPrice) : (MATERIAL_UNIT_PRICE_DEFAULTS[material] || ref.unitPrice || prev.unitPrice),
      copperBase: ref.copperBase || prev.copperBase,
      coilFee: ref.coilFee || prev.coilFee,
      rotorFee: ref.rotorFee || prev.rotorFee,
      defaultWireGauge: ref.defaultWireGauge || prev.defaultWireGauge,
      defaultCapacitor: ref.defaultCapacitor || prev.defaultCapacitor,
    }));
  }, [coils, groupedCoils]);

  // 按规格批量更新单价
  const updateSpecPrice = async (spec: string, material: string, newPrice: string) => {
    try {
      const json = await proxyRequest<{ success: boolean; updated: number; error?: string }>(`/api/coils/spec/${encodeURIComponent(spec)}`, {
        method: 'PATCH',
        body: JSON.stringify({ unitPrice: newPrice, material })
      });
      if (json.success) {
        showSnackbar(`规格 ${spec} / ${material} 的单价已更新为 ¥${newPrice}（${json.updated} 条记录）`, 'success');
        await loadCoils();
      } else setError(json.error || '更新失败');
    } catch (err) { setError('更新失败: ' + (err as Error).message); }
  };

  const handleEdit = (coil: CoilRecord) => {
    setEditingId(coil.Id);
    setFormData({
      spec: coil.spec || '', material: coil.material || DEFAULT_COIL_MATERIAL, unitPrice: coil.unitPrice || '', sheets: coil.sheets || '',
      wireWeight: coil.wireWeight || '', copperBase: coil.copperBase || '', coilFee: coil.coilFee || '',
      rotorFee: coil.rotorFee || '', defaultCapacitor: coil.defaultCapacitor || '', defaultWireGauge: coil.defaultWireGauge || ''
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      const url = editingId ? `/api/coils/${editingId}` : '/api/coils';
      const json = await proxyRequest<{ success: boolean; error?: string }>(url, {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify(formData)
      });
      if (json.success) {
        showSnackbar(editingId ? '记录已保存' : '添加成功', 'success');
        setDialogOpen(false); await loadCoils();
      } else setError(json.error || '保存失败');
    } catch (err) { setError('保存失败: ' + (err as Error).message); }
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    try {
      const json = await proxyRequest<{ success: boolean; error?: string }>(`/api/coils/${deleteTarget}`, { method: 'DELETE' });
      if (json.success) {
        showSnackbar('记录已删除', 'info'); await loadCoils();
      } else setError('删除失败');
    } catch (err) { setError('删除失败: ' + (err as Error).message); }
    finally { setDeleteTarget(null); }
  };

  return {
    coils, loading, error, setError,
    copperPrice, copperLoading, copperUpdating, handleCopperUpdate,
    groupedCoils, expandedSpecs, setExpandedSpecs, loadCoils, loadCopperPrice,
    dialogOpen, setDialogOpen, editingId, formData, setFormData,
    deleteTarget, setDeleteTarget, handleAdd, handleEdit, handleSave, confirmDelete,
    autoFillFromSpec, updateSpecPrice
  };
}
