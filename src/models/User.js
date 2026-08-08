const bcrypt = require('bcryptjs');
const JsonStorage = require('../utils/JsonStorage');

const users = new JsonStorage('users');

const User = {
  /**
   * 根据条件查找单个用户
   */
  async findOne(query) {
    return users.findOne(query);
  },

  /**
   * 根据 ID 查找用户
   */
  async findById(id) {
    return users.findById(id);
  },

  /**
   * 创建新用户（密码自动哈希）
   */
  async create(data) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(data.password, salt);
    return users.insertOne({
      ...data,
      password: hashedPassword,
    });
  },

  /**
   * 验证密码
   */
  async comparePassword(user, candidatePassword) {
    return bcrypt.compare(candidatePassword, user.password);
  },

  /**
   * 更新用户密码
   */
  async updatePassword(userId, newPassword) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    return users.findByIdAndUpdate(userId, { password: hashedPassword });
  },

  /**
   * 修改密码（验证旧密码）
   */
  async changePassword(userId, oldPassword, newPassword) {
    const user = await users.findById(userId);
    if (!user) throw new Error('用户不存在');

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) throw new Error('旧密码错误');

    return this.updatePassword(userId, newPassword);
  },

  /**
   * 返回安全的用户对象（不含密码）
   */
  toSafeObject(user) {
    const { password, ...safe } = user;
    return safe;
  },
};

module.exports = User;
