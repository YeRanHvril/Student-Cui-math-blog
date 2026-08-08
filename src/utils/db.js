const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

/**
 * 初始化数据目录
 */
function connectDB() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  console.log('本地 JSON 数据库已就绪，数据目录:', DATA_DIR);
  return Promise.resolve({ type: 'json', path: DATA_DIR });
}

module.exports = { connectDB };
