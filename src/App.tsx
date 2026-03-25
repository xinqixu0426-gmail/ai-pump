import { useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import {
  AppBar,
  Toolbar,
  Typography,
  Tabs,
  Tab,
  Box,
  Container
} from '@mui/material';
import {
  Build as BuildIcon,
  Receipt as ReceiptIcon
} from '@mui/icons-material';
import PartsPage from './pages/PartsPage';
import RecipesPage from './pages/RecipesPage';
import RecipeFormPage from './pages/RecipeFormPage';

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  // 根据当前路径确定选中的 tab
  const getTabValue = (path: string) => {
    if (path === '/') return 0;
    if (path === '/recipes' || path === '/recipe-form') return 1;
    return 0;
  };

  const [tabValue, setTabValue] = useState(getTabValue(location.pathname));

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    switch (newValue) {
      case 0:
        navigate('/');
        break;
      case 1:
        navigate('/recipes');
        break;
    }
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* 顶部导航栏 */}
      <AppBar position="static" elevation={2}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            水泵BOM管理系统
          </Typography>
        </Toolbar>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          textColor="inherit"
          indicatorColor="secondary"
          sx={{ px: 2 }}
        >
          <Tab icon={<BuildIcon />} iconPosition="start" label="零件管理" />
          <Tab icon={<ReceiptIcon />} iconPosition="start" label="配方管理" />
        </Tabs>
      </AppBar>

      {/* 页面内容 */}
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Routes>
          <Route path="/" element={<PartsPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/recipe-form" element={<RecipeFormPage />} />
        </Routes>
      </Container>
    </Box>
  );
}

export default App;