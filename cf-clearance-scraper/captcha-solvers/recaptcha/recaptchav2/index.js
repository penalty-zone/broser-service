/**
 * reCAPTCHA v2 主解决器
 * 协调音频和图像挑战解决方案
 */

const RecaptchaBoxV2 = require('./recaptchaBox');
const AudioChallenge = require('./audioChallenge');
const ImageChallenge = require('./imageChallenge');
const { RecaptchaNotFoundError, RecaptchaSolveError } = require('../common/errors');

class RecaptchaV2Solver {
  constructor() {
    this.audioChallenge = new AudioChallenge();
    this.imageChallenge = new ImageChallenge();
    this.maxAttempts = 3;
    this.preferAudio = true; // 优先使用音频挑战
  }

  /**
   * 解决 reCAPTCHA v2 验证码
   */
  async solve(page, options = {}) {
    const {
      language = 'en',
      preferAudio = this.preferAudio,
      timeout = 120000
    } = options;

    console.log('🤖 开始 reCAPTCHA v2 解决流程...');
    console.log(`⚙️  配置: 语言=${language}, 优先音频=${preferAudio}, 超时=${timeout}ms`);

    const startTime = Date.now();
    let recaptchaBox = null;

    try {
      // 1. 等待页面完全加载
      console.log('⏳ 等待页面和 reCAPTCHA 加载...');
      await page.waitForTimeout(5000);
      
      // 检查页面是否有 reCAPTCHA
      const hasRecaptcha = await page.evaluate(() => {
        return document.querySelector('.g-recaptcha') !== null || 
               document.querySelector('[data-sitekey]') !== null ||
               window.grecaptcha !== undefined;
      });
      
      if (!hasRecaptcha) {
        throw new RecaptchaNotFoundError('No reCAPTCHA found on page');
      }
      
      console.log('✅ 页面包含 reCAPTCHA');
      
      // 2. 多次尝试初始化 reCAPTCHA Box
      recaptchaBox = new RecaptchaBoxV2(page);
      
      let initAttempts = 0;
      const maxInitAttempts = 3;
      
      while (initAttempts < maxInitAttempts) {
        try {
          initAttempts++;
          console.log(`🔄 reCAPTCHA 初始化尝试 ${initAttempts}/${maxInitAttempts}...`);
          
          await recaptchaBox.initialize();
          break; // 成功初始化，跳出循环
          
        } catch (error) {
          console.warn(`⚠️  初始化尝试 ${initAttempts} 失败: ${error.message}`);
          
          if (initAttempts >= maxInitAttempts) {
            throw error; // 最后一次尝试也失败了
          }
          
          // 等待更长时间后重试
          await page.waitForTimeout(5000);
        }
      }

      // 2. 点击复选框
      await recaptchaBox.clickCheckbox();

      // 3. 等待挑战出现（或直接通过）
      const hasChallengeAppeared = await recaptchaBox.waitForChallenge(15000);
      
      if (!hasChallengeAppeared) {
        // 检查是否已经解决
        if (await recaptchaBox.isSolved()) {
          console.log('✅ reCAPTCHA 自动通过，无需解决挑战');
          const token = await recaptchaBox.getToken();
          if (token) {
            console.log(`🎯 成功获取 token (长度: ${token.length})`);
            return {
              success: true,
              token: token,
              challengeType: 'none',
              solveTime: Date.now() - startTime
            };
          }
        }
        throw new RecaptchaSolveError('No challenge appeared and no token found');
      }

      // 4. 检测挑战类型
      const challengeType = await recaptchaBox.getChallengeType();
      console.log(`🎯 检测到挑战类型: ${challengeType || 'unknown'}`);

      // 5. 解决挑战
      let solved = false;
      let usedChallengeType = challengeType;

      if (preferAudio && (challengeType === 'image' || challengeType === 'audio')) {
        // 优先尝试音频挑战
        try {
          console.log('🎵 尝试音频挑战解决...');
          solved = await this.audioChallenge.solve(recaptchaBox, language);
          usedChallengeType = 'audio';
        } catch (error) {
          console.log(`❌ 音频挑战失败: ${error.message}`);
          console.log('🔄 切换到图像挑战...');
          
          // 如果音频失败，尝试图像挑战
          try {
            solved = await this.imageChallenge.solve(recaptchaBox);
            usedChallengeType = 'image';
          } catch (imageError) {
            console.error(`❌ 图像挑战也失败: ${imageError.message}`);
            throw new RecaptchaSolveError(`Both audio and image challenges failed. Audio: ${error.message}. Image: ${imageError.message}`);
          }
        }
      } else if (challengeType === 'image') {
        // 直接使用图像挑战
        console.log('🖼️ 解决图像挑战...');
        solved = await this.imageChallenge.solve(recaptchaBox);
        usedChallengeType = 'image';
      } else if (challengeType === 'audio') {
        // 直接使用音频挑战
        console.log('🎵 解决音频挑战...');
        solved = await this.audioChallenge.solve(recaptchaBox, language);
        usedChallengeType = 'audio';
      } else {
        throw new RecaptchaSolveError(`Unknown or unsupported challenge type: ${challengeType}`);
      }

      if (!solved) {
        throw new RecaptchaSolveError('Challenge solving failed');
      }

      // 6. 获取 token
      console.log('🎯 获取 reCAPTCHA token...');
      const token = await recaptchaBox.getToken();
      
      if (!token) {
        throw new RecaptchaSolveError('Challenge solved but no token found');
      }

      const solveTime = Date.now() - startTime;
      console.log(`✅ reCAPTCHA v2 解决成功！`);
      console.log(`   挑战类型: ${usedChallengeType}`);
      console.log(`   总耗时: ${solveTime}ms`);
      console.log(`   Token长度: ${token.length}`);

      return {
        success: true,
        token: token,
        challengeType: usedChallengeType,
        solveTime: solveTime
      };

    } catch (error) {
      const solveTime = Date.now() - startTime;
      console.error(`❌ reCAPTCHA v2 解决失败 (${solveTime}ms):`, error.message);
      
      throw new RecaptchaSolveError(`reCAPTCHA v2 solving failed after ${solveTime}ms: ${error.message}`);
    }
  }

