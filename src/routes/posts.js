const express = require('express');
const { body, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const Post = require('../models/Post');
const NotifyEvent = require('../models/NotifyEvent');
const auth = require('../middleware/auth');

const router = express.Router();

// 上传根目录
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

/**
 * 获取文章图片所在的目录路径
 * @param {string} publishDate - YYYY-MM-DD 格式
 * @param {string} slug - 文章 slug
 * @returns {string|null} 目录绝对路径，或 null
 */
function getUploadDir(publishDate, slug) {
  if (!publishDate) return null;
  const parts = publishDate.split('-');
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  if (slug) {
    return path.join(UPLOADS_ROOT, year, month, day, slug);
  }
  return path.join(UPLOADS_ROOT, year, month, day);
}

/**
 * 移动文章图片到新日期目录，并更新 URL
 * @param {string} oldDate - 旧发布日期 YYYY-MM-DD
 * @param {string} newDate - 新发布日期 YYYY-MM-DD
 * @param {string} slug - 文章 slug
 * @param {string} content - 文章内容 HTML
 * @param {string} coverImage - 封面图片 URL
 * @returns {{content: string, coverImage: string}} 更新后的内容
 */
function relocateArticleImages(oldDate, newDate, slug, content, coverImage) {
  const oldDir = getUploadDir(oldDate, slug);
  const newDir = getUploadDir(newDate, slug);
  if (!oldDir || !newDir || oldDir === newDir) {
    return { content, coverImage };
  }

  // 如果旧目录不存在，直接返回
  if (!fs.existsSync(oldDir)) {
    return { content, coverImage };
  }

  // 确保新目录存在
  fs.mkdirSync(newDir, { recursive: true });

  // 读取旧目录中的所有文件（排除子目录）
  const files = fs.readdirSync(oldDir).filter((f) => {
    const stat = fs.statSync(path.join(oldDir, f));
    return stat.isFile();
  });

  // 移动文件
  const urlReplacements = [];
  for (const filename of files) {
    const oldPath = path.join(oldDir, filename);
    const newPath = path.join(newDir, filename);
    fs.renameSync(oldPath, newPath);

    // 计算 URL 变化
    const oldRelative = path.relative(UPLOADS_ROOT, oldPath).replace(/\\/g, '/');
    const newRelative = path.relative(UPLOADS_ROOT, newPath).replace(/\\/g, '/');
    urlReplacements.push({
      oldUrl: `/uploads/${oldRelative}`,
      newUrl: `/uploads/${newRelative}`,
    });
  }

  // 尝试清理旧目录的空父目录（逐层向上）
  try {
    let currentDir = oldDir;
    while (currentDir !== UPLOADS_ROOT && fs.existsSync(currentDir)) {
      const entries = fs.readdirSync(currentDir);
      if (entries.length === 0) {
        fs.rmdirSync(currentDir);
        currentDir = path.dirname(currentDir);
      } else {
        break;
      }
    }
  } catch (cleanupErr) {
    // 清理失败不影响主流程
  }

  // 更新 content 和 coverImage 中的 URL
  let newContent = content || '';
  let newCoverImage = coverImage || '';
  for (const { oldUrl, newUrl } of urlReplacements) {
    newContent = newContent.replaceAll(oldUrl, newUrl);
    if (newCoverImage === oldUrl) {
      newCoverImage = newUrl;
    }
  }

  return { content: newContent, coverImage: newCoverImage };
}

/**
 * 生成唯一 slug：YYYYMMDD + 8位随机字母数字
 * 自动循环去重直到生成不重复的值
 */
function generateUniqueSlug(existingSlugs) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const set = new Set(existingSlugs);
  let slug;
  do {
    let rand = '';
    for (let i = 0; i < 8; i++) rand += chars[Math.floor(Math.random() * chars.length)];
    slug = dateStr + rand;
  } while (set.has(slug));
  return slug;
}

