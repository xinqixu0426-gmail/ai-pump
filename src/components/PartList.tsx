import { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Box,
  Chip,
  TextField,
  Pagination,
  Collapse,
  Button,
  Typography
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Search as SearchIcon
} from '@mui/icons-material';
import { Part } from '../types';

interface PartListProps {
  parts: Part[];
  onEdit: (part: Part) => void;
  onDelete: (id: number) => void;
}

const ITEMS_PER_PAGE = 20;

export default function PartList({ parts, onEdit, onDelete }: PartListProps) {
  // 搜索关键词
  const [searchQuery, setSearchQuery] = useState('');

  // 过滤后的零件
  const filteredParts = useMemo(() => {
    if (!searchQuery.trim()) return parts;
    const query = searchQuery.toLowerCase();
    return parts.filter(
      (part) =>
        (part.型号 || part.model || '').toLowerCase().includes(query) ||
        (part.供应商 || part.supplier || '').toLowerCase().includes(query) ||
        (part.类别 || part.category || '').toLowerCase().includes(query)
    );
  }, [parts, searchQuery]);

  // 按类别分组
  const groupedParts = useMemo(() => {
    const groups = filteredParts.reduce((acc, part) => {
      const category = part.类别 || part.category || '未分类';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(part);
      return acc;
    }, {} as Record<string, Part[]>);

    // 按类别名称排序
    const sortedKeys = Object.keys(groups).sort();
    return sortedKeys.reduce((acc, key) => {
      acc[key] = groups[key];
      return acc;
    }, {} as Record<string, Part[]>);
  }, [filteredParts]);

  // 折叠状态（默认展开）
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    () => new Set()
  );

  // 每类别的分页状态
  const [pageByCategory, setPageByCategory] = useState<Record<string, number>>(
    {}
  );

  // 切换折叠状态
  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // 展开/折叠全部
  const expandAll = () => setCollapsedCategories(new Set());
  const collapseAll = () =>
    setCollapsedCategories(new Set(Object.keys(groupedParts)));

  // 处理分页变化
  const handlePageChange = (category: string, page: number) => {
    setPageByCategory((prev) => ({ ...prev, [category]: page }));
  };

  if (parts.length === 0) {
    return (
      <Box textAlign="center" py={4} color="text.secondary">
        暂无零件数据
      </Box>
    );
  }

  return (
    <Box>
      {/* 搜索栏 */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <TextField
          size="small"
          placeholder="搜索型号、供应商或类别..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
          }}
          sx={{ flex: 1 }}
        />
        <Button
          size="small"
          variant="outlined"
          onClick={expandAll}
          startIcon={<ExpandMoreIcon />}
        >
          展开全部
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={collapseAll}
          startIcon={<ExpandLessIcon />}
        >
          折叠全部
        </Button>
      </Box>

      {/* 结果统计 */}
      {searchQuery && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          找到 {filteredParts.length} 个零件
          {filteredParts.length !== parts.length && `（共 ${parts.length} 个）`}
        </Typography>
      )}

      {/* 零件列表 */}
      {Object.keys(groupedParts).length === 0 ? (
        <Box textAlign="center" py={4} color="text.secondary">
          未找到匹配的零件
        </Box>
      ) : (
        Object.entries(groupedParts).map(([category, categoryParts]) => {
          const isCollapsed = collapsedCategories.has(category);
          const currentPage = pageByCategory[category] || 1;
          const totalPages = Math.ceil(categoryParts.length / ITEMS_PER_PAGE);
          const paginatedParts = categoryParts.slice(
            (currentPage - 1) * ITEMS_PER_PAGE,
            currentPage * ITEMS_PER_PAGE
          );

          return (
            <Box key={category} mb={2}>
              {/* 类别标题 */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  bgcolor: 'primary.main',
                  color: 'white',
                  px: 2,
                  py: 1,
                  borderRadius: '4px 4px 0 0',
                  cursor: 'pointer'
                }}
                onClick={() => toggleCategory(category)}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    label={category}
                    size="small"
                    sx={{
                      bgcolor: 'white',
                      color: 'primary.main',
                      fontWeight: 'bold'
                    }}
                  />
                  <Typography variant="body2">
                    共 {categoryParts.length} 个零件
                  </Typography>
                </Box>
                <IconButton size="small" sx={{ color: 'white' }}>
                  {isCollapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
                </IconButton>
              </Box>

              {/* 类别内容 */}
              <Collapse in={!isCollapsed}>
                <TableContainer
                  component={Paper}
                  variant="outlined"
                  sx={{ borderRadius: '0 0 4px 4px' }}
                >
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ backgroundColor: 'grey.100' }}>
                        <TableCell>型号</TableCell>
                        <TableCell>单价</TableCell>
                        <TableCell>供应商</TableCell>
                        <TableCell align="center">库存</TableCell>
                        <TableCell align="center" sx={{ width: '120px' }}>
                          操作
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {paginatedParts.map((part) => (
                        <TableRow key={part.Id} hover>
                          <TableCell>{part.型号 || part.model}</TableCell>
                          <TableCell>
                            ¥{(part.单价 || part.price || 0).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            {part.供应商 || part.supplier || '-'}
                          </TableCell>
                          <TableCell align="center">
                            <Chip
                              label={part.库存 ?? part.stock ?? 0}
                              size="small"
                              color={(part.库存 ?? part.stock ?? 0) === 0 ? 'error' : (part.库存 ?? part.stock ?? 0) <= 5 ? 'warning' : 'success'}
                              variant="outlined"
                              sx={{ fontWeight: 600, minWidth: 40 }}
                            />
                          </TableCell>
                          <TableCell align="center">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => onEdit(part)}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => onDelete(part.Id)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* 分页 */}
                  {totalPages > 1 && (
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        py: 2,
                        borderTop: '1px solid',
                        borderColor: 'divider'
                      }}
                    >
                      <Pagination
                        size="small"
                        count={totalPages}
                        page={currentPage}
                        onChange={(_, page) => handlePageChange(category, page)}
                        showFirstButton
                        showLastButton
                      />
                    </Box>
                  )}
                </TableContainer>
              </Collapse>
            </Box>
          );
        })
      )}
    </Box>
  );
}
