const crypto = require('crypto');
const JsonStorage = require('../utils/JsonStorage');

const keys = new JsonStorage('api_keys');

const ApiKey = {
  /**
   * 生成随机 API Key
   * 格式：sk- + 32位随机十六进制字符
   */
  generateKey() {
    return 'sk-' + crypto.randomBytes(16).toString('hex');
  },

  /**
   * 创建新的 API Key
   */
  async create(data) {
    const key = this.generateKey();
    const item = {
      name: data.name || '未命名',
      key,
      status: 'active', // active | disabled
      callCount: 0,
      lastUsedAt: null,
      // 按天统计调用次数 { "2026-07-29": 5 }
      dailyStats: {},
      // 按接口统计调用次数 { "/api/mp/posts": 10 }
      endpointStats: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return keys.insertOne(item);
  },

  /**
   * 根据 key 字符串查找
   */
  async findByKey(keyString) {
    return keys.findOne({ key: keyString });
  },

  /**
   * 根据 ID 查找
   */
  async findById(id) {
    return keys.findById(id);
  },

  /**
   * 获取所有 Key
   */
  async findAll() {
    return keys.find({}, { sort: { createdAt: -1 } });
  },

  /**
   * 更新 Key
   */
  async findByIdAndUpdate(id, update) {
    return keys.findByIdAndUpdate(id, update);
  },

  /**
   * 删除 Key
   */
  async findByIdAndDelete(id) {
    return keys.findByIdAndDelete(id);
  },

  /**
   * 记录一次 API 调用
   * @param {string} keyString - API Key 字符串
   * @param {string} endpoint - 调用的接口路径
   */
  async recordCall(keyString, endpoint) {
    const item = await this.findByKey(keyString);
    if (!item) return null;

    const today = new Date().toISOString().split('T')[0];
    const dailyStats = { ...(item.dailyStats || {}) };
    dailyStats[today] = (dailyStats[today] || 0) + 1;

    const endpointStats = { ...(item.endpointStats || {}) };
    endpointStats[endpoint] = (endpointStats[endpoint] || 0) + 1;

    return keys.findByIdAndUpdate(item._id, {
      callCount: (item.callCount || 0) + 1,
      lastUsedAt: new Date().toISOString(),
      dailyStats,
      endpointStats,
    });
  },

  /**
   * 获取统计数据摘要
   */
  async getStats() {
    const allKeys = await this.findAll();
    const totalKeys = allKeys.length;
    const activeKeys = allKeys.filter((k) => k.status === 'active').length;
    const totalCalls = allKeys.reduce((s, k) => s + (k.callCount || 0), 0);

    // 最近7天调用趋势
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayCalls = allKeys.reduce((s, k) => {
        return s + ((k.dailyStats && k.dailyStats[dateStr]) || 0);
      }, 0);
      last7Days.push({ date: dateStr, calls: dayCalls });
    }

    // 按接口统计
    const endpointMap = {};
    allKeys.forEach((k) => {
      if (k.endpointStats) {
        Object.entries(k.endpointStats).forEach(([ep, count]) => {
          endpointMap[ep] = (endpointMap[ep] || 0) + count;
        });
      }
    });

    return {
      totalKeys,
      activeKeys,
      disabledKeys: totalKeys - activeKeys,
      totalCalls,
      last7Days,
      endpointStats: Object.entries(endpointMap)
        .map(([endpoint, calls]) => ({ endpoint, calls }))
        .sort((a, b) => b.calls - a.calls),
    };
  },
};

module.exports = ApiKey;
