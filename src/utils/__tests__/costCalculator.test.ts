import { describe, it, expect } from 'vitest';
import { buildPartsIndex, calculateRecipeCost, RecipePartForCalc } from '../costCalculator';
import { Part } from '../../types';

describe('costCalculator', () => {
  const sampleParts: Part[] = [
    { Id: 1, model: 'A', supplier: 'S1', price: 10, category: '测试', stock: 10 },
    { Id: 2, model: 'A', supplier: 'S2', price: 12, category: '测试', stock: 10 },
    { Id: 3, model: 'B', supplier: 'S1', price: 5, category: '测试', stock: 10 },
  ];

  describe('buildPartsIndex', () => {
    it('正确构建精确匹配和型号回退索引', () => {
      const { partsCache, partsByModel } = buildPartsIndex(sampleParts);
      
      expect(partsCache.get('A||S1')?.price).toBe(10);
      expect(partsCache.get('A||S2')?.price).toBe(12);
      expect(partsCache.get('B||S1')?.price).toBe(5);

      expect(partsByModel.get('A')).toHaveLength(2);
      expect(partsByModel.get('B')).toHaveLength(1);
    });
  });

  describe('calculateRecipeCost', () => {
    const { partsCache, partsByModel } = buildPartsIndex(sampleParts);

    it('精确匹配：价格应为匹配供应商的价格', () => {
      const parts: RecipePartForCalc[] = [{ model: 'A', name: 'A件', supplier: 'S2', qty: 2 }];
      const result = calculateRecipeCost(parts, partsCache, partsByModel);
      
      expect(result.totalCost).toBe('24.00'); // 12 * 2
      expect(result.missingParts).toHaveLength(0);
      expect(result.details[0].source).toBe('精确匹配');
      expect(result.details[0].supplier).toBe('S2');
    });

    it('型号回退：获取全库同型号价格最低的配件', () => {
      // 供应商 S3 不存在，应该回退取 S1(10元)
      const parts: RecipePartForCalc[] = [{ model: 'A', name: 'A件', supplier: 'S3', qty: 3 }];
      const result = calculateRecipeCost(parts, partsCache, partsByModel);
      
      expect(result.totalCost).toBe('30.00'); // 10 * 3
      expect(result.details[0].source).toMatch(/^型号回退/);
      expect(result.details[0].price).toBe('10.00');
    });

    it('找不到的零件：单价算0', () => {
      const parts: RecipePartForCalc[] = [{ model: 'C', name: 'C件', supplier: 'S1', qty: 1 }];
      const result = calculateRecipeCost(parts, partsCache, partsByModel);
      
      expect(result.totalCost).toBe('0.00');
      expect(result.missingParts).toContain('C');
      expect(result.details[0].source).toBe('未找到');
    });

    it('计算 snapshot 属性，与传递的 snapshotTotalCost 互动', () => {
      const parts: RecipePartForCalc[] = [{ model: 'A', name: 'A件', supplier: 'S1', qty: 1, snapshotPrice: 9.5 }];
      const result = calculateRecipeCost(parts, partsCache, partsByModel, 20);
      
      expect(result.totalCost).toBe('10.00'); // db 当前价 10
      expect(result.snapshotTotalCost).toBe('20');
      expect(result.details[0].snapshotPrice).toBe('9.50');
      expect(result.details[0].snapshotSubtotal).toBe('9.50');
    });

    it('空配方返回 0', () => {
      const result = calculateRecipeCost([], partsCache, partsByModel);
      expect(result.totalCost).toBe('0.00');
      expect(result.itemCount).toBe(0);
    });
  });
});
