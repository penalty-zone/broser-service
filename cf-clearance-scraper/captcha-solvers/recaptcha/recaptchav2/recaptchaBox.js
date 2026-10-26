/**
 * reCAPTCHA v2 Box Handler
 * 专门处理 reCAPTCHA v2 的 iframe 和 DOM 操作
 */

const { RecaptchaNotFoundError } = require('../common/errors');
const { SELECTORS } = require('../common/translations');

class RecaptchaBoxV2 {
  constructor(page) {
    this.page = page;
    this.anchorFrame = null;
    this.bframeFrame = null;
    this.isInitialized = false;
  }

  /**
   * 初始化并查找 reCAPTCHA frames
   */
  async initialize() {
    console.log('🔍 正在查找 reCAPTCHA v2 frames...');
    
    // 等待更长时间让 reCAPTCHA 完全加载
    await this.page.waitForTimeout(3000);
    
    // 尝试多种方式等待 reCAPTCHA 加载
    try {
      await Promise.race([
        this.page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 15000 }),
        this.page.waitForSelector('.g-recaptcha', { timeout: 15000 }),
        this.page.waitForFunction(() => window.grecaptcha !== undefined, { timeout: 15000 })
      ]);
    } catch (error) {
      console.log('⚠️  标准检测失败，尝试手动检查...');
      
      // 手动检查页面内容
      const hasRecaptcha = await this.page.evaluate(() => {
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
          if (iframe.src && iframe.src.includes('recaptcha')) {
            return true;
          }
        }
        return false;
      });
      
      if (!hasRecaptcha) {
        throw new RecaptchaNotFoundError('No reCAPTCHA iframes found on page');
      }
    }

    // 获取所有框架并等待它们加载
    await this.page.waitForTimeout(2000);
    const frames = this.page.frames();
    
    console.log(`📋 检测到 ${frames.length} 个框架:`);
    frames.forEach((frame, index) => {
      console.log(`   框架 ${index}: ${frame.url()}`);
    });
    
    const framePairs = this._getRecaptchaFramePairs(frames);
    
    if (framePairs.length === 0) {
      console.log('⚠️  未找到标准框架对，尝试备用检测...');
      
      // 备用检测：查找任何包含 recaptcha 的框架
      const recaptchaFrames = frames.filter(frame => 
        frame.url().includes('recaptcha')
      );
      
      if (recaptchaFrames.length >= 2) {
        console.log(`📋 找到 ${recaptchaFrames.length} 个 reCAPTCHA 框架，尝试配对...`);
        
        // 简单配对：第一个作为 anchor，第二个作为 challenge
        this.anchorFrame = recaptchaFrames[0];
        this.bframeFrame = recaptchaFrames[1];
        
        // 如果第一个包含 bframe，交换顺序
        if (recaptchaFrames[0].url().includes('bframe')) {
          this.anchorFrame = recaptchaFrames[1];
          this.bframeFrame = recaptchaFrames[0];
        }
      } else {
        throw new RecaptchaNotFoundError('No valid reCAPTCHA frame pairs found');
      }
    } else {
      // 使用第一个找到的有效 pair
      [this.anchorFrame, this.bframeFrame] = framePairs[0];
    }
    
    this.isInitialized = true;
    
    console.log('✅ reCAPTCHA v2 frames 初始化成功');
    console.log(`   Anchor frame: ${this.anchorFrame.url()}`);
    console.log(`   Challenge frame: ${this.bframeFrame.url()}`);
    
    return this;
  }

  /**
   * 获取 reCAPTCHA anchor 和 bframe frame 配对
   */
  _getRecaptchaFramePairs(frames) {
    const anchorFrames = frames.filter(frame => 
      /\/recaptcha\/(api2|enterprise)\/anchor/.test(frame.url())
    );
    
    const bframeFrames = frames.filter(frame =>
      /\/recaptcha\/(api2|enterprise)\/bframe/.test(frame.url())
    );
    
    console.log(`🔍 找到 ${anchorFrames.length} 个 anchor frames, ${bframeFrames.length} 个 bframe frames`);
    
    const framePairs = [];
    
    for (const anchorFrame of anchorFrames) {
      const frameId = this._extractFrameId(anchorFrame.name());
      
      for (const bframeFrame of bframeFrames) {
        if (bframeFrame.name().includes(frameId)) {
          framePairs.push([anchorFrame, bframeFrame]);
          console.log(`✅ 找到匹配的 frame pair，ID: ${frameId}`);
        }
      }
    }
    
    return framePairs;
  }

  /**
   * 从 frame name 中提取 frame ID
   */
  _extractFrameId(frameName) {
    // Frame names 通常像 "a-xyz123" 或 "c-xyz123"
    return frameName.length > 2 ? frameName.substring(2) : frameName;
  }

  /**
   * 点击 reCAPTCHA 复选框
   */
  async clickCheckbox() {
    this._ensureInitialized();
    
    try {
      console.log('🖱️  点击 reCAPTCHA 复选框...');
      
      await this.anchorFrame.waitForSelector(SELECTORS.checkbox, { timeout: 10000 });
      
      // 检查复选框是否已经选中
      const checkbox = await this.anchorFrame.$(SELECTORS.checkbox);
      const isChecked = await checkbox.getAttribute('aria-checked');
      
      if (isChecked === 'true') {
        console.log('✅ 复选框已经选中');
        return true;
      }
      
      await this.anchorFrame.click(SELECTORS.checkbox);
      console.log('✅ 复选框点击完成');
      
      // 等待一段时间让挑战加载
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      return true;
    } catch (error) {
      console.error('复选框点击失败:', error);
      throw new Error(`Failed to click checkbox: ${error.message}`);
    }
  }

  /**
   * 检查复选框是否已选中
   */
  async isCheckboxChecked() {
    this._ensureInitialized();
    
    try {
      const checkbox = await this.anchorFrame.$(SELECTORS.checkbox);
      if (!checkbox) return false;
      
      const isChecked = await checkbox.getAttribute('aria-checked');
      return isChecked === 'true';
    } catch (error) {
      console.error('检查复选框状态失败:', error);
      return false;
    }
  }

  /**
   * 等待挑战出现
   */
  async waitForChallenge(timeout = 15000) {
    this._ensureInitialized();
    
    console.log('⏳ 等待挑战出现...');
    
    try {
      // 等待任何类型的挑战出现
      await Promise.race([
        this.bframeFrame.waitForSelector(SELECTORS.audio_button, { timeout }),
        this.bframeFrame.waitForSelector(SELECTORS.image_button, { timeout }),
        this.bframeFrame.waitForSelector(SELECTORS.challenge_title, { timeout }),
        this.bframeFrame.waitForSelector('.rc-audiochallenge-instructions', { timeout }),
        this.bframeFrame.waitForSelector('.rc-imageselect-instructions', { timeout })
      ]);
      
      console.log('✅ 检测到挑战界面');
      return true;
    } catch (error) {
      console.log('ℹ️  没有检测到挑战 - 可能已自动通过验证');
      return false;
    }
  }

  /**
   * 检测当前挑战类型
   */
  async getChallengeType() {
    this._ensureInitialized();
    
    try {
      // 检查音频挑战
      const audioInstructions = await this.bframeFrame.$('.rc-audiochallenge-instructions');
      if (audioInstructions) {
        console.log('🎵 检测到音频挑战');
        return 'audio';
      }

      // 检查图像挑战
      const imageInstructions = await this.bframeFrame.$('.rc-imageselect-instructions');
      if (imageInstructions) {
        console.log('🖼️ 检测到图像挑战');
        return 'image';
      }

      // 检查按钮
      const audioButton = await this.bframeFrame.$(SELECTORS.audio_button);
      const imageButton = await this.bframeFrame.$(SELECTORS.image_button);
      
      if (audioButton) return 'audio';
      if (imageButton) return 'image';
      
      return null;
    } catch (error) {
      console.error('检测挑战类型失败:', error);
      return null;
    }
  }

  /**
   * 切换到音频挑战
   */
  async switchToAudio() {
    this._ensureInitialized();
    
    try {
      console.log('🎵 切换到音频挑战...');
      
      await this.bframeFrame.waitForSelector(SELECTORS.audio_button, { timeout: 10000 });
      await this.bframeFrame.click(SELECTORS.audio_button);
      
      // 等待音频挑战界面加载
      await this.bframeFrame.waitForSelector('.rc-audiochallenge-instructions', { timeout: 10000 });
      
      console.log('✅ 已切换到音频挑战');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error('切换到音频挑战失败:', error);
      throw new Error(`Failed to switch to audio challenge: ${error.message}`);
    }
  }

  /**
   * 获取音频下载链接
   */
  async getAudioUrl() {
    this._ensureInitialized();
    
    try {
      console.log('🔍 获取音频下载链接...');
      
      // 等待音频下载按钮出现
      await this.bframeFrame.waitForSelector(SELECTORS.audio_source, { timeout: 15000 });
      
      const audioLink = await this.bframeFrame.$(SELECTORS.audio_source);
      if (!audioLink) {
        throw new Error('Audio download link not found');
      }
      
      const href = await audioLink.getAttribute('href');
      if (!href) {
        throw new Error('Audio download href is empty');
      }
      
      console.log(`✅ 音频链接获取成功: ${href.substring(0, 100)}...`);
      return href;
    } catch (error) {
      console.error('获取音频链接失败:', error);
      throw new Error(`Failed to get audio URL: ${error.message}`);
    }
  }

  /**
   * 提交音频响应
   */
  async submitAudioResponse(transcription) {
    this._ensureInitialized();
    
    try {
      console.log(`🎤 提交音频转录结果: "${transcription}"`);
      
      // 输入转录文本
      await this.bframeFrame.waitForSelector(SELECTORS.audio_response, { timeout: 10000 });
      await this.bframeFrame.fill(SELECTORS.audio_response, transcription);
      
      // 点击验证按钮
      await this.bframeFrame.waitForSelector(SELECTORS.verify_button, { timeout: 5000 });
      await this.bframeFrame.click(SELECTORS.verify_button);
      
      console.log('✅ 音频响应已提交，等待验证...');
      
      // 等待验证完成
      await this.page.waitForTimeout(3000);
      
    } catch (error) {
      console.error('提交音频响应失败:', error);
      throw new Error(`Failed to submit audio response: ${error.message}`);
    }
  }

  /**
   * 获取图像挑战信息
   */
  async getImageChallengeInfo() {
    this._ensureInitialized();
    
    try {
      // 获取挑战描述
      const titleElement = await this.bframeFrame.$(SELECTORS.challenge_title);
      const title = titleElement ? await titleElement.textContent() : null;
      
      // 获取图像
      await this.bframeFrame.waitForSelector(SELECTORS.image_table, { timeout: 10000 });
      const images = await this.bframeFrame.$$(SELECTORS.challenge_image);
      
      const imageData = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const src = await img.getAttribute('src');
        if (src) {
          imageData.push({
            index: i,
            src: src,
            element: img
          });
        }
      }
      
      console.log(`🖼️ 图像挑战信息 - 标题: "${title}", 图像数量: ${imageData.length}`);
      
      return {
        title: title ? title.trim() : null,
        images: imageData
      };
    } catch (error) {
      console.error('获取图像挑战信息失败:', error);
      throw new Error(`Failed to get image challenge info: ${error.message}`);
    }
  }

  /**
   * 点击图像瓦片
   */
  async clickImageTiles(indices) {
    this._ensureInitialized();
    
    try {
      console.log(`🖱️  点击图像瓦片: ${indices.join(', ')}`);
      
      const tiles = await this.bframeFrame.$$(SELECTORS.image_tile);
      
      for (const index of indices) {
        if (index >= 0 && index < tiles.length) {
          await tiles[index].click();
          console.log(`✅ 已点击瓦片 ${index}`);
          await new Promise(resolve => setTimeout(resolve, 500)); // 点击间隔
        }
      }
    } catch (error) {
      console.error('点击图像瓦片失败:', error);
      throw new Error(`Failed to click image tiles: ${error.message}`);
    }
  }

  /**
   * 提交图像挑战
   */
  async submitImageChallenge() {
    this._ensureInitialized();
    
    try {
      console.log('🖼️ 提交图像挑战...');
      
      await this.bframeFrame.waitForSelector(SELECTORS.verify_button, { timeout: 5000 });
      await this.bframeFrame.click(SELECTORS.verify_button);
      
      console.log('✅ 图像挑战已提交，等待验证...');
      
      // 等待验证完成
      await this.page.waitForTimeout(3000);
      
    } catch (error) {
      console.error('提交图像挑战失败:', error);
      throw new Error(`Failed to submit image challenge: ${error.message}`);
    }
  }

  /**
   * 检查是否有错误消息
   */
  async hasError() {
    this._ensureInitialized();
    
    try {
      const errorElement = await this.bframeFrame.$(SELECTORS.error_message);
      return errorElement !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * 检查挑战是否已解决
   */
  async isSolved() {
    this._ensureInitialized();
    
    try {
      // 检查复选框状态
      const isChecked = await this.isCheckboxChecked();
      if (isChecked) {
        return true;
      }

      // 检查是否还有挑战界面
      const hasChallenge = await this.bframeFrame.$('.rc-audiochallenge-instructions, .rc-imageselect-instructions');
      return !hasChallenge;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取 reCAPTCHA token
   */
  async getToken() {
    try {
      // 尝试多种方法获取 token
      const methods = [
        () => this.page.evaluate(() => {
          const textarea = document.querySelector('textarea[name="g-recaptcha-response"]');
          return textarea && textarea.value ? textarea.value : null;
        }),
        () => this.page.evaluate(() => {
          return window.grecaptcha && window.grecaptcha.getResponse ? 
            window.grecaptcha.getResponse() : null;
        }),
        () => this.page.evaluate(() => {
          const response = document.getElementById('g-recaptcha-response');
          return response && response.value ? response.value : null;
        })
      ];
      
      for (const method of methods) {
        try {
          const token = await method();
          if (token && token.length > 100) { // 有效的 reCAPTCHA tokens 通常很长
            console.log(`✅ 成功获取 reCAPTCHA token (长度: ${token.length})`);
            return token;
          }
        } catch (e) {
          // 继续下一个方法
        }
      }
      
      return null;
    } catch (error) {
      console.error('获取 token 失败:', error);
      return null;
    }
  }

  /**
   * 确保已初始化
   */
  _ensureInitialized() {
    if (!this.isInitialized) {
      throw new RecaptchaNotFoundError('RecaptchaBox not initialized. Call initialize() first.');
    }
  }
}

module.exports = RecaptchaBoxV2;