require('dotenv').config();

const required = ['ACCESS_PASSWORD', 'JWT_SECRET', 'INTERNAL_SECRET', 'CORS_ORIGIN', 'SIRI_API_TOKEN'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`生产环境变量缺失: ${missing.join(', ')}`);
  process.exit(1);
}

if (process.env.JWT_SECRET === 'dev_jwt_secret' || process.env.JWT_SECRET === 'fallback_secret') {
  console.error('JWT_SECRET 不能使用开发或历史默认值');
  process.exit(1);
}

const port = Number(process.env.PORT || 3002);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error('PORT 必须是有效端口号');
  process.exit(1);
}

console.log('生产环境变量检查通过');
