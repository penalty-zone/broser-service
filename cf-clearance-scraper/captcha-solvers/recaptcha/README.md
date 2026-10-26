# Google reCAPTCHA 解决服务

基于 [Playwright-reCAPTCHA](https://github.com/0xsongsu/Playwright-reCAPTCHA) 项目改编的 Puppeteer 版本，支持 reCAPTCHA v2 和 v3 自动解决。

## 📋 功能特性

### ✅ 已实现
- **reCAPTCHA v2 框架**: 完整的挑战检测和处理流程
- **reCAPTCHA v3 支持**: 自动token获取
- **多语言支持**: 9种语言 (en, es, fr, de, pt, ru, it, nl, pl)
- **代理支持**: 完整的代理配置
- **上下文池优化**: 复用浏览器上下文
- **错误处理**: 完善的异常管理和重试机制

### 🚧 需要集成外部服务
- **音频挑战解决**: 需要语音识别服务 (Google Speech API)
- **图像挑战解决**: 需要图像识别服务 (CapSolver API)

## 🏗️ 架构设计

### 核心模块

```
captcha-solvers/recaptcha/
├── recaptchaService.js     # 主服务类
├── recaptchaBox.js        # reCAPTCHA DOM 操作
├── errors.js              # 错误定义
├── translations.js        # 多语言支持
└── README.md             # 文档
```

### 基于原项目的实现映射

| 原始 Python 模块 | JavaScript 适配版本 | 功能 |
|------------------|-------------------|------|
| `async_solver.py` | `recaptchaService.js` | 主要解决逻辑 |
| `recaptcha_box.py` | `recaptchaBox.js` | DOM 操作和框架处理 |
| `errors.py` | `errors.js` | 异常定义 |
| `translations.py` | `translations.js` | 多语言和常量 |

## 🔌 API 接口

### reCAPTCHA v2
```javascript
// POST /
{
  "type": "recaptchav2",
  "websiteUrl": "https://example.com",
  "websiteKey": "site-key",
  "method": "audio",        // 可选: "audio" | "image"
  "language": "en",         // 可选: 支持9种语言
  "proxy": {...}            // 可选
}
```

### reCAPTCHA v3
```javascript
// POST /
{
  "type": "recaptchav3", 
  "websiteUrl": "https://example.com",
  "websiteKey": "site-key",
  "action": "submit",       // 可选: 默认 "submit"
  "proxy": {...}            // 可选
}
```

## 🔧 集成方案

### 1. 音频挑战集成 (Google Speech API)

需要在 `_solveAudioChallenge` 方法中集成语音识别：

```javascript
// 安装依赖
npm install @google-cloud/speech

// 实现音频转录
const speech = require('@google-cloud/speech');
const client = new speech.SpeechClient();

async function transcribeAudio(audioUrl, language) {
  // 1. 下载音频文件
  const audioBuffer = await downloadAudio(audioUrl);
  
  // 2. 转换格式 (MP3 -> WAV)
  const wavBuffer = await convertToWav(audioBuffer);
  
  // 3. 调用 Google Speech API
  const request = {
    audio: { content: wavBuffer.toString('base64') },
    config: {
      encoding: 'WEBM_OPUS',
      languageCode: ORIGINAL_LANGUAGE_AUDIO[language] || 'en-US',
    },
  };
  
  const [response] = await client.recognize(request);
  return response.results?.[0]?.alternatives?.[0]?.transcript || '';
}
```

### 2. 图像挑战集成 (CapSolver API)

需要在 `_solveImageChallenge` 方法中集成图像识别：

```javascript
// 安装依赖
npm install axios

async function solveImageWithCapSolver(challengeTitle, imageData) {
  const capsolverApiKey = process.env.CAPSOLVER_API_KEY;
  
  // 1. 创建任务
  const createTask = await axios.post('https://api.capsolver.com/createTask', {
    clientKey: capsolverApiKey,
    task: {
      type: 'ReCaptchaV2Classification',
      image: imageData,
      question: challengeTitle
    }
  });
  
  // 2. 获取结果
  const taskId = createTask.data.taskId;
  let result;
  
  do {
    await new Promise(resolve => setTimeout(resolve, 1000));
    result = await axios.post('https://api.capsolver.com/getTaskResult', {
      clientKey: capsolverApiKey,
      taskId: taskId
    });
  } while (result.data.status === 'processing');
  
  return result.data.solution?.objects || [];
}
```

### 3. 环境变量配置

在 `.env` 文件中添加：

```bash
# Google Speech API
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# CapSolver API  
CAPSOLVER_API_KEY=your_capsolver_api_key

# reCAPTCHA 配置
RECAPTCHA_MAX_ATTEMPTS=3
RECAPTCHA_TIMEOUT=180000
```

## 📊 核心流程

### reCAPTCHA v2 解决流程

```
1. 页面加载 → 2. 检测框架 → 3. 点击复选框
         ↓
4. 检查自动通过 → 5. 等待挑战 → 6. 识别挑战类型
         ↓
7. 音频挑战:                8. 图像挑战:
   - 切换到音频模式            - 获取挑战标题  
   - 下载音频文件              - 获取图像数据
   - 语音识别转录              - 图像识别分析
   - 提交转录文本              - 点击匹配瓦片
         ↓                           ↓
9. 验证结果 → 10. 获取token → 11. 返回成功
```

### reCAPTCHA v3 解决流程

```
1. 页面加载 → 2. 等待脚本 → 3. 执行grecaptcha.execute()
         ↓
4. 监听网络响应 → 5. 提取token → 6. 返回结果
```

## 🧪 测试

```bash
# 运行 reCAPTCHA 测试
node tests/test_recaptcha.js

# 测试特定类型
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recaptchav3",
    "websiteUrl": "https://recaptcha-demo.appspot.com/recaptcha-v3-request-scores.php",
    "websiteKey": "6LfW6wATAAAAAHLqO2pb8bDBahxlMxvXSlNyNW4W"
  }'
```

## ⚡ 性能优化

1. **上下文池**: 复用浏览器上下文减少启动开销
2. **并发处理**: 支持多个reCAPTCHA同时处理
3. **智能重试**: 失败时自动重试，最多3次
4. **资源管理**: 自动清理页面和上下文资源

## 🔒 安全考虑

1. **API密钥保护**: 环境变量存储敏感信息
2. **代理支持**: 支持代理以保护真实IP
3. **速率限制**: 内置请求频率控制
4. **错误日志**: 详细的错误信息便于调试

## 📚 扩展开发

### 添加新的语音识别服务

```javascript
// 在 _solveAudioChallenge 中添加选择逻辑
const provider = process.env.SPEECH_PROVIDER || 'google';

switch (provider) {
  case 'google':
    return await this._transcribeWithGoogle(audioUrl, language);
  case 'azure':
    return await this._transcribeWithAzure(audioUrl, language);
  case 'aws':
    return await this._transcribeWithAWS(audioUrl, language);
}
```

### 添加新的图像识别服务

```javascript
// 在 _solveImageChallenge 中添加选择逻辑
const provider = process.env.IMAGE_PROVIDER || 'capsolver';

switch (provider) {
  case 'capsolver':
    return await this._solveWithCapSolver(challengeTitle, imageData);
  case 'antiaptcha':
    return await this._solveWithAntiCaptcha(challengeTitle, imageData);
  case 'custom':
    return await this._solveWithCustomAPI(challengeTitle, imageData);
}
```

## 🚀 部署建议

1. **资源配置**: 建议至少2GB RAM，支持音频/图像处理
2. **依赖安装**: 确保安装了所需的语音/图像处理库
3. **监控配置**: 启用详细日志记录成功率和错误信息
4. **扩容策略**: 根据负载调整上下文池大小和并发限制

## 📝 注意事项

- 本实现仅用于测试和开发环境
- 音频和图像挑战需要集成外部服务才能完全工作
- 遵守目标网站的服务条款和使用政策
- 定期更新以应对reCAPTCHA的变化