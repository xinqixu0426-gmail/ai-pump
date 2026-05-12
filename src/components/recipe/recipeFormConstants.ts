export const COIL_API_BASE = '';

export interface CoilCalcResult {
  spec: string;
  material?: string;
  sheets: number;
  unitPrice: number;
  wireWeight: number;
  copperBase: number;
  coilFee: number;
  rotorFee: number;
  totalCost: number;
  formula: string;
  source: string;
  isCustomWireWeight: boolean;
  wireGauge: string | null;
  capacitor: string | null;
}

export interface CoilSpecInfo {
  spec: string;
  material?: string;
  materials?: string[];
  unitPrice: string;
  sheets: number[];
  count: number;
}
