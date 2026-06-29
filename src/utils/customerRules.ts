import { Customer, CustomerInput, Quotation } from '../types';
import { DEFAULT_QUOTATION_MARGIN } from './businessRules';

export interface CustomerQuotationStats {
  count: number;
  totalPrice: number;
  latest: Date | null;
}

export function defaultCustomerInput(): CustomerInput {
  return { name: '', contactInfo: '', defaultMargin: DEFAULT_QUOTATION_MARGIN, remark: '' };
}

export function customerInputFromCustomer(customer: Customer): CustomerInput {
  return {
    name: customer.name,
    contactInfo: customer.contactInfo || '',
    defaultMargin: Number.isFinite(Number(customer.defaultMargin)) ? Number(customer.defaultMargin) : DEFAULT_QUOTATION_MARGIN,
    remark: customer.remark || '',
  };
}

export function updateCustomerDefaultMargin(form: CustomerInput, value: string): CustomerInput {
  const parsed = Number.parseFloat(value);
  return {
    ...form,
    defaultMargin: Number.isFinite(parsed) ? parsed : 0,
  };
}

export function quotationsForCustomer(quotations: Quotation[], customerId: number | null): Quotation[] {
  if (customerId == null) return [];
  return quotations.filter(quotation => quotation.customerId === customerId);
}

export function quotationCountByCustomer(quotations: Quotation[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const quotation of quotations) {
    counts.set(quotation.customerId, (counts.get(quotation.customerId) || 0) + 1);
  }
  return counts;
}

export function calculateCustomerQuotationStats(quotations: Quotation[]): CustomerQuotationStats {
  const totalPrice = quotations.reduce((sum, quotation) => sum + Number(quotation.totalPrice || 0), 0);
  const latest = quotations
    .map(quotation => (quotation.CreatedAt ? new Date(quotation.CreatedAt) : null))
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;

  return { count: quotations.length, totalPrice, latest };
}

export function quotationStatusColor(status: string): 'success' | 'info' | 'default' {
  if (status === '已接受') return 'success';
  if (status === '已转订单') return 'info';
  return 'default';
}
