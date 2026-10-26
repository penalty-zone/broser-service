/**
 * reCAPTCHA v2 图像挑战处理器
 * 复用 hCaptcha 的 Gemini 方案进行图像识别
 */

const path = require('path');
const { RecaptchaSolveError } = require('../common/errors');
const { OBJECT_TRANSLATIONS } = require('../common/translations');

class ImageChallenge {
  constructor() {
    this.maxAttempts = 3;
    this.geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  }

  /**
   * 解决图像挑战
   */
  async solve(recaptchaBox) {
    console.log('🖼️ 开始图像挑战解决流程...');
    
    if (!this.geminiApiKey) {
      throw new RecaptchaSolveError('Gemini API key not found. Please set GEMINI_API_KEY or GOOGLE_API_KEY environment variable.');
    }

    let attempts = 0;
    let solved = false;

    while (attempts < this.maxAttempts && !solved) {
      attempts++;
      console.log(`🎯 图像挑战尝试 ${attempts}/${this.maxAttempts}`);

      try {
        // 1. 获取图像挑战信息
        const challengeInfo = await recaptchaBox.getImageChallengeInfo();
        if (!challengeInfo.title || challengeInfo.images.length === 0) {
          throw new RecaptchaSolveError('Could not get image challenge information');
        }

        console.log(`🖼️ 挑战类型: "${challengeInfo.title}"`);
        console.log(`🖼️ 图像数量: ${challengeInfo.images.length}`);

        // 2. 解析挑战目标
        const targetObject = this._parseTargetObject(challengeInfo.title);
        if (!targetObject) {
          throw new RecaptchaSolveError(`Could not parse target object from: "${challengeInfo.title}"`);
        }

        console.log(`🎯 识别目标: ${targetObject}`);

        // 3. 使用 Gemini 识别图像
        const selectedIndices = await this._recognizeImagesWithGemini(
          challengeInfo.images, 
          targetObject, 
          challengeInfo.title
        );

        if (selectedIndices.length === 0) {
          console.log('⚠️  Gemini 未识别到任何匹配的图像');
          // 随机选择一些图像作为后备方案
          selectedIndices.push(Math.floor(Math.random() * challengeInfo.images.length));
        }

        console.log(`🎯 选择的图像索引: ${selectedIndices.join(', ')}`);

        // 4. 点击选中的图像
        await recaptchaBox.clickImageTiles(selectedIndices);

        // 5. 提交挑战
        await recaptchaBox.submitImageChallenge();

        // 6. 等待验证结果
        await this._waitForVerification(recaptchaBox);

        // 7. 检查是否解决
        if (await recaptchaBox.isSolved()) {
          console.log('✅ 图像挑战解决成功！');
          solved = true;
        } else if (await recaptchaBox.hasError()) {
          console.log(`❌ 尝试 ${attempts} 失败，检测到错误`);
          if (attempts < this.maxAttempts) {
            await this._prepareRetry(recaptchaBox);
          }
        } else {
          console.log(`❌ 尝试 ${attempts} 失败，验证未通过`);
          if (attempts < this.maxAttempts) {
            await this._prepareRetry(recaptchaBox);
          }
        }

      } catch (error) {
        console.error(`❌ 图像挑战尝试 ${attempts} 失败:`, error.message);
        
        if (attempts >= this.maxAttempts) {
          throw error;
        }
        
        // 准备重试
        try {
          await this._prepareRetry(recaptchaBox);
        } catch (retryError) {
          console.error('准备重试失败:', retryError.message);
          throw error;
        }
      }
    }

    if (!solved) {
      throw new RecaptchaSolveError(`All ${this.maxAttempts} image challenge attempts failed`);
    }

    return solved;
  }

