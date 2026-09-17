const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('共享候选列表脱离滚动容器并保留外部点击检测与定位更新', () => {
  const select = fs.readFileSync('apps/web-next/components/recipe/EditableValueSelect.tsx', 'utf8');
  assert.match(select, /createPortal\(/);
  assert.match(select, /document\.body/);
  assert.match(select, /listboxRef\.current\?\.contains/);
  assert.match(select, /addEventListener\('scroll', updatePosition, true\)/);
  assert.match(select, /className="fixed/);
});
