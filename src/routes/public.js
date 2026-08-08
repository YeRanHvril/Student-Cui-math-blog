const express = require('express');
const Post = require('../models/Post');
const JsonStorage = require('../utils/JsonStorage');
const apiKeyAuth = require('../middleware/apiKeyAuth');

const router = express.Router();
const settingsDb = new JsonStorage('settings');

/**
 * 从请求中构建服务器基础 URL
 * 支持反向代理场景（X-Forwarded-Proto / X-Forwarded-Host）
 */
function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost';
  return `${proto}://${host}`;
}

/**
 * 将 HTML 内容中的相对路径图片 URL 转为绝对路径
 */
function absolutizeImages(html, baseUrl) {
  if (!html) return html;
  return html.replace(
    /src=["'](\/?)uploads\/([^"']+)["']/gi,
    (match, slash, rest) => `src="${baseUrl}/uploads/${rest}"`
  );
}

/**
 * 将单个相对路径转为绝对路径
 */
function absolutizeUrl(url, baseUrl) {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/uploads/')) return `${baseUrl}${url}`;
  if (url.startsWith('uploads/')) return `${baseUrl}/${url}`;
  return url;
}

/**
 * 精简文章对象：去掉内部字段，转换图片路径
 * @param {object} post - 原始文章对象
 * @param {string} baseUrl - 服务器基础 URL
 * @param {boolean} includeContent - 是否包含完整内容
 */
function formatPost(post, baseUrl, includeContent = false) {
  const formatted = {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt || '',
    tags: post.tags || [],
    published: post.published,
    publishDate: post.publishDate || '',
    coverImage: absolutizeUrl(post.coverImage, baseUrl),
  };

  if (includeContent && post.content) {
    formatted.content = absolutizeImages(post.content, baseUrl);
  }

  return formatted;
}

/**
 * 获取公开设置数据（去掉内部字段）
 */
function getPublicSettings(baseUrl) {
  const settings = settingsDb.findOne({ _id: '1' });
  if (!settings) return {};

  const { _id, createdAt, updatedAt, ...data } = settings;

  // 转换图片路径为绝对路径
  if (data.hero) {
    data.hero = {
      ...data.hero,
      avatar: absolutizeUrl(data.hero.avatar, baseUrl),
    };
  }
  if (data.projects && Array.isArray(data.projects)) {
    data.projects = data.projects.map((p) => ({
      ...p,
      image: absolutizeUrl(p.image, baseUrl),
      icon: absolutizeUrl(p.icon, baseUrl),
    }));
  }

  return data;
}

// ========== 接口定义 ==========

/**
 * GET /api/public/health
 * 健康检查（无需 API Key）
 */
router.get('/health', (req, res) => {
  res.json({
    code: 0,
    message: 'ok',
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
  });
});

// ========== 以下接口均需要 API Key 认证 ==========
router.use(apiKeyAuth);

/**
 * GET /api/public/posts
 * 获取已发布文章列表
 *
 * 查询参数：
 *   page   - 页码，默认 1
 *   limit  - 每页数量，默认 10，最大 50
 *   tag    - 按标签筛选
 *   content - 是否包含完整内容，默认 false（设为 true 返回完整内容）
 */
