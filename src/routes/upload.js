const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const auth = require('../middleware/auth');

const router = express.Router();

// 上传基础目录
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

// 确保上传根目录存在
if (!fs.existsSync(UPLOADS_ROOT)) {
  fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
}

// 文件类型过滤器
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('只允许上传图片文件（jpeg、jpg、png、gif、webp）'));
  }
};

// 临时存储：先存到 uploads 根目录，再根据 slug/publishDate 移动到目标目录
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_ROOT);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 限制 10MB
  },
});

// POST /api/upload - 上传图片（需要认证）
// 接收字段：image（文件）、slug（可选）、publishDate（可选，格式 YYYY-MM-DD）
router.post('/', auth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ message: '文件大小不能超过 10MB' });
        }
        return res.status(400).json({ message: err.message });
      }
      return res.status(400).json({ message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: '请选择要上传的图片' });
    }

    try {
      const { slug, publishDate } = req.body;
      let targetDir = UPLOADS_ROOT;

      if (slug && !/^[a-zA-Z0-9_-]{1,100}$/.test(slug.trim())) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: '文章标识格式不正确' });
      }

      // 按发布日期组织目录：uploads/YYYY/MM/DD/
      if (publishDate) {
        const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(publishDate);
        if (parts) {
          const [, year, month, day] = parts;
          const parsedDate = new Date(`${publishDate}T00:00:00Z`);
          if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== publishDate) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ message: '发布日期格式不正确' });
          }
          targetDir = path.join(targetDir, year, month, day);
          // 如果有 slug，进一步按 slug 组织：uploads/YYYY/MM/DD/slug/
          if (slug && slug.trim()) {
            targetDir = path.join(targetDir, slug.trim());
          }
        } else {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: '发布日期格式不正确' });
        }
      }

      const resolvedTargetDir = path.resolve(targetDir);
      const uploadsRootWithSeparator = `${path.resolve(UPLOADS_ROOT)}${path.sep}`;
      if (resolvedTargetDir !== path.resolve(UPLOADS_ROOT) && !resolvedTargetDir.startsWith(uploadsRootWithSeparator)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: '非法上传路径' });
      }

      // 创建目标目录
      fs.mkdirSync(targetDir, { recursive: true });

      // 移动文件到目标目录
      const targetPath = path.join(targetDir, req.file.filename);
      fs.renameSync(req.file.path, targetPath);

      // 构建可访问的 URL（相对于 uploads 根目录）
      const relativePath = path.relative(UPLOADS_ROOT, targetPath).replace(/\\/g, '/');
      const imageUrl = `/uploads/${relativePath}`;

      res.json({
        message: '上传成功',
        url: imageUrl,
        filename: req.file.filename,
      });
    } catch (moveErr) {
      console.error('移动上传文件失败:', moveErr);
      // 如果移动失败，尝试清理临时文件
      try { fs.unlinkSync(req.file.path); } catch {}
      res.status(500).json({ message: '文件存储失败' });
    }
  });
});

module.exports = router;
