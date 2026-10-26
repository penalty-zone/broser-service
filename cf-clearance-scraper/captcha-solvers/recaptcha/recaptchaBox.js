/**
 * reCAPTCHA Box Handler
 * Manages reCAPTCHA iframe detection and interaction
 */

const { RecaptchaNotFoundError } = require('./errors');
const { SELECTORS } = require('./translations');

class RecaptchaBox {
  constructor(page) {
    this.page = page;
    this.anchorFrame = null;
    this.bframeFrame = null;
  }

  /**
   * Find and initialize reCAPTCHA frames
   */
  async initialize() {
    console.log('🔍 开始检测 reCAPTCHA 框架...');
    
    // 等待页面完全加载
    await this.page.waitForTimeout(3000);
    
    const frames = this.page.frames();
    console.log(`📋 检测到 ${frames.length} 个框架:`);
    
    frames.forEach((frame, index) => {
      console.log(`   框架 ${index}: ${frame.url()}`);
    });
    
    const framePairs = this._getRecaptchaFramePairs(frames);
    
    if (framePairs.length === 0) {
      console.log('⚠️  未找到标准 reCAPTCHA 框架对，尝试备用检测方法...');
      
      // 尝试备用检测方法
      const alternativePairs = this._getAlternativeFramePairs(frames);
      
      if (alternativePairs.length === 0) {
        // 详细的错误信息
        const recaptchaFrames = frames.filter(frame => 
          frame.url().includes('recaptcha') || frame.url().includes('google.com')
        );
        
        console.log('❌ reCAPTCHA 框架检测失败');
        console.log(`   找到 ${recaptchaFrames.length} 个相关框架:`);
        recaptchaFrames.forEach((frame, index) => {
          console.log(`     ${index}: ${frame.url()}`);
        });
        
        throw new RecaptchaNotFoundError('No valid reCAPTCHA frame pairs found');
      }
      
      [this.anchorFrame, this.bframeFrame] = alternativePairs[0];
    } else {
      // Use the first pair found
      [this.anchorFrame, this.bframeFrame] = framePairs[0];
    }
    
    console.log('✅ reCAPTCHA frames detected');
    console.log(`   Anchor 框架: ${this.anchorFrame.url()}`);
    console.log(`   Challenge 框架: ${this.bframeFrame.url()}`);
    
    return this;
  }

  /**
   * Get reCAPTCHA anchor and bframe frame pairs
   */
  _getRecaptchaFramePairs(frames) {
    console.log('🔍 使用标准方法检测 reCAPTCHA 框架...');
    
    const anchorFrames = frames.filter(frame => 
      /\/recaptcha\/(api2|enterprise)\/anchor/.test(frame.url())
    );
    
    const bframeFrames = frames.filter(frame =>
      /\/recaptcha\/(api2|enterprise)\/bframe/.test(frame.url())
    );
    
    console.log(`   找到 ${anchorFrames.length} 个 anchor 框架`);
    console.log(`   找到 ${bframeFrames.length} 个 bframe 框架`);
    
    const framePairs = [];
    
    for (const anchorFrame of anchorFrames) {
      const frameId = this._extractFrameId(anchorFrame.name());
      
      for (const bframeFrame of bframeFrames) {
        if (bframeFrame.name().includes(frameId)) {
          framePairs.push([anchorFrame, bframeFrame]);
        }
      }
    }
    
    // 如果没有找到匹配的框架对，尝试简单配对
    if (framePairs.length === 0 && anchorFrames.length > 0 && bframeFrames.length > 0) {
      console.log('   尝试简单配对...');
      framePairs.push([anchorFrames[0], bframeFrames[0]]);
    }
    
    return framePairs;
  }

