const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const POSTS_DIR = path.join(DATA_DIR, 'posts');
const INDEX_FILE = path.join(POSTS_DIR, '_index.json');

// 确保目录和索引文件存在
if (!fs.existsSync(POSTS_DIR)) {
  fs.mkdirSync(POSTS_DIR, { recursive: true });
}
if (!fs.existsSync(INDEX_FILE)) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify({ posts: [], nextId: 1 }, null, 2));
}

// ========== 内部工具函数 ==========

function readIndex() {
  const raw = fs.readFileSync(INDEX_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeIndex(idx) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2));
}

function readPostFile(slug) {
  const filePath = path.join(POSTS_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function writePostFile(post) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(String(post.slug || ''))) {
    throw new Error('文章 slug 格式不正确');
  }
  const filePath = path.join(POSTS_DIR, `${post.slug}.json`);
  fs.writeFileSync(filePath, JSON.stringify(post, null, 2));
}

function deletePostFile(slug) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(String(slug || ''))) return;
  const filePath = path.join(POSTS_DIR, `${slug}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// 条件匹配（与 JsonStorage 保持一致的简化版）
function matchItem(item, query) {
  for (const [key, value] of Object.entries(query)) {
    if (key === '$or') {
      return value.some((subQ) => matchItem(item, subQ));
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [op, opVal] of Object.entries(value)) {
        if (op === '$in') {
          if (!opVal.includes(item[key])) return false;
        } else if (op === '$ne') {
          if (item[key] === opVal) return false;
        } else if (op === '$gt') {
          if (!(item[key] > opVal)) return false;
        } else if (op === '$gte') {
          if (!(item[key] >= opVal)) return false;
        } else if (op === '$lt') {
          if (!(item[key] < opVal)) return false;
        } else if (op === '$lte') {
          if (!(item[key] <= opVal)) return false;
        }
      }
    } else {
      if (item[key] !== value) return false;
    }
  }
  return true;
}

// 从完整文章生成索引条目（去掉 content 等大字段）
function toIndexEntry(post) {
  const { content, ...rest } = post;
  return rest;
}

// 应用查询选项（sort, skip, limit, select）
function applyOptions(results, options = {}) {
  let out = [...results];

  if (options.sort) {
    const sortEntries = Object.entries(options.sort);
    out.sort((a, b) => {
      for (const [field, order] of sortEntries) {
        const av = a[field];
        const bv = b[field];
        if (av === bv) continue;
        if (order === -1) return bv > av ? 1 : -1;
        return av > bv ? 1 : -1;
      }
      return 0;
    });
  }

  if (options.skip) {
    out = out.slice(options.skip);
  }
  if (options.limit) {
    out = out.slice(0, options.limit);
  }

  if (options.select) {
    const excludeFields = options.select.replace(/^-/, '').split(/\s+/);
    out = out.map((item) => {
      const copy = { ...item };
      excludeFields.forEach((f) => delete copy[f]);
      return copy;
    });
  }

  return out;
}

// ========== 对外 API ==========

const Post = {
  /**
   * 查找文章列表
   * 优先从索引读取（不含 content），如需 content 会自动加载对应文件
   */
  async find(query = {}, options = {}) {
    const idx = readIndex();
    const matched = idx.posts.filter((item) => matchItem(item, query));
    const results = applyOptions(matched, options);

    // 如果没有排除 content，则需要读取完整文件
    const needContent = !options.select || !options.select.includes('-content');
    if (needContent) {
      return results.map((entry) => {
        const full = readPostFile(entry.slug);
        return full || entry;
      });
    }

    return results;
  },

  /**
   * 查找单个文章（返回完整内容）
   */
  async findOne(query) {
    const idx = readIndex();
    const entry = idx.posts.find((item) => matchItem(item, query));
    if (!entry) return null;
    return readPostFile(entry.slug);
  },

  /**
   * 根据 ID 查找
   */
  async findById(id) {
    return this.findOne({ _id: id.toString() });
  },

  /**
   * 根据 slug 查找
   */
  async findBySlug(slug) {
    return this.findOne({ slug });
  },

  /**
   * 创建文章
   */
  async create(data) {
    const idx = readIndex();
    const now = new Date().toISOString();

    // 生成 ID
    let maxId = 0;
    for (const item of idx.posts) {
      const n = parseInt(item._id, 10);
      if (!isNaN(n) && n > maxId) maxId = n;
    }
    if (idx.nextId <= maxId) {
      idx.nextId = maxId + 1;
    }
    const id = idx.nextId.toString();
    idx.nextId++;

    const post = {
      _id: id,
      ...data,
      createdAt: data.createdAt || now,
      updatedAt: now,
    };

    // 写入文章文件
    writePostFile(post);

    // 更新索引
    idx.posts.push(toIndexEntry(post));
    writeIndex(idx);

    return post;
  },

  /**
   * 根据 ID 更新
   */
  async findByIdAndUpdate(id, update) {
    const idx = readIndex();
    const strId = id.toString();
    const idxPos = idx.posts.findIndex((p) => p._id === strId);
    if (idxPos === -1) return null;

    const oldEntry = idx.posts[idxPos];
    const fullPost = readPostFile(oldEntry.slug);
    if (!fullPost) return null;

    const now = new Date().toISOString();
    const updated = { ...fullPost, ...update, updatedAt: now };

    // 如果 slug 变化，需要删除旧文件、创建新文件（当前设计 slug 不可变，此处做兼容）
    if (updated.slug !== oldEntry.slug) {
      deletePostFile(oldEntry.slug);
    }
    writePostFile(updated);

    // 更新索引
    idx.posts[idxPos] = toIndexEntry(updated);
    writeIndex(idx);

    return updated;
  },

  /**
   * 根据 ID 删除
   */
  async findByIdAndDelete(id) {
    const idx = readIndex();
    const strId = id.toString();
    const idxPos = idx.posts.findIndex((p) => p._id === strId);
    if (idxPos === -1) return null;

    const entry = idx.posts[idxPos];

    // 删除文章文件
    deletePostFile(entry.slug);

    // 更新索引
    const deleted = idx.posts.splice(idxPos, 1)[0];
    writeIndex(idx);

    return deleted;
  },

  /**
   * 统计数量
   */
  async countDocuments(query = {}) {
    const idx = readIndex();
    return idx.posts.filter((item) => matchItem(item, query)).length;
  },
};

module.exports = Post;
