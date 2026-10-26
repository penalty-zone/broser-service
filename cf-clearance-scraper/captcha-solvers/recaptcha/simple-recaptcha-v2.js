/**
 * 简化的 reCAPTCHA v2 解决器
 * 基于 GoogleRecaptchaBypass 的思路，简化流程
 */

const NodeAudioProcessor = require('./common/nodeAudioProcessor');
const { RecaptchaNotFoundError, RecaptchaSolveError } = require('./common/errors');

class SimpleRecaptchaV2Solver {
  constructor() {
    this.audioProcessor = new NodeAudioProcessor();
    this.maxAttempts = 3;
  }

  /**
   * 解决 reCAPTCHA v2 - 简化流程
   */
  async solve(page, options = {}) {
    const { language = 'en-US', timeout = 120000 } = options;
    const startTime = Date.now();

    console.log('🤖 开始简化的 reCAPTCHA v2 解决流程...');

    try {
      // 1. 等待页面加载
      console.log('⏳ 等待页面完全加载...');
      await page.waitForTimeout(3000);

      // 2. 查找并点击 reCAPTCHA 复选框
      const checkboxClicked = await this._clickCheckbox(page);
      if (!checkboxClicked) {
        throw new RecaptchaNotFoundError('无法找到或点击 reCAPTCHA 复选框');
      }

      // 3. 等待并检查是否自动通过
      await page.waitForTimeout(3000);
      const isAlreadySolved = await this._isCheckboxSolved(page);
      
      if (isAlreadySolved) {
        console.log('✅ reCAPTCHA 自动通过验证');
        const token = await this._getToken(page);
        if (token) {
          return {
            success: true,
            token: token,
            challengeType: 'none',
            solveTime: Date.now() - startTime
          };
        }
      }

      // 4. 处理音频挑战
      console.log('🎵 开始音频挑战处理...');
      const solved = await this._solveAudioChallenge(page, language);

      if (!solved) {
        throw new RecaptchaSolveError('音频挑战解决失败');
      }

      // 5. 获取最终 token
      const token = await this._getToken(page);
      if (!token) {
        throw new RecaptchaSolveError('验证通过但未获得 token');
      }

      const solveTime = Date.now() - startTime;
      console.log(`✅ reCAPTCHA v2 解决成功 (${solveTime}ms)`);

      return {
        success: true,
        token: token,
        challengeType: 'audio',
        solveTime: solveTime
      };

    } catch (error) {
      const solveTime = Date.now() - startTime;
      console.error(`❌ reCAPTCHA v2 解决失败 (${solveTime}ms):`, error.message);
      throw new RecaptchaSolveError(`Simple reCAPTCHA v2 solving failed: ${error.message}`);
    }
  }

