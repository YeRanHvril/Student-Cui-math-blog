const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const Post = require('../models/Post');
const { createBackupZip, saveAutoBackup, saveNamedBackup, restoreFromZip, BACKUPS_DIR } = require('../utils/backup');

const router = express.Router();

// 使用内存存储上传 ZIP 文件，并限制体积与类型，避免压缩包导致内存耗尽。
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    const isZipName = /\.zip$/i.test(file.originalname || '');
    const allowedMime = new Set(['application/zip', 'application/x-zip-compressed', 'application/octet-stream']);
    callback(isZipName && allowedMime.has(file.mimetype) ? null : new Error('只允许上传 ZIP 备份文件'), isZipName && allowedMime.has(file.mimetype));
  },
});

const BACKUPS_ROOT = path.resolve(BACKUPS_DIR);

function resolveBackupDir(postId) {
  if (!/^\d+$/.test(String(postId || ''))) return null;
  const target = path.resolve(BACKUPS_ROOT, String(postId));
  return target.startsWith(`${BACKUPS_ROOT}${path.sep}`) ? target : null;
}

function resolveBackupZip(postId, filename) {
  if (!/^\d+$/.test(String(postId || '')) || !/^[a-zA-Z0-9._-]+\.zip$/.test(String(filename || ''))) {
    return null;
  }
  const target = path.resolve(BACKUPS_ROOT, String(postId), String(filename));
  return target.startsWith(`${BACKUPS_ROOT}${path.sep}`) ? target : null;
}

/**
 * GET /api/posts/:id/backup
 * 导出备份 ZIP（手动下载）
 */
