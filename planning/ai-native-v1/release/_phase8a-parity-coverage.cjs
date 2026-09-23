'use strict';

// PHASE 8A — 生产等价回归：证明候选没有丢失生产基线里任何一条测试覆盖。
// 做法：把生产基线 e244bd75 的 tests/ 树导出到临时目录，逐个文件比对
// （a）文件是否仍然存在，（b）每个测试名是否仍然存在。只读，不写候选工作区。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = process.cwd();
const MASTER = 'e244bd75b2e896083a452eede9d6fe0684a6d264';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p8a-master-'));

const git = args => execFileSync('git', args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
git(['archive', MASTER, 'tests', '-o', path.join(scratch, 'tests.tar')]);
execFileSync('tar', ['-xf', path.join(scratch, 'tests.tar'), '-C', scratch]);

function listTestFiles(dir) {
    const out = [];
    const walk = current => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.test.cjs')) out.push(full);
        }
    };
    walk(dir);
    return out;
}

function testNames(file) {
    const src = fs.readFileSync(file, 'utf8');
    const names = [];
    const re = /^\s*test(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gm;
    let m;
    while ((m = re.exec(src))) names.push(m[2]);
    return names;
}

const masterFiles = listTestFiles(path.join(scratch, 'tests'));
const missingFiles = [];
const missingNames = [];
let comparedNames = 0;

for (const masterFile of masterFiles) {
    const rel = path.relative(scratch, masterFile).replace(/\\/g, '/');
    const candidateFile = path.join(ROOT, rel);
    if (!fs.existsSync(candidateFile)) { missingFiles.push(rel); continue; }
    const candidateNames = new Set(testNames(candidateFile));
    for (const name of testNames(masterFile)) {
        comparedNames += 1;
        if (!candidateNames.has(name)) missingNames.push({ file: rel, name });
    }
}

const result = {
    productionTestFiles: masterFiles.length,
    productionTestNamesCompared: comparedNames,
    MISSING_TEST_FILES: missingFiles.length,
    missingFiles,
    MISSING_TEST_NAMES: missingNames.length,
    missingNames: missingNames.slice(0, 40),
};
fs.rmSync(scratch, { recursive: true, force: true });
console.log(JSON.stringify(result, null, 2));
