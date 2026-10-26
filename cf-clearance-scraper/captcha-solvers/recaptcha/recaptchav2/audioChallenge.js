/**
 * reCAPTCHA v2 音频挑战处理器
 * 集成 FFmpeg 本地音频处理和语音识别
 */

const AudioProcessor = require('../common/audioProcessor');
const { AudioTranscriptionError, RecaptchaSolveError } = require('../common/errors');
const { ORIGINAL_LANGUAGE_AUDIO } = require('../common/translations');

class AudioChallenge {
  constructor() {
    this.audioProcessor = new AudioProcessor();
    this.maxAttempts = 5; // 增加尝试次数，像 GoogleRecaptchaBypass 一样
    this.retryDelay = 2000; // 重试延迟
  }

  /**
   * 解决音频挑战
   */
  async solve(recaptchaBox, language = 'en') {
    console.log('🎵 开始音频挑战解决流程...');
    
    // 检查 FFmpeg 可用性
    const ffmpegAvailable = await this.audioProcessor.checkFFmpegAvailability();
    if (!ffmpegAvailable) {
      throw new AudioTranscriptionError('FFmpeg is not available. Please install FFmpeg to process audio challenges.');
    }

    let attempts = 0;
    let solved = false;

    while (attempts < this.maxAttempts && !solved) {
      attempts++;
      console.log(`🎯 音频挑战尝试 ${attempts}/${this.maxAttempts}`);

      try {
        // 1. 切换到音频挑战
        await recaptchaBox.switchToAudio();

        // 2. 获取音频 URL
        const audioUrl = await recaptchaBox.getAudioUrl();
        if (!audioUrl) {
          throw new AudioTranscriptionError('Could not get audio URL');
        }

        // 3. 下载和处理音频（多次尝试转录）
        const transcription = await this._processAudioWithRetry(recaptchaBox.page, audioUrl, language);
        if (!transcription) {
          throw new AudioTranscriptionError('Audio transcription failed after multiple attempts');
        }

        // 4. 提交转录结果
        console.log(`📝 提交转录结果: "${transcription}"`);
        await recaptchaBox.submitAudioResponse(transcription);

        // 5. 等待并检查结果
        await this._waitForVerification(recaptchaBox);

        // 6. 检查是否解决
        if (await recaptchaBox.isSolved()) {
          console.log('✅ 音频挑战解决成功！');
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
        console.error(`❌ 音频挑战尝试 ${attempts} 失败:`, error.message);
        
        if (attempts >= this.maxAttempts) {
          throw error;
        }
        
        // 准备重试
        try {
          await this._prepareRetry(recaptchaBox);
        } catch (retryError) {
          console.error('准备重试失败:', retryError.message);
          throw error; // 抛出原始错误
        }
      }
    }

    // 清理临时文件
    this.audioProcessor.cleanup();

    if (!solved) {
      throw new RecaptchaSolveError(`All ${this.maxAttempts} audio challenge attempts failed`);
    }

    return solved;
  }

  /**
   * 带重试的音频处理：多次尝试转录以提高成功率
   */
  async _processAudioWithRetry(page, audioUrl, language, maxTranscriptionAttempts = 3) {
    for (let attempt = 1; attempt <= maxTranscriptionAttempts; attempt++) {
      try {
        console.log(`🎤 音频转录尝试 ${attempt}/${maxTranscriptionAttempts}`);
        const transcription = await this._processAudio(page, audioUrl, language);
        
        if (transcription && transcription.trim().length > 0) {
          // 验证转录结果的合理性
          if (this._isValidTranscription(transcription)) {
            return transcription;
          } else {
            console.log(`⚠️  转录结果可能不准确: "${transcription}"`);
            if (attempt === maxTranscriptionAttempts) {
              return transcription; // 最后一次尝试，返回无论如何
            }
          }
        }
      } catch (error) {
        console.warn(`音频转录尝试 ${attempt} 失败:`, error.message);
        if (attempt === maxTranscriptionAttempts) {
          throw error;
        }
        // 短暂等待后重试
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    throw new AudioTranscriptionError('All transcription attempts failed');
  }

  /**
   * 处理音频：下载、转换、识别
   */
  async _processAudio(page, audioUrl, language) {
    try {
      console.log('🎵 开始音频处理流程...');

      // 1. 下载音频
      const audioBuffer = await this.audioProcessor.downloadAudio(page, audioUrl);
      
      // 2. 转换为 WAV 格式
      const wavBuffer = await this.audioProcessor.convertToWav(audioBuffer, 'mp3');
      
      // 3. 语音识别
      const languageCode = ORIGINAL_LANGUAGE_AUDIO[language] || 'en-US';
      const transcription = await this.audioProcessor.transcribeAudio(wavBuffer, languageCode);
      
      if (!transcription || transcription.trim().length === 0) {
        throw new AudioTranscriptionError('Empty transcription result');
      }

      console.log(`✅ 音频处理完成，转录结果: "${transcription}"`);
      return transcription;

    } catch (error) {
      console.error('音频处理失败:', error);
      throw new AudioTranscriptionError(`Audio processing failed: ${error.message}`);
    }
  }

  /**
   * 等待验证完成
   */
  async _waitForVerification(recaptchaBox) {
    console.log('⏳ 等待验证结果...');
    
    const maxWait = 10000; // 10秒
    const checkInterval = 500; // 0.5秒检查一次
    const maxChecks = maxWait / checkInterval;
    
    for (let i = 0; i < maxChecks; i++) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      
      // 检查是否已解决
      if (await recaptchaBox.isSolved()) {
        return true;
      }
      
      // 检查是否有错误
      if (await recaptchaBox.hasError()) {
        return false;
      }
    }
    
    console.log('⏰ 验证等待超时');
    return false;
  }

  /**
   * 验证转录结果的合理性
   */
  _isValidTranscription(transcription) {
    if (!transcription || typeof transcription !== 'string') {
      return false;
    }

    const text = transcription.trim().toLowerCase();
    
    // 检查长度（reCAPTCHA 音频通常是短数字序列）
    if (text.length < 2 || text.length > 50) {
      return false;
    }

    // 检查是否包含明显的错误词汇
    const invalidPhrases = [
      'error', 'failed', 'timeout', 'unknown',
      'could not', 'unable to', 'no audio',
      'please try', 'try again'
    ];
    
    for (const phrase of invalidPhrases) {
      if (text.includes(phrase)) {
        return false;
      }
    }

    // 检查是否看起来像数字序列或单词
    const hasNumbers = /\d/.test(text);
    const hasLetters = /[a-z]/.test(text);
    const hasValidChars = /^[a-z0-9\s]+$/.test(text);
    
    return hasValidChars && (hasNumbers || hasLetters);
  }

  /**
   * 准备重试
   */
  async _prepareRetry(recaptchaBox) {
    console.log('🔄 准备下一次尝试...');
    
    try {
      // 查找重新加载按钮并点击
      const reloadButton = await recaptchaBox.bframeFrame.$('#recaptcha-reload-button');
      if (reloadButton) {
        await reloadButton.click();
        console.log('🔄 已点击重新加载按钮');
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        // 如果没有重新加载按钮，等待一下
        console.log('⏳ 等待新挑战加载...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.warn('准备重试时出现警告:', error.message);
      // 不抛出错误，继续重试
      await recaptchaBox.page.waitForTimeout(2000);
    }
  }

  /**
   * 验证语言支持
   */
  _validateLanguage(language) {
    const supportedLanguages = Object.keys(ORIGINAL_LANGUAGE_AUDIO);
    if (!supportedLanguages.includes(language)) {
      console.warn(`不支持的语言: ${language}，使用默认语言: en`);
      return 'en';
    }
    return language;
  }

  /**
   * 获取音频挑战统计信息
   */
  getStats() {
    return {
      processor: 'FFmpeg + Local STT',
      supportedLanguages: Object.keys(ORIGINAL_LANGUAGE_AUDIO),
      maxAttempts: this.maxAttempts,
      features: [
        'Local audio conversion',
        'Multi-language support', 
        'Automatic retry mechanism',
        'Temporary file cleanup'
      ]
    };
  }
}

module.exports = AudioChallenge;