router.get('/:id/backup', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: '文章不存在' });
    }

    const zip = createBackupZip(post);
    const filename = `backup-${post.slug || post._id}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zip.toBuffer());
  } catch (err) {
    console.error('导出备份错误:', err);
    res.status(500).json({ message: '导出备份失败' });
  }
});

/**
 * POST /api/posts/:id/backup
 * 自动备份（保存到服务器 backups 目录）
 */
router.post('/:id/backup', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: '文章不存在' });
    }

    const backupPath = saveAutoBackup(post);
    res.json({ message: '备份成功', path: backupPath });
  } catch (err) {
    console.error('自动备份错误:', err);
    res.status(500).json({ message: '备份失败' });
  }
});

/**
 * POST /api/posts/:id/named-backup
 * 创建命名备份（slug-N.zip，保存到 backups 根目录）
 */
router.post('/:id/named-backup', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: '文章不存在' });
    }

    const backupPath = saveNamedBackup(post);
    const filename = path.basename(backupPath);
    res.json({ message: '命名备份创建成功', filename, path: backupPath });
  } catch (err) {
    console.error('命名备份错误:', err);
    res.status(500).json({ message: '备份创建失败' });
  }
});

/**
 * POST /api/posts/restore
 * 恢复备份（上传 ZIP）
 */
router.post('/restore', auth, upload.single('backup'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请选择备份文件' });
    }

    const force = req.body.force === 'true';
    const post = restoreFromZip(req.file.buffer);

    // 检查 ID 是否冲突
    const existingPost = await Post.findById(post._id);
    if (existingPost && !force) {
      return res.status(409).json({
        message: '该文章已存在',
        existing: {
          _id: existingPost._id,
          title: existingPost.title,
          slug: existingPost.slug,
        },
        backup: {
          _id: post._id,
          title: post.title,
          slug: post.slug,
        },
      });
    }

    if (existingPost && force) {
      // 覆盖更新：保留原有 slug 和 createdAt，更新其他字段
      const updateData = {
        title: post.title,
        content: post.content,
        excerpt: post.excerpt,
        tags: post.tags,
        published: post.published,
        coverImage: post.coverImage,
        publishDate: post.publishDate,
        // 保留原有不可变字段
        slug: existingPost.slug,
        createdAt: existingPost.createdAt,
      };
      await Post.findByIdAndUpdate(post._id, updateData);
      const updated = await Post.findById(post._id);
      return res.json({ message: '文章恢复成功（已覆盖）', post: updated });
    }

    // ID 不存在：新建文章（保留备份中的 _id）
    const newPost = await Post.create({
      _id: post._id,
      slug: post.slug || `restored-${Date.now()}`,
      title: post.title,
      content: post.content,
      excerpt: post.excerpt,
      tags: post.tags || [],
      published: post.published || false,
      coverImage: post.coverImage || '',
      publishDate: post.publishDate,
    });
    return res.json({ message: '文章恢复成功（已新建）', post: newPost });
  } catch (err) {
    console.error('恢复备份错误:', err);
    res.status(500).json({ message: err.message || '恢复备份失败' });
  }
});

/**
 * GET /api/posts/:id/backups
 * 获取自动备份历史列表
 */
router.get('/:id/backups', auth, async (req, res) => {
  try {
    const postBackupDir = resolveBackupDir(req.params.id);
    if (!postBackupDir) return res.status(400).json({ message: '文章 ID 格式不正确' });
    if (!fs.existsSync(postBackupDir)) {
      return res.json({ backups: [] });
    }

    const files = fs.readdirSync(postBackupDir)
      .filter((f) => f.endsWith('.zip'))
      .map((f) => {
        const stat = fs.statSync(path.join(postBackupDir, f));
        return {
          filename: f,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ backups: files });
  } catch (err) {
    console.error('获取备份列表错误:', err);
    res.status(500).json({ message: '获取备份列表失败' });
  }
});

/**
 * GET /api/backups
 * 备份总览：列出所有文章及其备份历史
 */
router.get('/', auth, async (req, res) => {
  try {
    const posts = await Post.find({});
    const result = [];

    for (const post of posts) {
      const postBackupDir = path.join(BACKUPS_DIR, post._id.toString());
      const backups = [];
      if (fs.existsSync(postBackupDir)) {
        const files = fs.readdirSync(postBackupDir)
          .filter((f) => f.endsWith('.zip'))
          .map((f) => {
            const stat = fs.statSync(path.join(postBackupDir, f));
            return {
              filename: f,
              size: stat.size,
              sizeFormatted: formatSize(stat.size),
              createdAt: stat.mtime.toISOString(),
            };
          })
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        backups.push(...files);
      }
      result.push({
        _id: post._id,
        title: post.title,
        slug: post.slug,
        publishDate: post.publishDate || '',
        published: post.published || false,
        backups,
      });
    }

    res.json({ articles: result });
  } catch (err) {
    console.error('获取备份总览错误:', err);
    res.status(500).json({ message: '获取备份列表失败' });
  }
});

/**
 * GET /api/backups/storage-stats
 * 获取备份存储统计信息
 */
router.get('/storage-stats', auth, async (req, res) => {
  try {
    const posts = await Post.find({});
    let totalSize = 0;
    let totalBackups = 0;
    const articleStats = [];

    for (const post of posts) {
      const postBackupDir = path.join(BACKUPS_DIR, post._id.toString());
      let size = 0;
      let count = 0;
      if (fs.existsSync(postBackupDir)) {
        const files = fs.readdirSync(postBackupDir).filter((f) => f.endsWith('.zip'));
        count = files.length;
        for (const f of files) {
          try { size += fs.statSync(path.join(postBackupDir, f)).size; } catch { /* skip */ }
        }
      }
      totalSize += size;
      totalBackups += count;
      if (count > 0) {
        articleStats.push({
          postId: post._id,
          title: post.title,
          slug: post.slug,
          backupCount: count,
          totalSize: size,
          sizeFormatted: formatSize(size),
        });
      }
    }

    articleStats.sort((a, b) => b.totalSize - a.totalSize);

    res.json({
      totalSize,
      totalSizeFormatted: formatSize(totalSize),
      totalBackups,
      articleCount: posts.length,
      articlesWithBackups: articleStats.length,
      topArticles: articleStats.slice(0, 10),
    });
  } catch (err) {
    console.error('获取存储统计错误:', err);
    res.status(500).json({ message: '获取统计信息失败' });
  }
});

/**
 * GET /api/backups/:postId/:filename/download
 * 下载指定备份文件
 */
router.get('/:postId/:filename/download', auth, async (req, res) => {
  try {
    const { postId, filename } = req.params;
    const targetPath = resolveBackupZip(postId, filename);
    if (!targetPath) return res.status(403).json({ message: '非法路径' });
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ message: '备份文件不存在' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const fileStream = fs.createReadStream(targetPath);
    fileStream.pipe(res);
  } catch (err) {
    console.error('下载备份错误:', err);
    res.status(500).json({ message: '下载备份失败' });
  }
});

/**
 * POST /api/backups/restore-file
 * 从服务器备份文件一键恢复（通过 postId + filename 定位，不接受任意路径）
 */
router.post('/restore-file', auth, async (req, res) => {
  try {
    const { postId, filename } = req.body;
    if (!postId || !filename) {
      return res.status(400).json({ message: '缺少文章 ID 或文件名' });
    }

    // 安全构建路径，防止路径穿越
    const targetPath = resolveBackupZip(postId, filename);
    if (!targetPath) return res.status(403).json({ message: '非法路径' });
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ message: '备份文件不存在' });
    }

    const zipBuffer = fs.readFileSync(targetPath);
    const post = restoreFromZip(zipBuffer);

    const existingPost = await Post.findById(post._id);
    if (existingPost) {
      const updateData = {
        title: post.title,
        content: post.content,
        excerpt: post.excerpt,
        tags: post.tags,
        published: post.published,
        coverImage: post.coverImage,
        publishDate: post.publishDate,
        slug: existingPost.slug,
        createdAt: existingPost.createdAt,
      };
      await Post.findByIdAndUpdate(post._id, updateData);
      const updated = await Post.findById(post._id);
      return res.json({ message: '文章恢复成功（已覆盖）', post: updated });
    }

    const newPost = await Post.create({
      _id: post._id,
      slug: post.slug || `restored-${Date.now()}`,
      title: post.title,
      content: post.content,
      excerpt: post.excerpt,
      tags: post.tags || [],
      published: post.published || false,
      coverImage: post.coverImage || '',
      publishDate: post.publishDate,
    });
    return res.json({ message: '文章恢复成功（已新建）', post: newPost });
  } catch (err) {
    console.error('一键恢复备份错误:', err);
    res.status(500).json({ message: err.message || '恢复备份失败' });
  }
});

/**
 * DELETE /api/backups/:postId/:filename
 * 删除指定备份文件
 */
router.delete('/:postId/:filename', auth, async (req, res) => {
  try {
    const { postId, filename } = req.params;
    const targetPath = resolveBackupZip(postId, filename);
    if (!targetPath) return res.status(403).json({ message: '非法路径' });
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ message: '备份文件不存在' });
    }

    fs.unlinkSync(targetPath);
    res.json({ message: '备份已删除' });
  } catch (err) {
    console.error('删除备份错误:', err);
    res.status(500).json({ message: '删除备份失败' });
  }
});

/**
 * POST /api/backups/batch-delete
 * 批量删除备份文件
 * body: { items: [{ postId, filename }] }
 */
router.post('/batch-delete', auth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: '请选择要删除的备份' });
    }

    let deleted = 0;
    let failed = 0;

    for (const item of items) {
      const { postId, filename } = item;
      if (!postId || !filename) { failed++; continue; }

      const targetPath = resolveBackupZip(postId, filename);
      if (!targetPath) { failed++; continue; }
      if (!fs.existsSync(targetPath)) { failed++; continue; }

      try {
        fs.unlinkSync(targetPath);
        deleted++;
      } catch {
        failed++;
      }
    }

    res.json({ message: `已删除 ${deleted} 个备份`, deleted, failed });
  } catch (err) {
    console.error('批量删除备份错误:', err);
    res.status(500).json({ message: '批量删除失败' });
  }
});

/**
 * POST /api/backups/cleanup
 * 一键清理：每篇文章只保留最近 N 个备份
 * body: { keepCount?: number } 默认 5
 */
router.post('/cleanup', auth, async (req, res) => {
  try {
    const keepCount = Math.max(1, Math.min(parseInt(req.body.keepCount) || 5, 50));

    const posts = await Post.find({});
    let totalDeleted = 0;
    const details = [];

    for (const post of posts) {
      const postBackupDir = path.join(BACKUPS_DIR, post._id.toString());
      if (!fs.existsSync(postBackupDir)) continue;

      const files = fs.readdirSync(postBackupDir)
        .filter((f) => f.endsWith('.zip'))
        .map((f) => ({
          name: f,
          time: fs.statSync(path.join(postBackupDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time);

      if (files.length <= keepCount) continue;

      const toDelete = files.slice(keepCount);
      for (const file of toDelete) {
        try {
          fs.unlinkSync(path.join(postBackupDir, file.name));
          totalDeleted++;
        } catch { /* skip */ }
      }
      details.push({
        postId: post._id,
        title: post.title,
        before: files.length,
        after: files.length - toDelete.length,
        deleted: toDelete.length,
      });
    }

    res.json({ message: `清理完成，共删除 ${totalDeleted} 个备份`, totalDeleted, keepCount, details });
  } catch (err) {
    console.error('清理备份错误:', err);
    res.status(500).json({ message: '清理失败' });
  }
});

/**
 * POST /api/backups/create-multiple
 * 批量为选中文章创建备份
 * body: { postIds: string[] }
 */
router.post('/create-multiple', auth, async (req, res) => {
  try {
    const { postIds } = req.body;
    if (!Array.isArray(postIds) || postIds.length === 0) {
      return res.status(400).json({ message: '请选择文章' });
    }

    let success = 0;
    let failed = 0;
    const results = [];

    for (const postId of postIds) {
      try {
        const post = await Post.findById(postId);
        if (!post) { failed++; results.push({ postId, error: '文章不存在' }); continue; }
        const backupPath = saveAutoBackup(post);
        success++;
        results.push({ postId, title: post.title, path: backupPath });
      } catch (err) {
        failed++;
        results.push({ postId, error: err.message });
      }
    }

    res.json({ message: `已为 ${success} 篇文章创建备份`, success, failed, results });
  } catch (err) {
    console.error('批量创建备份错误:', err);
    res.status(500).json({ message: '批量备份失败' });
  }
});

/**
 * 格式化文件大小
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: '备份文件不能超过 25MB' });
  }
  if (err) return res.status(400).json({ message: err.message || '备份文件无效' });
  next();
});

module.exports = router;
