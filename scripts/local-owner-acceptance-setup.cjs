#!/usr/bin/env node
// 本地验收环境：合规启用 owner（本机可逆、不碰生产）
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const ROOT = 'C:\\Users\\Dan\\Documents\\pump-canary-s2';
const ENV = path.join(ROOT, '.env');

// 不写 .env 备份：本脚本只做幂等的键写入（自己即可重放），
// 而 .env 备份会把整套密钥以明文落到工作区，风险大于收益。
let text = fs.readFileSync(ENV, 'utf8');
console.log('未创建 .env 备份（脚本幂等，避免明文密钥落盘）');

// 生成 owner 凭据（>=32 字符，且不得等于 ACCESS_PASSWORD）
const ownerPw = crypto.randomBytes(24).toString('base64url'); // 32 chars
const subject = 'local_owner_subject_0001';

function setLine(t, key, value) {
  const re = new RegExp('^' + key + '=.*$', 'm');
  const line = key + '=' + value;
  if (re.test(t)) return t.replace(re, line);
  return t.replace(/\s*$/, '\n') + line + '\n';
}

const access = (text.match(/^ACCESS_PASSWORD=(.*)$/m) || [])[1];
if (!access) throw new Error('ACCESS_PASSWORD 缺失');
if (ownerPw === access) throw new Error('owner 密码不得等于 ACCESS_PASSWORD');

text = setLine(text, 'PUMP_OWNER_ACCESS_PASSWORD', ownerPw);
text = setLine(text, 'PUMP_OWNER_SUBJECT', subject);
text = setLine(text, 'AI_V5_OWNER_SUBJECTS', '["' + subject + '"]');
text = setLine(text, 'AI_NATIVE_MODE', 'owner');
text = setLine(text, 'AI_NATIVE_WRITE_ENABLED', 'false');

fs.writeFileSync(ENV, text, 'utf8');

// 立刻校验 ownerConfigValid
require('dotenv').config({ path: ENV, override: true });
const { ownerConfigValid, issueOwnerToken } = require(path.join(ROOT, 'api', 'services', 'ownerAuthentication.cjs'));
console.log('ownerConfigValid = ' + ownerConfigValid(process.env));
const token = issueOwnerToken(ownerPw, process.env);
console.log('issueOwnerToken   = ' + (token ? 'OK (' + token.length + ' chars)' : 'NULL'));
if (!token) process.exit(1);

// 输出 owner token 供复跑脚本使用（只写本地临时文件，不进仓库）
fs.writeFileSync(path.join(ROOT, '_owner-token.local'), token, 'utf8');
console.log('owner token 已写入 _owner-token.local');
console.log('AI_NATIVE_MODE=owner, AI_NATIVE_WRITE_ENABLED=false');
