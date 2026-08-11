import type { Part } from './parts';

const TEMPLATE_PART_CATEGORY_RULES: Array<{
  category: string;
  keywords: string[];
}> = [
  { category: '轴承', keywords: ['轴承'] },
  { category: '油封', keywords: ['机械油封', '骨架油封', '油封', '机封', '骨架封'] },
  { category: '螺丝', keywords: ['螺丝', '螺栓', '螺钉', '螺母'] },
  { category: '皮垫', keywords: ['皮垫', '密封垫', '垫片', '垫圈'] },
  { category: '电容', keywords: ['电容'] },
  { category: '电缆线', keywords: ['电缆', '电线'] },
  { category: '浮球', keywords: ['浮球'] },
  { category: '线圈转子', keywords: ['线圈转子', '线圈', '转子'] },
  { category: '泵壳', keywords: ['整套泵壳', '泵壳套件', '泵壳'] },
  { category: '泵壳搭配', keywords: ['上帽', '花板', '机筒', '油缸', '泵头', '叶轮', '底座', '法兰'] },
  { category: '配件', keywords: ['铭牌', '护套', '插头', '配件'] },
];

export function templatePartCategoryForName(name: string): string | null {
  const normalized = name.trim();
  if (!normalized) return null;
  return TEMPLATE_PART_CATEGORY_RULES.find((rule) => (
    rule.keywords.some((keyword) => normalized.includes(keyword))
  ))?.category || null;
}

export function templatePartCatalogForName(parts: Part[], name: string): Part[] {
  const category = templatePartCategoryForName(name);
  return parts.filter((part) => (
    part.category !== '包装'
    && (!category || part.category === category)
  ));
}