  /**
   * 备用框架检测方法
   */
  _getAlternativeFramePairs(frames) {
    console.log('🔍 使用备用方法检测 reCAPTCHA 框架...');
    
    // 更宽松的检测条件
    const recaptchaFrames = frames.filter(frame => {
      const url = frame.url();
      return url.includes('recaptcha') || url.includes('google.com/recaptcha');
    });
    
    console.log(`   找到 ${recaptchaFrames.length} 个 reCAPTCHA 相关框架`);
    
    // 按 URL 特征分类
    const anchorFrames = recaptchaFrames.filter(frame => 
      frame.url().includes('anchor') || frame.url().includes('checkbox')
    );
    
    const challengeFrames = recaptchaFrames.filter(frame => 
      frame.url().includes('bframe') || frame.url().includes('challenge')
    );
    
    // 如果没有明确的分类，尝试按顺序配对
    if (anchorFrames.length === 0 || challengeFrames.length === 0) {
      if (recaptchaFrames.length >= 2) {
        console.log('   按顺序配对 reCAPTCHA 框架...');
        return [[recaptchaFrames[0], recaptchaFrames[1]]];
      }
    }
    
    // 标准配对
    const framePairs = [];
    if (anchorFrames.length > 0 && challengeFrames.length > 0) {
      framePairs.push([anchorFrames[0], challengeFrames[0]]);
    }
    
    return framePairs;
  }

  /**
   * Extract frame ID from frame name
   */
  _extractFrameId(frameName) {
    // Frame names typically follow pattern like "a-xyz123" or "c-xyz123"
    return frameName.length > 2 ? frameName.substring(2) : frameName;
  }

  /**
   * Click the reCAPTCHA checkbox
   */
  async clickCheckbox() {
    if (!this.anchorFrame) {
      throw new RecaptchaNotFoundError('Anchor frame not initialized');
    }
    
    try {
      await this.anchorFrame.waitForSelector(SELECTORS.checkbox, { timeout: 10000 });
      await this.anchorFrame.click(SELECTORS.checkbox);
      console.log('✅ Clicked reCAPTCHA checkbox');
      
      // Wait a moment for the challenge to appear
      await this.page.waitForTimeout(2000);
      
    } catch (error) {
      throw new Error(`Failed to click checkbox: ${error.message}`);
    }
  }

  /**
   * Check if checkbox is already checked (solved)
   */
  async isCheckboxChecked() {
    if (!this.anchorFrame) return false;
    
    try {
      const checkbox = await this.anchorFrame.$(SELECTORS.checkbox);
      if (!checkbox) return false;
      
      const isChecked = await checkbox.getAttribute('aria-checked');
      return isChecked === 'true';
    } catch (error) {
      console.error('Error checking checkbox state:', error);
      return false;
    }
  }

  /**
   * Wait for challenge to appear
   */
  async waitForChallenge(timeout = 10000) {
    if (!this.bframeFrame) {
      throw new RecaptchaNotFoundError('Challenge frame not initialized');
    }
    
    try {
      // Wait for either audio or image challenge to appear
      await Promise.race([
        this.bframeFrame.waitForSelector(SELECTORS.audio_button, { timeout }),
        this.bframeFrame.waitForSelector(SELECTORS.image_button, { timeout }),
        this.bframeFrame.waitForSelector(SELECTORS.challenge_title, { timeout })
      ]);
      
      console.log('✅ Challenge detected');
      return true;
    } catch (error) {
      console.log('No challenge appeared - may have been solved automatically');
      return false;
    }
  }

  /**
   * Detect challenge type
   */
  async getChallengeType() {
    if (!this.bframeFrame) return null;
    
    try {
      const audioButton = await this.bframeFrame.$(SELECTORS.audio_button);
      const imageButton = await this.bframeFrame.$(SELECTORS.image_button);
      const challengeTitle = await this.bframeFrame.$(SELECTORS.challenge_title);
      
      if (audioButton) {
        return 'audio';
      } else if (imageButton) {
        return 'image';
      } else if (challengeTitle) {
        return 'image'; // Image challenge is active
      }
      
      return null;
    } catch (error) {
      console.error('Error detecting challenge type:', error);
      return null;
    }
  }

  /**
   * Switch to audio challenge
   */
  async switchToAudio() {
    if (!this.bframeFrame) {
      throw new RecaptchaNotFoundError('Challenge frame not initialized');
    }
    
    try {
      await this.bframeFrame.waitForSelector(SELECTORS.audio_button, { timeout: 5000 });
      await this.bframeFrame.click(SELECTORS.audio_button);
      console.log('✅ Switched to audio challenge');
      
      // Wait for audio challenge to load
      await this.page.waitForTimeout(2000);
      
    } catch (error) {
      throw new Error(`Failed to switch to audio challenge: ${error.message}`);
    }
  }

