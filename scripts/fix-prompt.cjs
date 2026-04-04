const fs = require('fs');
let f = fs.readFileSync('api.cjs', 'utf8');

// Fix the broken system prompt PUT: find the bad line and replace everything through the stale code
const badPattern = `db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('ai-system-prompt', ?)").run(prompt););`;
const badIdx = f.indexOf(badPattern);
if (badIdx === -1) {
    console.log('Pattern not found, maybe already fixed');
    process.exit(0);
}

// Find the end of the stale block (the closing "}")
const afterBad = f.indexOf('\n', badIdx + badPattern.length);
// Find lines: "} else {" ... "}" after that
let endIdx = afterBad;
let braceCount = 0;
let foundElse = false;
for (let i = afterBad; i < f.length; i++) {
    if (f.substring(i, i + 6) === '} else') foundElse = true;
    if (f[i] === '{') braceCount++;
    if (f[i] === '}') {
        braceCount--;
        if (foundElse && braceCount <= -2) {
            endIdx = f.indexOf('\n', i + 1);
            break;
        }
    }
}

const before = f.substring(0, badIdx);
const after = f.substring(endIdx);
const fixed = before + `db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('ai-system-prompt', ?)").run(prompt);` + after;

fs.writeFileSync('api.cjs', fixed);
console.log('Fixed! Removed stale NocoDB code from system prompt handler');
