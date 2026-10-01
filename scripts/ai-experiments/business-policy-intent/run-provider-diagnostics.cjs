'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { diagnoseProvider } = require('./providerDiagnostics.cjs');

const root = path.resolve(__dirname, '../../..');
const outputArgument = process.argv.slice(2).find(value => value.startsWith('--output='));
const output = outputArgument
    ? path.resolve(root, outputArgument.slice('--output='.length))
    : path.join(root, 'planning/business-understanding/M4-3A-R2-Provider-Diagnostics.json');

const keepAlive = setInterval(() => {}, 1_000);
diagnoseProvider().then(result => {
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
}).catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
}).finally(() => clearInterval(keepAlive));
