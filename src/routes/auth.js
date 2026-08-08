const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');

const router = express.Router();
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;

function loginRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = loginAttempts.get(key);
  const state = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + LOGIN_WINDOW_MS }
    : current;

  state.count += 1;
  loginAttempts.set(key, state);
  if (state.count > LOGIN_MAX_ATTEMPTS) {
    res.setHeader('Retry-After', Math.ceil((state.resetAt - now) / 1000));
    return res.status(429).json({ message: '登录尝试过于频繁，请稍后再试' });
  }
  next();
}

// POST /api/auth/login - 用户登录
router.post(
  '/login',
  loginRateLimit,
  [
    body('username').isString().trim().isLength({ min: 1, max: 64 }).withMessage('用户名格式不正确'),
    body('password').isString().isLength({ min: 1, max: 128 }).withMessage('密码格式不正确'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    try {
      const user = await User.findOne({ username });
      if (!user) {
        return res.status(401).json({ message: '用户名或密码错误' });
      }

      const isMatch = await User.comparePassword(user, password);
      if (!isMatch) {
        return res.status(401).json({ message: '用户名或密码错误' });
      }

      const payload = {
        id: user._id,
        username: user.username,
      };

      loginAttempts.delete(req.ip || req.socket.remoteAddress || 'unknown');

      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: '7d',
      });

      res.json({
        message: '登录成功',
        token,
        user: User.toSafeObject(user),
      });
    } catch (err) {
      console.error('登录错误:', err);
      res.status(500).json({ message: '服务器内部错误' });
    }
  }
);

module.exports = router;
