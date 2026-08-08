const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const BACKUPS_DIR = path.join(__dirname, '..', '..', 'backups');

/**
 * 确保目录存在
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 从文章数据中提取所有本地图片路径
 * 包括 content 中的 <img src="/uploads/xxx"> 和 coverImage
 */
function extractImagePaths(post) {
  const paths = new Set();

  // 从 content 中提取 <img src="/uploads/xxx">
  if (post.content) {
    const imgRegex = /src=["'](\/uploads\/[^"']+)["']/g;
    let match;
    while ((match = imgRegex.exec(post.content)) !== null) {
      paths.add(match[1]);
    }
  }

  // 从 coverImage 中提取本地路径
  if (post.coverImage && post.coverImage.startsWith('/uploads/')) {
    paths.add(post.coverImage);
  }

  return Array.from(paths);
}

/**
 * 将 /uploads/xxx 转换为本地文件系统路径
 */
function toLocalPath(urlPath) {
  const filename = urlPath.replace('/uploads/', '');
  const root = path.resolve(UPLOADS_DIR);
  const resolved = path.resolve(root, filename);
  if (!resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

/**
 * 创建备份 ZIP
 * @param {Object} post - 文章数据
 * @returns {AdmZip} ZIP 实例
 */
function createBackupZip(post) {
  const zip = new AdmZip();

  // 添加文章元数据（排除 _id，恢复时由系统决定）
  const articleData = { ...post };
  zip.addFile('article.json', Buffer.from(JSON.stringify(articleData, null, 2), 'utf-8'));

  // 提取并添加图片
  const imagePaths = extractImagePaths(post);
  for (const imgPath of imagePaths) {
    const localPath = toLocalPath(imgPath);
    if (localPath && fs.existsSync(localPath)) {
      const filename = path.basename(localPath);
      zip.addLocalFile(localPath, 'images', filename);
    }
  }

  return zip;
}

/**
 * 保存自动备份到 backups 目录
 * @param {Object} post - 文章数据
 * @returns {string} 备份文件路径
 */
function saveAutoBackup(post) {
  ensureDir(BACKUPS_DIR);
  const postBackupDir = path.join(BACKUPS_DIR, post._id.toString());
  ensureDir(postBackupDir);

  const zip = createBackupZip(post);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(postBackupDir, `${timestamp}.zip`);
  zip.writeZip(backupPath);

  // 保留最近 10 个备份
  cleanupOldBackups(postBackupDir, 10);

  return backupPath;
}

/**
 * 清理旧备份，只保留最近 N 个
 */
function cleanupOldBackups(dir, keepCount) {
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => ({
      name: f,
      time: fs.statSync(path.join(dir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time);

  for (let i = keepCount; i < files.length; i++) {
    fs.unlinkSync(path.join(dir, files[i].name));
  }
}

/**
 * 保存命名备份到 backups 根目录
 * 文件名格式：slug-N.zip，N 为自增序号
 * @param {Object} post - 文章数据
 * @returns {string} 备份文件路径
 */
function saveNamedBackup(post) {
  ensureDir(BACKUPS_DIR);

  const rawSlug = post.slug || post._id.toString();
  const slug = /^[a-zA-Z0-9_-]{1,100}$/.test(rawSlug) ? rawSlug : `post-${post._id}`;
  // 查找该 slug 已存在的备份序号
  const existingFiles = fs.readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith(`${slug}-`) && f.endsWith('.zip'))
    .map((f) => {
      const match = f.match(new RegExp(`^${slug}-(\\d+)\\.zip$`));
      return match ? parseInt(match[1], 10) : 0;
    });

  const nextNum = existingFiles.length > 0 ? Math.max(...existingFiles) + 1 : 1;
  const filename = `${slug}-${nextNum}.zip`;
  const backupPath = path.join(BACKUPS_DIR, filename);

  const zip = createBackupZip(post);
  zip.writeZip(backupPath);

  return backupPath;
}

/**
 * 从 ZIP Buffer 恢复文章
 * @param {Buffer} zipBuffer - ZIP 文件内容
 * @returns {Object} 文章数据
 */
function restoreFromZip(zipBuffer) {
  const MAX_ENTRY_COUNT = 200;
  const MAX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024;
  const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  if (entries.length === 0 || entries.length > MAX_ENTRY_COUNT) {
    throw new Error('备份文件条目数量异常');
  }

  let totalSize = 0;
  for (const entry of entries) {
    const entryName = String(entry.entryName || '').replace(/\\/g, '/');
    const normalizedName = path.posix.normalize(entryName);
    if (normalizedName.startsWith('../') || normalizedName.startsWith('/') || normalizedName.includes('/../')) {
      throw new Error('备份文件包含非法路径');
    }
    totalSize += Number(entry.header?.size || 0);
    if (totalSize > MAX_UNCOMPRESSED_SIZE) {
      throw new Error('备份解压后体积不能超过 50MB');
    }
  }

  const articleEntry = entries.find((entry) => entry.entryName === 'article.json' && !entry.isDirectory);
  if (!articleEntry) throw new Error('备份文件无效：缺少 article.json');

  const post = JSON.parse(articleEntry.getData().toString('utf-8'));
  if (!post || typeof post !== 'object' || Array.isArray(post)) throw new Error('文章数据格式无效');
  if (typeof post.title !== 'string' || post.title.length < 1 || post.title.length > 300) {
    throw new Error('文章标题格式无效');
  }
  if (typeof post.content !== 'string' || post.content.length > 5 * 1024 * 1024) {
    throw new Error('文章内容格式无效');
  }
  if (!/^\d+$/.test(String(post._id || ''))) throw new Error('文章 ID 格式无效');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(String(post.slug || ''))) {
    throw new Error('文章标识格式无效');
  }

  ensureDir(UPLOADS_DIR);
  for (const entry of entries) {
    if (entry.isDirectory || !entry.entryName.startsWith('images/')) continue;
    const filename = path.posix.basename(entry.entryName);
    const extension = path.extname(filename).toLowerCase();
    if (!/^[a-zA-Z0-9._-]{1,180}$/.test(filename) || !ALLOWED_IMAGE_EXTENSIONS.has(extension)) continue;
    const data = entry.getData();
    if (data.length > 10 * 1024 * 1024) throw new Error('备份中的单张图片不能超过 10MB');
    const destination = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, data, { flag: 'wx' });
  }

  return post;
}

module.exports = {
  createBackupZip,
  saveAutoBackup,
  saveNamedBackup,
  restoreFromZip,
  extractImagePaths,
  BACKUPS_DIR,
  UPLOADS_DIR,
};
