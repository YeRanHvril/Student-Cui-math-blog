const JsonStorage = require('../utils/JsonStorage');

const events = new JsonStorage('notify_events');

const NotifyEvent = {
  /**
   * 创建通知事件
   * @param {object} data - { type, slug, title, action }
   *   type: 'article' (文章更新)
   *   action: 'create' | 'update' | 'delete' | 'publish'
   */
  async create(data) {
    const item = {
      type: data.type || 'article',
      action: data.action,
      slug: data.slug || '',
      title: data.title || '',
      createdAt: new Date().toISOString(),
    };
    return events.insertOne(item);
  },

  /**
   * 获取指定时间之后的所有事件
   * @param {string} since - ISO 时间字符串
   */
  async findSince(since) {
    const all = events.find({}, { sort: { createdAt: -1 } });
    if (!since) return all.slice(0, 50); // 默认返回最近50条
    return all.filter((e) => e.createdAt > since);
  },

  /**
   * 获取最新事件
   */
  async getLatest() {
    const all = events.find({}, { sort: { createdAt: -1 }, limit: 1 });
    return all[0] || null;
  },

  /**
   * 清理30天前的事件
   * 直接过滤后一次性写入，避免循环中重复读写文件
   */
  async cleanup() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString();
    const all = events.find({});
    const keep = all.filter((e) => e.createdAt >= cutoffStr);
    const deletedCount = all.length - keep.length;
    if (deletedCount > 0) {
      events._write({ data: keep, nextId: all.nextId || keep.length + 1 });
    }
    return deletedCount;
  },
};

module.exports = NotifyEvent;
