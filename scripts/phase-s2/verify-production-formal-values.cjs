'use strict';
const fs = require('node:fs');
const env = fs.readFileSync('/Users/dan/pump-cost-accounting-system/.env', 'utf8').split('\n')
    .reduce((acc, line) => { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) acc[m[1]] = m[2]; return acc; }, {});
(async () => {
    const login = await fetch('http://127.0.0.1:3104/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: env.PUMP_OWNER_ACCESS_PASSWORD }) });
    const cookie = 'token=' + ((login.headers.get('set-cookie') || '').match(/token=([^;]+)/) || [])[1];
    const headers = { cookie, 'content-type': 'application/json' };
    const costs = await (await fetch('http://127.0.0.1:3002/api/recipes/current-costs', { headers })).json();
    const rows = Array.isArray(costs) ? costs : (Array.isArray(costs.data) ? costs.data : []);
    console.log('current-costs shape:', JSON.stringify(costs).slice(0, 240));
    console.log('current-costs:', JSON.stringify(rows.map(r => ({ name: r.name || r.recipeName, cost: r.currentTotalCost ?? r.totalCost ?? r.cost }))));
    const diff = await (await fetch('http://127.0.0.1:3002/api/cost/recipe-difference', { method: 'POST', headers, body: JSON.stringify({ leftRecipeName: 'V550大脚板-2寸-经典款', rightRecipeName: 'V750大脚板-2寸-经典款', limit: 5 }) })).json();
    const d = diff.data || diff;
    console.log('recipe-difference:', JSON.stringify({ left: d.left && d.left.totalCost, right: d.right && d.right.totalCost, totalDiff: d.totalDiff, direction: d.direction }));
    const coils = await (await fetch('http://127.0.0.1:3002/api/coils?spec=12&sheets=120', { headers })).json();
    const coil = (Array.isArray(coils) ? coils : (coils.data || []))[0];
    console.log('coil 12-120:', JSON.stringify({ schemeCode: coil && coil.schemeCode, cost: coil && coil.cost, stock: coil && coil.stock }));
})();
