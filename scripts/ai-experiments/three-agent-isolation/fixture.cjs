'use strict';

// Deliberately minimal isolated formal identity fixture; it has no prices, stock, or write surface.
const FIXTURE = Object.freeze({
    recipes: Object.freeze([
        Object.freeze({ id: 'recipe-v750-general', name: 'V750-通用款' }),
        Object.freeze({ id: 'recipe-v750-haobei', name: 'V750-豪贝款' }),
        Object.freeze({ id: 'recipe-v550-general', name: 'V550-通用款' }),
    ]),
    coils: Object.freeze([
        Object.freeze({ id: 'coil-12-120-steel', designation: '12-120', name: '12-120 钢带小眼' }),
        Object.freeze({ id: 'coil-12-120-cold', designation: '12-120', name: '12-120 冷轧国标眼' }),
    ]),
    templates: Object.freeze([
        Object.freeze({ id: 'template-general', name: '通用款' }),
        Object.freeze({ id: 'template-haobei', name: '豪贝款' }),
    ]),
    parts: Object.freeze([Object.freeze({ id: 'part-bearing', name: '轴承-202' })]),
});
module.exports = { FIXTURE };
