const express = require('express');
const auth = require('../middleware/auth');
const JsonStorage = require('../utils/JsonStorage');

const router = express.Router();
const settingsDb = new JsonStorage('settings');

// GET /api/settings - 公开，获取站点设置
router.get('/', async (req, res) => {
  try {
    const settings = settingsDb.findOne({ _id: '1' });
    if (!settings) {
      return res.json({});
    }
    // 返回时去掉 _id / createdAt / updatedAt
    const { _id, createdAt, updatedAt, ...data } = settings;
    res.json(data);
  } catch (err) {
    console.error('获取站点设置失败:', err);
    res.status(500).json({ message: '获取站点设置失败' });
  }
});

// PUT /api/settings - 需认证，更新站点设置
router.put('/', auth, async (req, res) => {
  try {
    const { hero, projects, now, about, footer } = req.body;

    const update = {};
    if (hero !== undefined) update.hero = hero;
    if (projects !== undefined) update.projects = projects;
    if (now !== undefined) update.now = now;
    if (about !== undefined) update.about = about;
    if (footer !== undefined) update.footer = footer;

    const settings = settingsDb.findByIdAndUpdate('1', update);
    if (!settings) {
      return res.status(404).json({ message: '站点设置不存在' });
    }

    const { _id, createdAt, updatedAt, ...data } = settings;
    res.json(data);
  } catch (err) {
    console.error('更新站点设置失败:', err);
    res.status(500).json({ message: '更新站点设置失败' });
  }
});

module.exports = router;