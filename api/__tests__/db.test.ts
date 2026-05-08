import { describe, it, expect } from 'vitest';
// @ts-ignore
import { calculateRecipeCost } from '../db.cjs';


describe('db.cjs - calculateRecipeCost', () => {
  const partsCache = {};
  const partsByModel: Record<string, any[]>  = {
    'A': [
      { id: 1, supplier: 'S1', price: 10 },
      { id: 2, supplier: 'S2', price: 12 }
    ],
    'B': [
      { id: 3, supplier: 'S1', price: 5 }
    ]
  };

  it('精确匹配：匹配 supplier 取值', () => {
    const parts = [{ model: 'A', name: 'A件', supplier: 'S2', qty: 2 }];
    const result = calculateRecipeCost(parts, partsCache, partsByModel);

    expect(result.totalCost).toBe('24.00'); // 12 * 2
    expect(result.details[0].source).toBe('精确匹配');
    expect(result.details[0].price).toBe('12.00');
    expect(result.missingParts).toHaveLength(0);
  });

  it('型号回退：无匹配 supplier 则取该型号中价格最低的', () => {
    const parts = [{ model: 'A', name: 'A件', supplier: 'S3', qty: 3 }];
    const result = calculateRecipeCost(parts, partsCache, partsByModel);

    expect(result.totalCost).toBe('30.00'); // 10 * 3
    expect(result.details[0].source).toBe('型号回退(取最低价)');
    expect(result.details[0].price).toBe('10.00');
  });

  it('未找到：型号不存在则计0', () => {
    const parts = [{ model: 'C', name: 'C件', supplier: 'S1', qty: 2 }];
    const result = calculateRecipeCost(parts, partsCache, partsByModel);

    expect(result.totalCost).toBe('0.00');
    expect(result.missingParts).toContain('C');
    expect(result.details[0].source).toBe('未找到');
  });

  it('同时存在找到和未找到', () => {
    const parts = [
      { model: 'A', name: 'A件', supplier: 'S1', qty: 1 },
      { model: 'C', name: 'C件', supplier: '', qty: 1 }
    ];
    const result = calculateRecipeCost(parts, partsCache, partsByModel);

    expect(result.totalCost).toBe('10.00');
    expect(result.itemCount).toBe(2);
    expect(result.missingParts).toContain('C');
  });

  it('uses cable part notes as the cable accessory fee baseline', () => {
    const pbm: Record<string, any[]> = {
      '电缆-线径0.55': [
        { id: 10, supplier: '-', price: 2, notes: JSON.stringify({ cableAccessoryFee: 3.5 }) }
      ],
      '电缆配件费': [
        { id: 11, supplier: '-', price: 9 }
      ]
    };
    const parts = [
      { model: '电缆-线径0.55', name: '电缆线', supplier: '', qty: 10 },
      { model: '电缆配件费', name: '电缆接头配件', supplier: '', qty: 1 }
    ];

    const result = calculateRecipeCost(parts, {}, pbm);

    expect(result.totalCost).toBe('23.50');
    expect(result.details[1].price).toBe('3.50');
    expect(result.details[1].source).toBe('电缆线配件费');
  });
});
