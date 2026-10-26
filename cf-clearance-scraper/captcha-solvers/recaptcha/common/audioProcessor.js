/**
 * 音频处理模块
 * 基于 FFmpeg 进行本地音频转换和处理
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { AudioTranscriptionError } = require('./errors');
const NodeAudioProcessor = require('./nodeAudioProcessor');

class AudioProcessor {
  constructor() {
    this.tempDir = '/tmp';
    this.supportedFormats = ['mp3', 'wav', 'ogg', 'webm'];
    this.nodeProcessor = new NodeAudioProcessor();
    this.useNodeProcessor = true; // 优先使用 Node.js 实现
  }

  /**
   * 下载音频文件
   */
  async downloadAudio(page, audioUrl) {
    if (this.useNodeProcessor) {
      return await this.nodeProcessor.downloadAudio(page, audioUrl);
    }
    
    try {
      console.log(`🎵 开始下载音频: ${audioUrl}`);
      
      const response = await page.evaluate(async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Array.from(new Uint8Array(arrayBuffer));
      }, audioUrl);

      const audioBuffer = Buffer.from(response);
      console.log(`✅ 音频下载完成，大小: ${audioBuffer.length} bytes`);
      
      return audioBuffer;
    } catch (error) {
      console.error('音频下载失败:', error);
      throw new AudioTranscriptionError(`Failed to download audio: ${error.message}`);
    }
  }

  /**
   * 使用 FFmpeg 将音频转换为 WAV 格式
   */
  async convertToWav(audioBuffer, inputFormat = 'mp3') {
    if (this.useNodeProcessor) {
      return await this.nodeProcessor.convertToWav(audioBuffer, inputFormat);
    }
    
    // 回退到原有实现
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();
      const inputPath = path.join(this.tempDir, `recaptcha_input_${timestamp}.${inputFormat}`);
      const outputPath = path.join(this.tempDir, `recaptcha_output_${timestamp}.wav`);

      try {
        // 写入临时文件
        fs.writeFileSync(inputPath, audioBuffer);
        console.log(`🔄 开始音频转换: ${inputFormat} → WAV`);

        // FFmpeg 转换命令
        const ffmpeg = spawn('ffmpeg', [
          '-i', inputPath,           // 输入文件
          '-ar', '16000',            // 采样率 16kHz (语音识别标准)
          '-ac', '1',                // 单声道
          '-f', 'wav',               // 输出格式
          '-y',                      // 覆盖输出文件
          outputPath                 // 输出文件
        ]);

        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
          // 清理输入文件
          try {
            fs.unlinkSync(inputPath);
          } catch (e) {}

          if (code === 0) {
            try {
              const wavBuffer = fs.readFileSync(outputPath);
              fs.unlinkSync(outputPath); // 清理输出文件
              console.log(`✅ 音频转换完成，WAV大小: ${wavBuffer.length} bytes`);
              resolve(wavBuffer);
            } catch (error) {
              reject(new AudioTranscriptionError(`Failed to read converted audio: ${error.message}`));
            }
          } else {
            console.error('FFmpeg 错误输出:', stderr);
            reject(new AudioTranscriptionError(`FFmpeg conversion failed with code ${code}`));
          }
        });

        ffmpeg.on('error', (error) => {
          // 清理文件
          try {
            fs.unlinkSync(inputPath);
          } catch (e) {}
          reject(new AudioTranscriptionError(`FFmpeg spawn error: ${error.message}`));
        });

      } catch (error) {
        reject(new AudioTranscriptionError(`Audio conversion setup failed: ${error.message}`));
      }
    });
  }

  /**
   * 本地语音识别（优先使用 Node.js Whisper 实现）
   */
  async transcribeAudio(wavBuffer, language = 'en-US') {
    if (this.useNodeProcessor) {
      try {
        return await this.nodeProcessor.transcribeAudio(wavBuffer, language);
      } catch (error) {
        console.warn('Node.js 音频处理失败，回退到传统方法:', error.message);
        // 继续使用传统方法
      }
    }
    
    try {
      console.log(`🎤 开始本地语音识别，语言: ${language}`);
      
      const transcription = await this._transcribeWithLocalSTT(wavBuffer, language);
      
      if (!transcription || transcription.trim().length === 0) {
        throw new AudioTranscriptionError('Transcription result is empty');
      }

      console.log(`✅ 语音识别完成: "${transcription}"`);
      return transcription.trim();

    } catch (error) {
      console.error('语音识别失败:', error);
      throw new AudioTranscriptionError(`Speech recognition failed: ${error.message}`);
    }
  }

  /**
   * 本地 STT 实现（占位符）
   * 可以集成 Whisper 或其他开源模型
   */
  async _transcribeWithLocalSTT(wavBuffer, language) {
    // TODO: 集成本地语音识别模型
    // 示例集成方案：
    
    // 方案1: 使用 @xenova/transformers (Whisper)
    /*
    const { pipeline } = require('@xenova/transformers');
    const transcriber = await pipeline('automatic-speech-recognition', 'openai/whisper-tiny');
    const result = await transcriber(wavBuffer);
    return result.text;
    */

    // 方案2: 使用 Google Speech Recognition (作为临时方案)
    /*
    const speech = require('@google-cloud/speech');
    const client = new speech.SpeechClient();
    const request = {
      audio: { content: wavBuffer.toString('base64') },
      config: {
        encoding: 'WEBM_OPUS',
        languageCode: language,
      },
    };
    const [response] = await client.recognize(request);
    return response.results?.[0]?.alternatives?.[0]?.transcript || '';
    */

    // 临时实现：返回模拟结果
    console.log('⚠️  当前使用模拟语音识别结果');
    console.log('   请集成真实的本地 STT 模型以获得实际功能');
    
    // 模拟一些常见的 reCAPTCHA 音频内容
    const mockTranscriptions = [
      'seven three nine',
      'two five eight',
      'four one six',
      'nine seven two',
      'three eight five'
    ];
    
    return mockTranscriptions[Math.floor(Math.random() * mockTranscriptions.length)];
  }

  /**
   * 检查 FFmpeg 是否可用
   */
  async checkFFmpegAvailability() {
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', ['-version']);
      
      ffmpeg.on('close', (code) => {
        resolve(code === 0);
      });
      
      ffmpeg.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * 清理临时文件
   */
  cleanup() {
    try {
      const files = fs.readdirSync(this.tempDir);
      const recaptchaFiles = files.filter(file => file.startsWith('recaptcha_'));
      
      for (const file of recaptchaFiles) {
        try {
          fs.unlinkSync(path.join(this.tempDir, file));
        } catch (e) {
          // 忽略清理错误
        }
      }
    } catch (error) {
      console.warn('临时文件清理警告:', error.message);
    }
  }
}

module.exports = AudioProcessor;