const express = require('express');
const ApiKey = require('../models/ApiKey');
const auth = require('../middleware/auth');

const router = express.Router();

// 所有接口都需要管理员认证
router.use(auth);

/**
 * GET /api/api-keys
 * 获取所有 API Key 列表
 */
router.get('/', async (req, res) => {
  try {
    const keys = await ApiKey.findAll();
    // 返回时隐藏完整 key 字符串，只显示前缀
    const sanitized = keys.map((k) => ({
      ...k,
      key: k.key.substring(0, 8) + '****' + k.key.substring(k.key.length - 4),
    }));
    res.json({ keys: sanitized });
  } catch (err) {
    console.error('获取 API Key 列表错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

/**
 * GET /api/api-keys/stats
 * 获取 API 调用统计数据
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await ApiKey.getStats();
    res.json({ stats });
  } catch (err) {
    console.error('获取 API 统计错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

/**
 * GET /api/api-keys/:id
 * 获取单个 API Key 详情（含完整 key）
 */
router.get('/:id', async (req, res) => {
  try {
    const key = await ApiKey.findById(req.params.id);
    if (!key) {
      return res.status(404).json({ message: 'API Key 不存在' });
    }
    res.json({ key });
  } catch (err) {
    console.error('获取 API Key 错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

/**
 * POST /api/api-keys
 * 创建新的 API Key
 * body: { name: string }
 */
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: '请输入 Key 名称' });
    }
    const key = await ApiKey.create({ name: name.trim() });
    res.status(201).json({ message: 'API Key 创建成功', key });
  } catch (err) {
    console.error('创建 API Key 错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

/**
 * PUT /api/api-keys/:id
 * 更新 API Key（名称、状态）
 * body: { name?, status? }
 */
router.put('/:id', async (req, res) => {
  try {
    const { name, status } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (status !== undefined) {
      if (status !== 'active' && status !== 'disabled') {
        return res.status(400).json({ message: 'status 只能是 active 或 disabled' });
      }
      update.status = status;
    }

    const key = await ApiKey.findByIdAndUpdate(req.params.id, update);
    if (!key) {
      return res.status(404).json({ message: 'API Key 不存在' });
    }
    res.json({ message: '更新成功', key });
  } catch (err) {
    console.error('更新 API Key 错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

/**
 * DELETE /api/api-keys/:id
 * 删除 API Key
 */
router.delete('/:id', async (req, res) => {
  try {
    const key = await ApiKey.findByIdAndDelete(req.params.id);
    if (!key) {
      return res.status(404).json({ message: 'API Key 不存在' });
    }
    res.json({ message: 'API Key 已删除' });
  } catch (err) {
    console.error('删除 API Key 错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

/**
 * POST /api/api-keys/:id/reset
 * 重置调用统计
 */
router.post('/:id/reset', async (req, res) => {
  try {
    const key = await ApiKey.findByIdAndUpdate(req.params.id, {
      callCount: 0,
      lastUsedAt: null,
      dailyStats: {},
      endpointStats: {},
    });
    if (!key) {
      return res.status(404).json({ message: 'API Key 不存在' });
    }
    res.json({ message: '统计已重置' });
  } catch (err) {
    console.error('重置 API 统计错误:', err);
    res.status(500).json({ message: '服务器内部错误' });
  }
});

module.exports = router;
