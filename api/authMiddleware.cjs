/**
 * JWT 认证中间件
 * 从 HttpOnly Cookie 中读取 token 并验证
 */
const jwt = require('jsonwebtoken');

const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' ||
  (process.platform !== 'win32' && process.env.BEHIND_PROXY === 'true') ||
  (process.platform !== 'win32' && process.env.NODE_ENV !== 'development');
const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION ? '' : 'dev_jwt_secret');
if (IS_PRODUCTION && !JWT_SECRET) {
  throw new Error('生产环境必须配置 JWT_SECRET');
}

/**
 * 验证 JWT Token 的 Express 中间件
 * 从 req.cookies.token 中读取 JWT，验证签名和过期时间
 */
function authMiddleware(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ success: false, error: '未授权：请先登录' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // 将解码后的用户信息挂载到 req 上
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: '登录已过期，请重新登录' });
    }
    return res.status(401).json({ success: false, error: '无效的身份凭证' });
  }
}

module.exports = authMiddleware;
