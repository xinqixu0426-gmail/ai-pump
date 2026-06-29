import { Part } from '../types';
import { CoilCalcResult } from '../components/recipe/recipeFormConstants';
import { DEFAULT_COIL_MATERIAL, capacitorValueFromModel } from './businessRules';

export function buildCoilCalculateBody(input: {
  spec: string;
  material: string;
  sheets: string;
  customWeight?: string;
}) {
  const body: Record<string, unknown> = {
    spec: input.spec,
    material: input.material || DEFAULT_COIL_MATERIAL,
    sheets: parseInt(input.sheets),
  };
  if (input.customWeight) body.wireWeight = parseFloat(input.customWeight);
  return body;
}

export function resolveCoilLinkedSelections(input: {
  coilResult: CoilCalcResult;
  floatWireOptions: string[];
  cableWireOptions: string[];
  parts: Part[];
}) {
  const { coilResult, floatWireOptions, cableWireOptions, parts } = input;
  const nextFloatWire = coilResult.wireGauge && floatWireOptions.includes(coilResult.wireGauge)
    ? coilResult.wireGauge
    : undefined;
  const nextCableWire = coilResult.wireGauge && cableWireOptions.includes(coilResult.wireGauge)
    ? coilResult.wireGauge
    : undefined;

  let capacitorModel = '';
  const capValue = capacitorValueFromModel(coilResult.capacitor || '');
  if (capValue != null) {
    const capParts = parts.filter(p => p.category === '电容');
    const exact = capParts.find(p => p.model === `${capValue}μF`);
    const fuzzy = exact || capParts.find(p => capacitorValueFromModel(p.model) === capValue);
    capacitorModel = fuzzy?.model || '';
  }

  return { nextFloatWire, nextCableWire, capacitorModel };
}
