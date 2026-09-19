require('dotenv').config();

const { validateProductionEnvironment } = require('../api/services/environment.cjs');
const errors = validateProductionEnvironment();
if (errors.length > 0) {
  errors.forEach(error => console.error(error));
  process.exit(1);
}

console.log('生产环境变量检查通过');
