const express = require('express');
const Post = require('../models/Post');
const NotifyEvent = require('../models/NotifyEvent');
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
 * 匹配 /uploads/... 和 uploads/... 形式
 */
function absolutizeImages(html, baseUrl) {
  if (!html) return html;
  // 将 src="/uploads/..." 和 src="uploads/..." 转为绝对路径
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

// ========== 接口定义 ==========

/**
 * GET /api/mp/health
 * 健康检查（无需 API Key，用于小程序初始化时验证服务器可达性）
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
 * GET /api/mp/notify/check
 * 文章更新通知检查接口
 * 微信小程序轮询此接口，获取最新文章变更事件
 *
 * 查询参数：
 *   since - ISO 时间字符串，只返回此时间之后的事件（可选）
 *
 * 返回格式：
 *   { code: 0, data: { events: [...], latestTime: "ISO时间" } }
 *
 * 事件结构：
 *   { type: "article", action: "create|update|delete|publish", slug, title, createdAt }
 *
 * 使用方式：
 *   小程序每隔 N 秒请求此接口，传入上次获取到的 latestTime 作为 since 参数
 *   如果返回的 events 非空，则说明有文章更新，小程序应刷新文章列表和详情缓存
 */
router.get('/notify/check', async (req, res) => {
  try {
    const since = req.query.since;
    const events = await NotifyEvent.findSince(since);
    const latest = events.length > 0 ? events[0].createdAt : (await NotifyEvent.getLatest())?.createdAt || null;

    res.json({
      code: 0,
      data: {
        events,
        latestTime: latest,
        hasUpdates: events.length > 0,
      },
    });
  } catch (err) {
    console.error('小程序-通知检查错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

/**
 * GET /api/mp/posts
 * 获取已发布文章列表（精简版，不含 content）
 *
 * 查询参数：
 *   page   - 页码，默认 1
 *   limit  - 每页数量，默认 10，最大 50
 *   tag    - 按标签筛选
 *
 * 返回格式：
 *   { code: 0, data: { posts: [...], pagination: {...} } }
 */
router.get('/posts', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const tag = req.query.tag;

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
    const formattedPosts = posts.map((p) => formatPost(p, baseUrl, false));

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
    console.error('小程序-获取文章列表错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

/**
 * GET /api/mp/posts/:slug
 * 根据 slug 获取单篇文章详情（含完整 content，图片为绝对路径）
 *
 * 返回格式：
 *   { code: 0, data: { post: {...} } }
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
    console.error('小程序-获取文章详情错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

/**
 * GET /api/mp/latest
 * 获取最新文章列表（用于小程序首页，限制数量，不含 content）
 *
 * 查询参数：
 *   limit - 返回数量，默认 5，最大 20
 *
 * 返回格式：
 *   { code: 0, data: { posts: [...] } }
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
    console.error('小程序-获取最新文章错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

/**
 * GET /api/mp/tags
 * 获取所有文章标签列表（用于小程序标签筛选）
 *
 * 返回格式：
 *   { code: 0, data: { tags: [...] } }
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
    console.error('小程序-获取标签列表错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

/**
 * GET /api/mp/projects
 * 获取项目列表（从站点设置中提取，图片为绝对路径）
 *
 * 返回格式：
 *   { code: 0, data: { projects: [...] } }
 */
router.get('/projects', async (req, res) => {
  try {
    const settings = settingsDb.findOne({ _id: '1' });
    const baseUrl = getBaseUrl(req);
    const projects = (settings && settings.projects) || [];

    // 将项目中的图片路径转为绝对路径
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
    console.error('小程序-获取项目列表错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

/**
 * GET /api/mp/settings
 * 获取站点公开设置（仅返回小程序需要的字段）
 *
 * 返回格式：
 *   { code: 0, data: { hero, about, footer } }
 */
router.get('/settings', async (req, res) => {
  try {
    const settings = settingsDb.findOne({ _id: '1' });
    if (!settings) {
      return res.json({ code: 0, data: {} });
    }

    const baseUrl = getBaseUrl(req);
    const data = {};

    // hero 信息（站点标题、副标题等）
    if (settings.hero) {
      data.hero = {
        ...settings.hero,
        avatar: absolutizeUrl(settings.hero.avatar, baseUrl),
      };
    }

    // about 信息
    if (settings.about) {
      data.about = settings.about;
    }

    // footer 信息
    if (settings.footer) {
      data.footer = settings.footer;
    }

    res.json({ code: 0, data });
  } catch (err) {
    console.error('小程序-获取站点设置错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
});

module.exports = router;