router.get('/posts', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const tag = req.query.tag;
    const includeContent = req.query.content === 'true';

    const query = { published: true };
    if (tag) {
      query.tags = { $in: [tag] };
    }

    const total = await Post.countDocuments(query);
    const posts = await Post.find(query, {
      sort: { publishDate: -1, createdAt: -1 },
      skip: (page - 1) * limit,
      limit,
      select: '-content',
    });

    const baseUrl = getBaseUrl(req);
    const formattedPosts = posts.map((p) => formatPost(p, baseUrl, includeContent));

    res.json({
      code: 0,
      data: {
        posts: formattedPosts,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('公开API-获取文章列表错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

/**
 * GET /api/public/posts/:slug
 * 根据 slug 获取单篇文章详情（含完整 content，图片为绝对路径）
 */
router.get('/posts/:slug', async (req, res) => {
  try {
    const post = await Post.findBySlug(req.params.slug);
    if (!post || !post.published) {
      return res.status(404).json({ code: -1, message: '文章不存在或未发布' });
    }

    const baseUrl = getBaseUrl(req);
    const formattedPost = formatPost(post, baseUrl, true);

    res.json({
      code: 0,
      data: { post: formattedPost },
    });
  } catch (err) {
    console.error('公开API-获取文章详情错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

/**
 * GET /api/public/latest
 * 获取最新文章列表
 *
 * 查询参数：
 *   limit - 返回数量，默认 5，最大 20
 */
router.get('/latest', async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));

    const posts = await Post.find(
      { published: true },
      {
        sort: { publishDate: -1, createdAt: -1 },
        limit,
        select: '-content',
      }
    );

    const baseUrl = getBaseUrl(req);
    const formattedPosts = posts.map((p) => formatPost(p, baseUrl, false));

    res.json({
      code: 0,
      data: { posts: formattedPosts },
    });
  } catch (err) {
    console.error('公开API-获取最新文章错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

/**
 * GET /api/public/tags
 * 获取所有文章标签列表
 */
router.get('/tags', async (req, res) => {
  try {
    const posts = await Post.find({ published: true }, { select: '-content' });
    const tagSet = new Set();
    posts.forEach((p) => {
      if (p.tags && Array.isArray(p.tags)) {
        p.tags.forEach((t) => tagSet.add(t));
      }
    });

    res.json({
      code: 0,
      data: { tags: Array.from(tagSet).sort() },
    });
  } catch (err) {
    console.error('公开API-获取标签列表错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

/**
 * GET /api/public/projects
 * 获取项目列表
 */
router.get('/projects', async (req, res) => {
  try {
    const settings = settingsDb.findOne({ _id: '1' });
    const baseUrl = getBaseUrl(req);
    const projects = (settings && settings.projects) || [];

    const formattedProjects = projects.map((p) => ({
      ...p,
      image: absolutizeUrl(p.image, baseUrl),
      icon: absolutizeUrl(p.icon, baseUrl),
    }));

    res.json({
      code: 0,
      data: { projects: formattedProjects },
    });
  } catch (err) {
    console.error('公开API-获取项目列表错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

/**
 * GET /api/public/settings
 * 获取站点公开设置
 */
router.get('/settings', async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req);
    const data = getPublicSettings(baseUrl);
    res.json({ code: 0, data });
  } catch (err) {
    console.error('公开API-获取站点设置错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

/**
 * GET /api/public/all
 * 一次性获取所有公开数据（文章列表含完整内容、设置、标签、项目）
 *
 * 查询参数：
 *   limit - 文章数量限制，默认 50，最大 200
 */
router.get('/all', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const baseUrl = getBaseUrl(req);

    // 并行获取所有数据
    const [posts, total, settings] = await Promise.all([
      Post.find(
        { published: true },
        {
          sort: { publishDate: -1, createdAt: -1 },
          limit,
        }
      ),
      Post.countDocuments({ published: true }),
      Promise.resolve(getPublicSettings(baseUrl)),
    ]);

    // 提取标签
    const tagSet = new Set();
    posts.forEach((p) => {
      if (p.tags && Array.isArray(p.tags)) {
        p.tags.forEach((t) => tagSet.add(t));
      }
    });

    // 格式化文章（包含完整内容）
    const formattedPosts = posts.map((p) => formatPost(p, baseUrl, true));

    // 提取项目
    const projects = (settings.projects) || [];

    res.json({
      code: 0,
      data: {
        posts: formattedPosts,
        pagination: {
          total,
          returned: formattedPosts.length,
          limit,
        },
        tags: Array.from(tagSet).sort(),
        projects,
        settings,
      },
    });
  } catch (err) {
    console.error('公开API-获取所有数据错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

module.exports = router;
