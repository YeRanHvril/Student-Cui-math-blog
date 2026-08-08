const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { connectDB } = require('./utils/db');
const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const uploadRoutes = require('./routes/upload');
const backupRoutes = require('./routes/backup');
const settingsRoutes = require('./routes/settings');
const miniprogramRoutes = require('./routes/miniprogram');
const apiKeyRoutes = require('./routes/apiKeys');
const publicRoutes = require('./routes/public');

const app = express();

// 中间件配置
app.disable('x-powered-by');

const configuredOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const devOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const corsOptions = configuredOrigins.length > 0
  ? {
      origin(origin, callback) {
        if (!origin || configuredOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('CORS origin not allowed'));
      },
    }
  : process.env.NODE_ENV === 'production'
    ? { origin: false }
    : {
        origin(origin, callback) {
          return callback(null, !origin || devOriginPattern.test(origin));
        },
      };

app.use(cors(corsOptions));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  );
  next();
});
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 静态文件服务 - 提供上传文件访问
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// 路由挂载
app.use('/api/auth', authRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/mp', miniprogramRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/public', publicRoutes);

// 健康检查路由
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 前端静态文件服务（生产环境）
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// SPA 前端路由回退 - 所有非 API 请求返回 index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// 404 处理（仅 API 请求）
app.use('/api', (req, res) => {
  res.status(404).json({ message: '请求的资源不存在' });
});

// 全局错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ message: '服务器内部错误' });
});

// 连接数据库并启动服务器
const PORT = process.env.PORT || 5000;
const jwtSecret = process.env.JWT_SECRET || '';
const weakSecret = jwtSecret.length < 32 || /(secret|change|default|123)/i.test(jwtSecret);
if (process.env.NODE_ENV === 'production' && weakSecret) {
  throw new Error('生产环境必须配置至少 32 位且非默认值的 JWT_SECRET');
}
if (weakSecret) {
  console.warn('安全提示：请将 JWT_SECRET 更换为至少 32 位随机字符串。');
}

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`服务器已启动，运行在 http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('数据库初始化失败:', err);
    process.exit(1);
  });

module.exports = app;