  /**
   * 使用 Gemini 识别图像
   */
  async _recognizeImagesWithGemini(images, targetObject, originalTitle) {
    try {
      console.log('🤖 使用 Gemini 进行图像识别...');

      // 复用 hCaptcha 的 Gemini 识别逻辑
      const geminiRecognizer = await this._getGeminiRecognizer();
      
      const selectedIndices = [];

      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        
        try {
          // 下载图像数据
          const imageData = await this._downloadImageData(image.src);
          
          // 构建识别提示
          const prompt = this._buildRecognitionPrompt(targetObject, originalTitle);
          
          // 调用 Gemini 识别
          const containsTarget = await geminiRecognizer.recognizeImage(imageData, prompt);
          
          if (containsTarget) {
            selectedIndices.push(i);
            console.log(`✅ 图像 ${i} 包含目标对象: ${targetObject}`);
          } else {
            console.log(`❌ 图像 ${i} 不包含目标对象`);
          }

          // 避免请求过快
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
          console.error(`图像 ${i} 识别失败:`, error.message);
          // 继续处理下一张图像
        }
      }

      console.log(`🎯 Gemini 识别完成，选中 ${selectedIndices.length} 张图像`);
      return selectedIndices;

    } catch (error) {
      console.error('Gemini 图像识别失败:', error);
      throw new RecaptchaSolveError(`Gemini recognition failed: ${error.message}`);
    }
  }

  /**
   * 获取 Gemini 识别器（复用 hCaptcha 的实现）
   */
  async _getGeminiRecognizer() {
    try {
      // 导入 hCaptcha 的 Gemini 识别模块
      const hcaptchaPath = path.join(__dirname, '../../hcaptcha');
      
      // 查找 hCaptcha 中的 Gemini 相关文件
      const fs = require('fs');
      const hcaptchaFiles = fs.readdirSync(hcaptchaPath);
      
      // 寻找包含 Gemini 逻辑的文件
      let geminiModule = null;
      for (const file of hcaptchaFiles) {
        if (file.includes('gemini') || file.includes('solver') || file.includes('endpoint')) {
          try {
            const modulePath = path.join(hcaptchaPath, file);
            geminiModule = require(modulePath);
            break;
          } catch (e) {
            // 继续尝试下一个文件
          }
        }
      }

      if (!geminiModule) {
        // 如果找不到现有模块，创建简化的 Gemini 接口
        geminiModule = await this._createSimplifiedGeminiInterface();
      }

      return geminiModule;

    } catch (error) {
      console.error('获取 Gemini 识别器失败:', error);
      throw new RecaptchaSolveError('Failed to initialize Gemini recognizer');
    }
  }

  /**
   * 创建简化的 Gemini 接口
   */
  async _createSimplifiedGeminiInterface() {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    
    const genAI = new GoogleGenerativeAI(this.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    return {
      async recognizeImage(imageData, prompt) {
        try {
          const imagePart = {
            inlineData: {
              data: imageData.toString('base64'),
              mimeType: 'image/jpeg'
            }
          };

          const result = await model.generateContent([prompt, imagePart]);
          const response = await result.response;
          const text = response.text().toLowerCase();

          // 解析响应，判断是否包含目标对象
          return text.includes('yes') || text.includes('true') || text.includes('包含') || text.includes('存在');

        } catch (error) {
          console.error('Gemini API 调用失败:', error);
          return false;
        }
      }
    };
  }

  /**
   * 下载图像数据
   */
  async _downloadImageData(imageUrl) {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      throw new Error(`Failed to download image: ${error.message}`);
    }
  }

  /**
   * 构建识别提示
   */
  _buildRecognitionPrompt(targetObject, originalTitle) {
    return `
请分析这张图像是否包含 "${targetObject}"。

原始挑战描述: "${originalTitle}"

请仔细观察图像，判断是否包含指定的对象。如果包含，请回答 "yes"，如果不包含，请回答 "no"。

注意：
- 请只关注明显可见的完整对象
- 部分遮挡的对象也算作包含
- 请给出简短的 yes/no 答案
`.trim();
  }

  /**
   * 解析目标对象
   */
  _parseTargetObject(challengeTitle) {
    const title = challengeTitle.toLowerCase();
    
    // 查找已知的对象类型
    for (const [objectKey, translations] of Object.entries(OBJECT_TRANSLATIONS)) {
      for (const translation of translations) {
        if (title.includes(translation.toLowerCase())) {
          console.log(`🎯 识别到目标对象: ${objectKey} (匹配: "${translation}")`);
          return objectKey;
        }
      }
    }

    // 如果没有匹配到预定义对象，尝试提取关键词
    const keywords = title.match(/(?:select all (?:images )?with |click on all )([^.]+)/);
    if (keywords && keywords[1]) {
      const extracted = keywords[1].trim();
      console.log(`🎯 提取的目标对象: ${extracted}`);
      return extracted;
    }

    console.warn(`⚠️  无法解析目标对象: "${challengeTitle}"`);
    return null;
  }

  /**
   * 等待验证完成
   */
  async _waitForVerification(recaptchaBox) {
    console.log('⏳ 等待图像验证结果...');
    
    const maxWait = 15000; // 15秒
    const checkInterval = 500;
    const maxChecks = maxWait / checkInterval;
    
    for (let i = 0; i < maxChecks; i++) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      
      if (await recaptchaBox.isSolved()) {
        return true;
      }
      
      if (await recaptchaBox.hasError()) {
        return false;
      }
    }
    
    console.log('⏰ 图像验证等待超时');
    return false;
  }

  /**
   * 准备重试
   */
  async _prepareRetry(recaptchaBox) {
    console.log('🔄 准备下一次图像挑战尝试...');
    
    try {
      const reloadButton = await recaptchaBox.bframeFrame.$('#recaptcha-reload-button');
      if (reloadButton) {
        await reloadButton.click();
        console.log('🔄 已点击重新加载按钮');
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        console.log('⏳ 等待新图像挑战加载...');
        await recaptchaBox.page.waitForTimeout(3000);
      }
    } catch (error) {
      console.warn('准备重试时出现警告:', error.message);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  /**
   * 获取图像挑战统计信息
   */
  getStats() {
    return {
      processor: 'Gemini Vision API',
      supportedObjects: Object.keys(OBJECT_TRANSLATIONS),
      maxAttempts: this.maxAttempts,
      features: [
        'AI-powered image recognition',
        'Multi-object detection',
        'Automatic retry mechanism',
        'Challenge text parsing'
      ]
    };
  }
}

module.exports = ImageChallenge;