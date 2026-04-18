const fs = require('fs');
const path = require('path');

const srcFile = path.join(__dirname, 'src/pages/PartsPage.tsx');
const componentsDir = path.join(__dirname, 'src/components/parts');
const content = fs.readFileSync(srcFile, 'utf8');

// Ensure directory exists
if (!fs.existsSync(componentsDir)) {
  fs.mkdirSync(componentsDir, { recursive: true });
}

// Split the content by sections
// Example markers:
// const constMarker = '// ─── 常量 & 类别管理 ──────────────────────────────────';
// const catDialogMarker = '// ─── 类别管理弹窗 ─────────────────────────────────────';
// const stockStatusMarker = '// ─── 库存状态 ─────────────────────────────────────────';
// const partFormMarker = '// ─── 零件表单面板 ─────────────────────────────────────';
// const statCardMarker = '// ─── 统计卡片 ─────────────────────────────────────────';
// const partRowMarker = '// ─── 零件行 ───────────────────────────────────────────';
// const mainPageMarker = '// ─── 主页面 ───────────────────────────────────────────';

const importsAndTop = content.substring(0, content.indexOf('// ─── 常量 & 类别管理 ──────────────────────────────────'));

const constContent = content.substring(
  content.indexOf('// ─── 常量 & 类别管理 ──────────────────────────────────'),
  content.indexOf('// ─── 类别管理弹窗 ─────────────────────────────────────')
);

// We need stockStatus function as well to go into partsConstants.ts
const stockStatusContent = content.substring(
  content.indexOf('// ─── 库存状态 ─────────────────────────────────────────'),
  content.indexOf('// ─── 零件表单面板 ─────────────────────────────────────')
);

const catDialogContent = content.substring(
  content.indexOf('// ─── 类别管理弹窗 ─────────────────────────────────────'),
  content.indexOf('// ─── 库存状态 ─────────────────────────────────────────')
);

const partFormContent = content.substring(
  content.indexOf('// ─── 零件表单面板 ─────────────────────────────────────'),
  content.indexOf('// ─── 统计卡片 ─────────────────────────────────────────')
);

// In original, StatCard comes, then PartRow
// // ─── 统计卡片 ─────────────────────────────────────────
// import StatCard from '../components/StatCard';
const partRowContent = content.substring(
  content.indexOf('// ─── 零件行 ───────────────────────────────────────────'),
  content.indexOf('// ─── 主页面 ───────────────────────────────────────────')
);

const mainPageContent = content.substring(
  content.indexOf('// ─── 主页面 ───────────────────────────────────────────')
);

// Create partsConstants.ts
let constantsCode = `import { colors } from '../../utils/theme';\n\n`;
constantsCode += constContent.replace(/export /g, '');
constantsCode += stockStatusContent.replace(/export /g, '');
// Add exports
constantsCode = constantsCode.replace('const BUILTIN_CATEGORIES', 'export const BUILTIN_CATEGORIES');
constantsCode = constantsCode.replace('const BUILTIN_ICONS', 'export const BUILTIN_ICONS');
constantsCode = constantsCode.replace('const BUILTIN_COLORS', 'export const BUILTIN_COLORS');
constantsCode = constantsCode.replace('const CUSTOM_COLOR_POOL', 'export const CUSTOM_COLOR_POOL');
constantsCode = constantsCode.replace('function loadCustomCategories', 'export function loadCustomCategories');
constantsCode = constantsCode.replace('function saveCustomCategories', 'export function saveCustomCategories');
constantsCode = constantsCode.replace('function getCatColor', 'export function getCatColor');
constantsCode = constantsCode.replace('function getCatIcon', 'export function getCatIcon');
constantsCode = constantsCode.replace('function stockStatus', 'export function stockStatus');
fs.writeFileSync(path.join(componentsDir, 'partsConstants.ts'), constantsCode);

// Create CategoryManagerDialog.tsx
let dialogCode = `import { useState } from 'react';
import {
  Box, Typography, Chip, TextField, Button, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, Stack, Tooltip, Divider,
} from '@mui/material';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  Cancel as CancelIcon, Settings as SettingsIcon, Lock as LockIcon, CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { gradients } from '../../utils/theme';
import { BUILTIN_CATEGORIES, BUILTIN_COLORS, BUILTIN_ICONS, CUSTOM_COLOR_POOL, saveCustomCategories } from './partsConstants';\n\n`;
dialogCode += catDialogContent.replace(/function CategoryManagerDialog/, 'export default function CategoryManagerDialog');
fs.writeFileSync(path.join(componentsDir, 'CategoryManagerDialog.tsx'), dialogCode);

// Create PartFormPanel.tsx
let formCode = `import { useState, useEffect, useRef } from 'react';
import {
  Box, Typography, Paper, Chip, TextField, Button, IconButton,
  FormControl, InputLabel, Select, MenuItem, Stack, Tooltip,
  Collapse, InputAdornment, Autocomplete, Switch, FormControlLabel
} from '@mui/material';
import {
  Add as AddIcon, Edit as EditIcon, Save as SaveIcon,
  Cancel as CancelIcon, Inventory as InventoryIcon, Settings as SettingsIcon
} from '@mui/icons-material';
import { Part, PumpShellMeta } from '../../types';
import { colors, gradients } from '../../utils/theme';
import { BUILTIN_CATEGORIES, getCatIcon } from './partsConstants';\n\n`;
formCode += partFormContent.replace(/function PartFormPanel/, 'export default function PartFormPanel');
fs.writeFileSync(path.join(componentsDir, 'PartFormPanel.tsx'), formCode);

// Create PartRow.tsx
let rowCode = `import { Box, Typography, Chip, IconButton, Tooltip, Fade } from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { Part } from '../../types';
import { stockStatus, getCatColor, loadCustomCategories } from './partsConstants';\n\n`;
rowCode += partRowContent.replace(/function PartRow/, 'export default function PartRow');
fs.writeFileSync(path.join(componentsDir, 'PartRow.tsx'), rowCode);

// Rewrite PartsPage.tsx
let newImports = importsAndTop;
// remove the local PartRow etc imports or simply add new ones at the end of imports AndTop
newImports += `import { BUILTIN_CATEGORIES, loadCustomCategories, getCatColor, getCatIcon, stockStatus } from '../components/parts/partsConstants';\n`;
newImports += `import CategoryManagerDialog from '../components/parts/CategoryManagerDialog';\n`;
newImports += `import PartFormPanel from '../components/parts/PartFormPanel';\n`;
newImports += `import PartRow from '../components/parts/PartRow';\n`;

// Include StatCard and MainPage
let restOfPage = `// ─── 统计卡片 ─────────────────────────────────────────
import StatCard from '../components/StatCard';

`;
restOfPage += mainPageContent;

fs.writeFileSync(srcFile, newImports + restOfPage);

console.log('Split completed!');
