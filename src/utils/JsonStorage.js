const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * JSON 文件存储引擎
 * 提供类似 MongoDB 的 API，数据持久化到本地 JSON 文件
 */
class JsonStorage {
  constructor(collectionName) {
    this.filePath = path.join(DATA_DIR, `${collectionName}.json`);
    this.collectionName = collectionName;
    this._ensureFile();
  }

  _ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ data: [], nextId: 1 }, null, 2));
    }
  }

  _read() {
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    return JSON.parse(raw);
  }

  _write(doc) {
    fs.writeFileSync(this.filePath, JSON.stringify(doc, null, 2));
  }

  _genId() {
    const doc = this._read();
    // 确保 nextId 至少比当前最大 ID 大 1（防止数据被手动编辑后 ID 冲突）
    let maxId = 0;
    for (const item of doc.data) {
      const n = parseInt(item._id, 10);
      if (!isNaN(n) && n > maxId) maxId = n;
    }
    if (doc.nextId <= maxId) {
      doc.nextId = maxId + 1;
    }
    const id = doc.nextId.toString();
    doc.nextId++;
    this._write(doc);
    return id;
  }

  _now() {
    return new Date().toISOString();
  }

  /**
   * 查询所有匹配文档
   */
  find(query = {}, options = {}) {
    const doc = this._read();
    let results = doc.data.filter((item) => this._match(item, query));

    // 排序（支持多字段）
    if (options.sort) {
      const sortEntries = Object.entries(options.sort);
      results.sort((a, b) => {
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

    // 分页
    if (options.skip) {
      results = results.slice(options.skip);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    // select: 排除字段
    if (options.select) {
      const excludeFields = options.select.replace(/^-/, '').split(/\s+/);
      results = results.map((item) => {
        const copy = { ...item };
        excludeFields.forEach((f) => delete copy[f]);
        return copy;
      });
    }

    return results;
  }

  /**
   * 查询单个文档
   */
  findOne(query = {}) {
    const doc = this._read();
    return doc.data.find((item) => this._match(item, query)) || null;
  }

  /**
   * 根据 ID 查询
   */
  findById(id) {
    return this.findOne({ _id: id });
  }

  /**
   * 插入文档
   */
  insertOne(data) {
    const doc = this._read();
    const item = {
      _id: this._genId(),
      ...data,
      createdAt: data.createdAt || this._now(),
      updatedAt: data.updatedAt || this._now(),
    };
    doc.data.push(item);
    this._write(doc);
    return item;
  }

  /**
   * 更新单个文档
   */
  updateOne(query, update) {
    const doc = this._read();
    const idx = doc.data.findIndex((item) => this._match(item, query));
    if (idx === -1) return null;

    const item = doc.data[idx];
    if (update.$set) {
      Object.assign(item, update.$set, { updatedAt: this._now() });
    } else {
      Object.assign(item, update, { updatedAt: this._now() });
    }

    this._write(doc);
    return item;
  }

  /**
   * 根据 ID 更新
   */
  findByIdAndUpdate(id, update) {
    return this.updateOne({ _id: id }, { $set: update });
  }

  /**
   * 删除单个文档
   */
  deleteOne(query) {
    const doc = this._read();
    const idx = doc.data.findIndex((item) => this._match(item, query));
    if (idx === -1) return null;
    const deleted = doc.data.splice(idx, 1)[0];
    this._write(doc);
    return deleted;
  }

  /**
   * 根据 ID 删除
   */
  findByIdAndDelete(id) {
    return this.deleteOne({ _id: id });
  }

  /**
   * 统计数量
   */
  countDocuments(query = {}) {
    const doc = this._read();
    return doc.data.filter((item) => this._match(item, query)).length;
  }

  /**
   * 条件匹配
   */
  _match(item, query) {
    for (const [key, value] of Object.entries(query)) {
      if (key === '$or') {
        return value.some((subQ) => this._match(item, subQ));
      }
      if (key === '$ne') {
        // 顶层不支持，放在子对象中处理
        continue;
      }

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // 操作符匹配: { $in: [...] }, { $ne: ... }
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
}

module.exports = JsonStorage;
