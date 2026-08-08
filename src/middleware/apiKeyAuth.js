const ApiKey = require('../models/ApiKey');

/**
 * API Key 认证中间件
 * 从请求头 X-API-Key 或查询参数 api_key 中获取 Key
 * 验证通过后记录调用统计
 */
const apiKeyAuth = async (req, res, next) => {
  // 从请求头或查询参数获取 API Key
  // Node.js 的 req.headers 属性名已自动转为小写，无需检查大写形式
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (!apiKey) {
    return res.status(401).json({
      code: -1,
      message: '缺少 API Key，请在请求头中设置 X-API-Key 或在查询参数中添加 api_key',
    });
  }

  try {
    const keyRecord = await ApiKey.findByKey(apiKey);

    if (!keyRecord) {
      return res.status(401).json({
        code: -1,
        message: 'API Key 无效',
      });
    }

    if (keyRecord.status !== 'active') {
      return res.status(403).json({
        code: -1,
        message: 'API Key 已被禁用',
      });
    }

    // 将 key 信息挂载到 req 上
    req.apiKey = keyRecord;

    // 异步记录调用统计（不阻塞响应）
    // 只取路径部分，去掉查询参数，避免同一接口不同参数被统计为不同端点
    const rawUrl = req.originalUrl || req.url;
    const endpoint = rawUrl.split('?')[0];
    ApiKey.recordCall(apiKey, endpoint).catch((err) => {
      console.error('记录 API 调用统计失败:', err);
    });

    next();
  } catch (err) {
    console.error('API Key 认证错误:', err);
    res.status(500).json({ code: -1, message: '服务器内部错误' });
  }
};

module.exports = apiKeyAuth;
