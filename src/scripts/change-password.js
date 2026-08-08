const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const bcrypt = require('bcryptjs');
const JsonStorage = require('../utils/JsonStorage');
const readline = require('readline');

const users = new JsonStorage('users');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function changePassword() {
  try {
    console.log('=== 密码修改工具 ===\n');

    // 列出所有用户
    const allUsers = users.find({}, { select: '-password' });
    if (allUsers.length === 0) {
      console.log('暂无用户，请先运行 seed 脚本创建管理员账号');
      rl.close();
      return;
    }

    console.log('现有用户列表：');
    allUsers.forEach((u) => {
      console.log(`  ID: ${u._id}  |  用户名: ${u.username}  |  邮箱: ${u.email || '(未设置)'}`);
    });
    console.log();

    // 交互式输入
    const targetUsername = (await question('请输入要修改密码的用户名: ')).trim();
    if (!targetUsername) {
      console.log('用户名不能为空');
      rl.close();
      return;
    }

    const user = users.findOne({ username: targetUsername });
    if (!user) {
      console.log(`未找到用户: ${targetUsername}`);
      rl.close();
      return;
    }

    console.log(`\n找到用户: ${user.username} (ID: ${user._id})`);

    // 方式一：通过旧密码验证
    const useOldPassword = (await question('是否需要验证旧密码？(y/n, 默认 n): ')).trim().toLowerCase();
    if (useOldPassword === 'y') {
      const oldPassword = await question('请输入旧密码: ');
      const isMatch = await bcrypt.compare(oldPassword, user.password);
      if (!isMatch) {
        console.log('旧密码错误，修改已取消');
        rl.close();
        return;
      }
      console.log('旧密码验证通过\n');
    }

    // 输入新密码
    const newPassword = await question('请输入新密码（至少12位）: ');
    if (newPassword.length < 12) {
      console.log('密码长度不足12位，为了安全请使用更长的密码');
      rl.close();
      return;
    }

    const confirmPassword = await question('请再次输入新密码: ');
    if (newPassword !== confirmPassword) {
      console.log('两次输入的密码不一致');
      rl.close();
      return;
    }

    // 简单的密码强度检查
    if (/(admin|password|123456|qwerty)/i.test(newPassword)) {
      const proceed = (await question('警告：该密码过于简单，是否仍要使用？(y/n): ')).trim().toLowerCase();
      if (proceed !== 'y') {
        console.log('已取消修改');
        rl.close();
        return;
      }
    }

    // 生成哈希并更新
    const hashedPassword = await hashPassword(newPassword);
    const updated = users.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword } }
    );

    if (updated) {
      console.log('\n✅ 密码修改成功！');
      console.log(`用户: ${updated.username}`);
      console.log(`新密码哈希: ${updated.password}`);
    } else {
      console.log('❌ 密码修改失败');
    }

    rl.close();
  } catch (err) {
    console.error('脚本执行出错:', err);
    rl.close();
    process.exit(1);
  }
}

changePassword();
