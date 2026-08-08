const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const User = require('../models/User');

async function seed() {
  try {
    const adminPassword = process.env.ADMIN_PASSWORD || '';
    if (adminPassword.length < 12 || /(admin|password|123456|qwerty)/i.test(adminPassword)) {
      throw new Error('请通过 ADMIN_PASSWORD 配置至少 12 位的非默认管理员密码');
    }
    const existingAdmin = await User.findOne({ username: 'admin' });
    if (existingAdmin) {
      console.log('管理员账号已存在，跳过创建');
      console.log('用户名: admin');
    } else {
      const admin = await User.create({
        username: 'admin',
        password: adminPassword,
        email: process.env.ADMIN_EMAIL || 'admin@math-blog.com',
      });
      console.log('默认管理员账号创建成功');
      console.log('用户名: admin');
      console.log('密码已从环境变量安全读取');
    }
    process.exit(0);
  } catch (err) {
    console.error('初始化脚本执行失败:', err);
    process.exit(1);
  }
}

seed();