// GET /api/posts - 获取文章列表（公开）
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, tag } = req.query;
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 10, 100));

    const query = {};
    if (tag) {
      query.tags = { $in: [tag] };
    }
    // 公开列表始终只返回已发布文章；后台使用受保护的 /all 接口。
    query.published = true;

    const total = await Post.countDocuments(query);
    const posts = await Post.find(query, {
      sort: { publishDate: -1, createdAt: -1 },
      skip: (safePage - 1) * safeLimit,
      limit: safeLimit,
      select: '-content',
    });

    res.json({
      posts,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    });
  } catch (err) {
    console.error('获取文章列表错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

// GET /api/posts/all - 获取所有文章（管理员，需要认证）
// 注意：此路由必须放在 /:slug 之前，否则 Express 会将其匹配为 slug='all'
router.get('/all', auth, async (req, res) => {
  try {
    const posts = await Post.find({}, { sort: { publishDate: -1, createdAt: -1 }, select: '-content' });
    res.json({ posts });
  } catch (err) {
    console.error('获取所有文章错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

// GET /api/posts/id/:id - 根据 ID 获取单篇文章（需要认证）
// 注意：此路由必须放在 /:slug 之前
router.get('/id/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post || !post.published) {
      return res.status(404).json({ message: '文章不存在' });
    }
    res.json({ post });
  } catch (err) {
    console.error('获取文章错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

// GET /api/posts/:slug - 根据 slug 获取单篇文章（公开）
// 注意：此参数路由必须放在所有具体路由之后，否则会拦截 /all、/id/:id 等路径
router.get('/:slug', async (req, res) => {
  try {
    const post = await Post.findBySlug(req.params.slug);
    if (!post) {
      return res.status(404).json({ message: '文章不存在' });
    }
    res.json({ post });
  } catch (err) {
    console.error('获取文章错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

// POST /api/posts - 创建文章（需要认证）
router.post(
  '/',
  auth,
  [
    body('title').notEmpty().withMessage('标题不能为空'),
    body('content').notEmpty().withMessage('内容不能为空'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { title, content, excerpt, tags, published, coverImage, publishDate } = req.body;

      // 自动生成唯一 slug（忽略前端传的 slug）
      const allPosts = await Post.find({});
      const allSlugs = allPosts.map((p) => p.slug);
      const slug = generateUniqueSlug(allSlugs);

      const post = await Post.create({
        title,
        content,
        excerpt: excerpt || content.replace(/<[^>]*>/g, '').substring(0, 200),
        slug,
        tags: tags || [],
        coverImage: coverImage || '',
        published: published || false,
        publishDate: publishDate || new Date().toISOString().split('T')[0],
      });

      res.status(201).json({ message: '文章创建成功', post });

      // 触发通知事件（通知小程序有新文章）
      NotifyEvent.create({
        type: 'article',
        action: published ? 'publish' : 'create',
        slug: post.slug,
        title: post.title,
      }).catch((e) => console.error('创建通知事件失败:', e));
    } catch (err) {
      console.error('创建文章错误:', err);
      res.status(500).json({ message: '服务器内部错误' });
    }
  }
);

// PUT /api/posts/:id - 更新文章（需要认证）
router.put('/:id', auth, async (req, res) => {
  try {
    const { title, content, excerpt, tags, published, coverImage, publishDate } = req.body;

    // 先获取旧文章数据，用于判断是否需要移动图片
    const oldPost = await Post.findById(req.params.id);
    if (!oldPost) {
      return res.status(404).json({ message: '文章不存在' });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (excerpt !== undefined) updateData.excerpt = excerpt;
    // slug 不允许修改，始终使用创建时自动生成的值
    if (tags !== undefined) updateData.tags = tags;
    if (published !== undefined) updateData.published = published;

    // 如果发布日期变更，需要移动 uploads 中的图片到新目录
    // 始终使用数据库中的内容进行 URL 替换，确保所有图片路径都被正确更新
    let finalContent = content;
    let finalCoverImage = coverImage;
    if (publishDate !== undefined && publishDate !== oldPost.publishDate) {
      // 1) 基于数据库内容做 URL 替换，得到路径更新后的内容
      const relocated = relocateArticleImages(
        oldPost.publishDate,
        publishDate,
        oldPost.slug,
        oldPost.content,
        oldPost.coverImage
      );
      // 2) 如果前端同时提交了新的 content，需要对新 content 也做同样的 URL 替换
      if (content !== undefined) {
        // 对前端提交的内容，替换所有旧路径到新路径
        const oldUrlPrefix = `/uploads/${oldPost.publishDate.replace(/-/g, '/')}/${oldPost.slug}/`;
        const newUrlPrefix = `/uploads/${publishDate.replace(/-/g, '/')}/${oldPost.slug}/`;
        finalContent = content.replaceAll(oldUrlPrefix, newUrlPrefix);
        finalCoverImage = coverImage !== undefined
          ? coverImage.replace(oldUrlPrefix, newUrlPrefix)
          : relocated.coverImage;
      } else {
        finalContent = relocated.content;
        finalCoverImage = relocated.coverImage;
      }
      updateData.publishDate = publishDate;
    } else if (publishDate !== undefined) {
      updateData.publishDate = publishDate;
    }

    if (finalContent !== undefined) updateData.content = finalContent;
    if (finalCoverImage !== undefined) updateData.coverImage = finalCoverImage;

    const post = await Post.findByIdAndUpdate(req.params.id, updateData);

    res.json({ message: '文章更新成功', post });

    // 触发通知事件（通知小程序文章已更新）
    NotifyEvent.create({
      type: 'article',
      action: 'update',
      slug: oldPost.slug,
      title: title || oldPost.title,
    }).catch((e) => console.error('创建通知事件失败:', e));
  } catch (err) {
    console.error('更新文章错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

// DELETE /api/posts/:id - 删除文章（需要认证）
router.delete('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findByIdAndDelete(req.params.id);
    if (!post) {
      return res.status(404).json({ message: '文章不存在' });
    }
    res.json({ message: '文章删除成功' });

    // 触发通知事件（通知小程序文章已删除）
    NotifyEvent.create({
      type: 'article',
      action: 'delete',
      slug: post.slug,
      title: post.title,
    }).catch((e) => console.error('创建通知事件失败:', e));
  } catch (err) {
    console.error('删除文章错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

module.exports = router;