  /**
   * Get audio challenge URL
   */
  async getAudioUrl() {
    if (!this.bframeFrame) return null;
    
    try {
      await this.bframeFrame.waitForSelector(SELECTORS.audio_source, { timeout: 10000 });
      const audioLink = await this.bframeFrame.$(SELECTORS.audio_source);
      
      if (!audioLink) return null;
      
      const href = await audioLink.getAttribute('href');
      return href;
    } catch (error) {
      console.error('Error getting audio URL:', error);
      return null;
    }
  }

  /**
   * Submit audio response
   */
  async submitAudioResponse(text) {
    if (!this.bframeFrame) {
      throw new RecaptchaNotFoundError('Challenge frame not initialized');
    }
    
    try {
      // Enter the transcribed text
      await this.bframeFrame.waitForSelector(SELECTORS.audio_response, { timeout: 5000 });
      await this.bframeFrame.fill(SELECTORS.audio_response, text);
      
      // Click verify button
      await this.bframeFrame.waitForSelector(SELECTORS.verify_button, { timeout: 5000 });
      await this.bframeFrame.click(SELECTORS.verify_button);
      
      console.log(`✅ Submitted audio response: "${text}"`);
      
      // Wait for verification
      await this.page.waitForTimeout(3000);
      
    } catch (error) {
      throw new Error(`Failed to submit audio response: ${error.message}`);
    }
  }

  /**
   * Get challenge title text (for image challenges)
   */
  async getChallengeTitle() {
    if (!this.bframeFrame) return null;
    
    try {
      const titleElement = await this.bframeFrame.$(SELECTORS.challenge_title);
      if (!titleElement) return null;
      
      const title = await titleElement.textContent();
      return title ? title.trim() : null;
    } catch (error) {
      console.error('Error getting challenge title:', error);
      return null;
    }
  }

  /**
   * Get image challenge tiles
   */
  async getImageTiles() {
    if (!this.bframeFrame) return [];
    
    try {
      await this.bframeFrame.waitForSelector(SELECTORS.image_table, { timeout: 5000 });
      const tiles = await this.bframeFrame.$$(SELECTORS.image_tile);
      
      console.log(`Found ${tiles.length} image tiles`);
      return tiles;
    } catch (error) {
      console.error('Error getting image tiles:', error);
      return [];
    }
  }

  /**
   * Click image tiles by indices
   */
  async clickImageTiles(indices) {
    const tiles = await this.getImageTiles();
    
    for (const index of indices) {
      if (index >= 0 && index < tiles.length) {
        try {
          await tiles[index].click();
          console.log(`✅ Clicked tile ${index}`);
          await this.page.waitForTimeout(500); // Small delay between clicks
        } catch (error) {
          console.error(`Failed to click tile ${index}:`, error);
        }
      }
    }
  }

  /**
   * Submit image challenge
   */
  async submitImageChallenge() {
    if (!this.bframeFrame) {
      throw new RecaptchaNotFoundError('Challenge frame not initialized');
    }
    
    try {
      await this.bframeFrame.waitForSelector(SELECTORS.verify_button, { timeout: 5000 });
      await this.bframeFrame.click(SELECTORS.verify_button);
      
      console.log('✅ Submitted image challenge');
      
      // Wait for verification
      await this.page.waitForTimeout(3000);
      
    } catch (error) {
      throw new Error(`Failed to submit image challenge: ${error.message}`);
    }
  }

  /**
   * Check for error messages
   */
  async hasError() {
    if (!this.bframeFrame) return false;
    
    try {
      const errorElement = await this.bframeFrame.$(SELECTORS.error_message);
      return errorElement !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get reCAPTCHA response token
   */
  async getToken() {
    try {
      // Try multiple ways to get the token
      const methods = [
        () => this.page.evaluate(() => {
          const textarea = document.querySelector('textarea[name="g-recaptcha-response"]');
          return textarea ? textarea.value : null;
        }),
        () => this.page.evaluate(() => {
          return window.grecaptcha && window.grecaptcha.getResponse ? 
            window.grecaptcha.getResponse() : null;
        }),
        () => this.page.evaluate(() => {
          const response = document.getElementById('g-recaptcha-response');
          return response ? response.value : null;
        })
      ];
      
      for (const method of methods) {
        try {
          const token = await method();
          if (token && token.length > 50) { // Valid tokens are usually much longer
            return token;
          }
        } catch (e) {
          // Continue to next method
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error getting token:', error);
      return null;
    }
  }
}

module.exports = RecaptchaBox;