  /**
   * 获取解决器统计信息
   */
  getStats() {
    return {
      solver: 'reCAPTCHA v2',
      version: '1.0.0',
      supportedChallenges: ['audio', 'image'],
      audioStats: this.audioChallenge.getStats(),
      imageStats: this.imageChallenge.getStats(),
      features: [
        'Automatic challenge detection',
        'Dual challenge support (audio + image)',
        'Configurable challenge preference',
        'Local audio processing with FFmpeg',
        'AI-powered image recognition',
        'Automatic fallback mechanisms',
        'Token extraction and validation'
      ],
      maxAttempts: this.maxAttempts,
      defaultTimeout: 120000
    };
  }

  /**
   * 设置解决器选项
   */
  setOptions(options) {
    if (options.preferAudio !== undefined) {
      this.preferAudio = options.preferAudio;
    }
    if (options.maxAttempts !== undefined) {
      this.maxAttempts = options.maxAttempts;
    }
    
    console.log(`⚙️  解决器选项已更新: 优先音频=${this.preferAudio}, 最大尝试=${this.maxAttempts}`);
  }

  /**
   * 验证环境依赖
   */
  async validateEnvironment() {
    const issues = [];

    // 检查 FFmpeg（音频挑战需要）
    const ffmpegAvailable = await this.audioChallenge.audioProcessor.checkFFmpegAvailability();
    if (!ffmpegAvailable) {
      issues.push('FFmpeg not available - audio challenges will fail');
    }

    // 检查 Gemini API Key（图像挑战需要）
    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!geminiApiKey) {
      issues.push('Gemini API key not found - image challenges will fail');
    }

    if (issues.length > 0) {
      console.warn('⚠️  环境检查发现问题:');
      issues.forEach(issue => console.warn(`   - ${issue}`));
      return { valid: false, issues };
    }

    console.log('✅ 环境检查通过');
    return { valid: true, issues: [] };
  }
}

module.exports = RecaptchaV2Solver;