  /**
   * 查找并点击 reCAPTCHA 复选框
   */
  async _clickCheckbox(page) {
    console.log('🔍 查找 reCAPTCHA 复选框...');

    // 等待 reCAPTCHA iframe 加载
    try {
      await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 15000 });
    } catch (error) {
      console.log('❌ 未找到 reCAPTCHA iframe');
      return false;
    }

    // 获取所有 iframe
    const frames = page.frames();
    console.log(`📋 检测到 ${frames.length} 个框架`);

    // 查找包含复选框的 iframe (anchor frame)
    for (const frame of frames) {
      const url = frame.url();
      console.log(`🔍 检查框架: ${url}`);
      
      if (url.includes('recaptcha') && url.includes('anchor')) {
        console.log('✅ 找到 reCAPTCHA anchor 框架');
        
        try {
          // 等待复选框出现
          await frame.waitForSelector('#recaptcha-anchor', { timeout: 10000 });
          
          // 点击复选框
          await frame.click('#recaptcha-anchor');
          console.log('✅ 成功点击复选框');
          
          return true;
        } catch (error) {
          console.log(`❌ 点击复选框失败: ${error.message}`);
          
          // 尝试其他可能的选择器
          const selectors = [
            '.recaptcha-checkbox-border',
            '.recaptcha-checkbox',
            '[role="checkbox"]'
          ];
          
          for (const selector of selectors) {
            try {
              await frame.waitForSelector(selector, { timeout: 5000 });
              await frame.click(selector);
              console.log(`✅ 使用选择器 ${selector} 成功点击`);
              return true;
            } catch (e) {
              continue;
            }
          }
        }
      }
    }

    console.log('❌ 未找到可点击的复选框');
    return false;
  }

  /**
   * 检查复选框是否已被勾选（自动通过）
   */
  async _isCheckboxSolved(page) {
    const frames = page.frames();
    
    for (const frame of frames) {
      if (frame.url().includes('recaptcha') && frame.url().includes('anchor')) {
        try {
          const checkbox = await frame.$('#recaptcha-anchor');
          if (checkbox) {
            const isChecked = await checkbox.getAttribute('aria-checked');
            return isChecked === 'true';
          }
        } catch (error) {
          continue;
        }
      }
    }
    
    return false;
  }

  /**
   * 解决音频挑战
   */
  async _solveAudioChallenge(page, language) {
    console.log('🎵 开始音频挑战处理...');

    // 查找挑战框架
    const challengeFrame = await this._findChallengeFrame(page);
    if (!challengeFrame) {
      throw new RecaptchaSolveError('未找到挑战框架');
    }

    let attempts = 0;
    while (attempts < this.maxAttempts) {
      attempts++;
      console.log(`🎯 音频挑战尝试 ${attempts}/${this.maxAttempts}`);

      try {
        // 1. 切换到音频挑战
        await this._switchToAudioChallenge(challengeFrame);

        // 2. 获取音频 URL
        const audioUrl = await this._getAudioUrl(challengeFrame);
        if (!audioUrl) {
          throw new Error('无法获取音频 URL');
        }

        // 3. 下载并处理音频
        const transcription = await this._processAudio(page, audioUrl, language);
        if (!transcription) {
          throw new Error('音频转录失败');
        }

        // 4. 提交答案
        await this._submitAudioResponse(challengeFrame, transcription);

        // 5. 等待验证结果
        await page.waitForTimeout(3000);

        // 6. 检查是否成功
        const isSuccess = await this._isChallengeSolved(page);
        if (isSuccess) {
          console.log('✅ 音频挑战解决成功');
          return true;
        }

        console.log(`❌ 尝试 ${attempts} 失败，准备重试...`);
        if (attempts < this.maxAttempts) {
          await this._reloadChallenge(challengeFrame);
          await page.waitForTimeout(2000);
        }

      } catch (error) {
        console.log(`❌ 音频挑战尝试 ${attempts} 出错: ${error.message}`);
        if (attempts >= this.maxAttempts) {
          throw error;
        }
      }
    }

    return false;
  }

  /**
   * 查找挑战框架
   */
  async _findChallengeFrame(page) {
    const frames = page.frames();
    
    for (const frame of frames) {
      const url = frame.url();
      if (url.includes('recaptcha') && (url.includes('bframe') || url.includes('challenge'))) {
        console.log(`✅ 找到挑战框架: ${url}`);
        return frame;
      }
    }
    
    console.log('❌ 未找到挑战框架');
    return null;
  }

  /**
   * 切换到音频挑战
   */
  async _switchToAudioChallenge(frame) {
    console.log('🔄 切换到音频挑战...');
    
    const audioSelectors = [
      '#recaptcha-audio-button',
      '.rc-button-audio',
      '[aria-label*="audio"]',
      'button[title*="audio"]'
    ];

    for (const selector of audioSelectors) {
      try {
        await frame.waitForSelector(selector, { timeout: 5000 });
        await frame.click(selector);
        console.log(`✅ 使用选择器 ${selector} 切换到音频`);
        await frame.waitForTimeout(2000);
        return;
      } catch (error) {
        continue;
      }
    }

    throw new Error('无法切换到音频挑战');
  }

  /**
   * 获取音频 URL
   */
  async _getAudioUrl(frame) {
    console.log('🔍 获取音频 URL...');
    
    const audioSelectors = [
      '#audio-source',
      '.rc-audiochallenge-tdownload-link',
      'a[href*=".mp3"]',
      'audio source'
    ];

    for (const selector of audioSelectors) {
      try {
        await frame.waitForSelector(selector, { timeout: 5000 });
        const element = await frame.$(selector);
        
        if (element) {
          const href = await element.getAttribute('href') || await element.getAttribute('src');
          if (href && href.includes('.mp3')) {
            console.log(`✅ 找到音频 URL: ${href}`);
            return href;
          }
        }
      } catch (error) {
        continue;
      }
    }

    throw new Error('未找到音频 URL');
  }

  /**
   * 处理音频：下载、转换、识别
   */
  async _processAudio(page, audioUrl, language) {
    try {
      console.log('🎵 开始音频处理...');

      // 初始化音频处理器
      if (!this.audioProcessor.initialized) {
        await this.audioProcessor.initialize();
      }

      // 下载音频
      const audioBuffer = await this.audioProcessor.downloadAudio(page, audioUrl);
      
      // 转换格式
      const wavBuffer = await this.audioProcessor.convertToWav(audioBuffer, 'mp3');
      
      // 语音识别
      const transcription = await this.audioProcessor.transcribeAudio(wavBuffer, language);
      
      console.log(`✅ 音频处理完成: "${transcription}"`);
      return transcription;

    } catch (error) {
      console.error('音频处理失败:', error);
      throw error;
    }
  }

  /**
   * 提交音频响应
   */
  async _submitAudioResponse(frame, text) {
    console.log(`📝 提交音频响应: "${text}"`);
    
    // 查找输入框
    const inputSelectors = [
      '#audio-response',
      '.rc-audiochallenge-response-field',
      'input[name="response"]'
    ];

    for (const selector of inputSelectors) {
      try {
        await frame.waitForSelector(selector, { timeout: 5000 });
        await frame.fill(selector, text);
        console.log(`✅ 使用选择器 ${selector} 填入文本`);
        break;
      } catch (error) {
        continue;
      }
    }

    // 查找提交按钮
    const submitSelectors = [
      '#recaptcha-verify-button',
      '.rc-audiochallenge-verify-button',
      'button[type="submit"]'
    ];

    for (const selector of submitSelectors) {
      try {
        await frame.waitForSelector(selector, { timeout: 5000 });
        await frame.click(selector);
        console.log(`✅ 使用选择器 ${selector} 提交`);
        return;
      } catch (error) {
        continue;
      }
    }

    throw new Error('无法提交音频响应');
  }

  /**
   * 检查挑战是否解决
   */
  async _isChallengeSolved(page) {
    return await this._isCheckboxSolved(page);
  }

  /**
   * 重新加载挑战
   */
  async _reloadChallenge(frame) {
    console.log('🔄 重新加载挑战...');
    
    const reloadSelectors = [
      '#recaptcha-reload-button',
      '.rc-button-reload',
      'button[title*="reload"]'
    ];

    for (const selector of reloadSelectors) {
      try {
        await frame.waitForSelector(selector, { timeout: 3000 });
        await frame.click(selector);
        console.log(`✅ 使用选择器 ${selector} 重新加载`);
        return;
      } catch (error) {
        continue;
      }
    }
  }

  /**
   * 获取 reCAPTCHA token
   */
  async _getToken(page) {
    const methods = [
      // 方法1: 查找隐藏的 textarea
      () => page.evaluate(() => {
        const textarea = document.querySelector('textarea[name="g-recaptcha-response"]');
        return textarea ? textarea.value : null;
      }),
      
      // 方法2: 使用 grecaptcha API
      () => page.evaluate(() => {
        return window.grecaptcha && window.grecaptcha.getResponse ? 
          window.grecaptcha.getResponse() : null;
      }),
      
      // 方法3: 查找 ID
      () => page.evaluate(() => {
        const response = document.getElementById('g-recaptcha-response');
        return response ? response.value : null;
      })
    ];

    for (const method of methods) {
      try {
        const token = await method();
        if (token && token.length > 50) {
          console.log(`✅ 获取到 token (长度: ${token.length})`);
          return token;
        }
      } catch (e) {
        continue;
      }
    }

    console.log('❌ 未获取到有效 token');
    return null;
  }
}

module.exports = SimpleRecaptchaV2Solver;