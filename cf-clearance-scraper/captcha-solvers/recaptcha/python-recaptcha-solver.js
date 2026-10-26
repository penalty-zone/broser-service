/**
 * Python reCAPTCHA v2 Solver
 * 使用 GoogleRecaptchaBypass 的 Python 实现通过 child_process 调用
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class PythonRecaptchaSolver {
    constructor() {
        this.pythonPath = this._findPythonPath();
        this.solverScript = path.join(__dirname, 'python-solver', 'solve_recaptcha.py');
        this.timeout = 180000; // 3 minutes timeout
    }

    /**
     * 查找可用的 Python 路径
     */
    _findPythonPath() {
        const possiblePaths = ['python3', 'python', '/usr/bin/python3', '/usr/local/bin/python3'];
        
        for (const pythonPath of possiblePaths) {
            try {
                const { execSync } = require('child_process');
                execSync(`${pythonPath} --version`, { stdio: 'ignore' });
                return pythonPath;
            } catch (error) {
                continue;
            }
        }
        
        return 'python3'; // 默认使用 python3
    }

    /**
     * 检查 Python 依赖是否已安装
     */
    async checkDependencies() {
        return new Promise((resolve) => {
            const checkScript = `
import sys
try:
    import DrissionPage
    import pydub
    import speech_recognition
    print("OK")
except ImportError as e:
    print(f"MISSING: {e}")
    sys.exit(1)
`;

            const python = spawn(this.pythonPath, ['-c', checkScript]);
            let output = '';
            let error = '';

            python.stdout.on('data', (data) => {
                output += data.toString();
            });

            python.stderr.on('data', (data) => {
                error += data.toString();
            });

            python.on('close', (code) => {
                if (code === 0 && output.includes('OK')) {
                    resolve({ available: true, error: null });
                } else {
                    resolve({ 
                        available: false, 
                        error: error || 'Python dependencies not installed. Run: pip install DrissionPage pydub SpeechRecognition' 
                    });
                }
            });
        });
    }

    /**
     * 安装 Python 依赖
     */
    async installDependencies() {
        console.log('🔧 Installing Python dependencies...');
        
        return new Promise((resolve, reject) => {
            const requirementsPath = path.join(__dirname, 'python-solver', 'requirements.txt');
            const pip = spawn(this.pythonPath, ['-m', 'pip', 'install', '-r', requirementsPath]);
            
            let output = '';
            let error = '';

            pip.stdout.on('data', (data) => {
                output += data.toString();
                console.log('pip:', data.toString().trim());
            });

            pip.stderr.on('data', (data) => {
                error += data.toString();
                console.error('pip error:', data.toString().trim());
            });

            pip.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Python dependencies installed successfully');
                    resolve(true);
                } else {
                    console.error('❌ Failed to install Python dependencies');
                    reject(new Error(`pip install failed with code ${code}: ${error}`));
                }
            });
        });
    }

    /**
     * 直接解决 reCAPTCHA v2 (不使用现有页面，Python 独立处理)
     */
    async solveDirectly(options = {}) {
        const {
            url,
            language = 'en',
            proxy = null,
            headless = false,
            timeout = this.timeout,
            maxRetries = 2
        } = options;

        console.log(`🐍 Python 独立解决 reCAPTCHA v2: ${url}`);

        // 检查依赖
        const depCheck = await this.checkDependencies();
        if (!depCheck.available) {
            console.warn('⚠️ Python dependencies not available:', depCheck.error);
            throw new Error('Python dependencies not installed: ' + depCheck.error);
        }

        // 实现重试逻辑
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            try {
                console.log(`🎯 Python solver attempt ${attempt}/${maxRetries + 1}`);
                const result = await this._solveSingle(url, { language, proxy, headless, timeout });
                console.log(`✅ Python solver succeeded on attempt ${attempt}`);
                return result;
            } catch (error) {
                console.error(`❌ Python solver attempt ${attempt} failed:`, error.message);
                
                if (attempt <= maxRetries) {
                    console.log(`🔄 Retrying in 3 seconds... (${maxRetries + 1 - attempt} attempts remaining)`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } else {
                    throw error;
                }
            }
        }
    }

    /**
     * 解决 reCAPTCHA v2 (旧方法，保持兼容性)
     * @deprecated 使用 solveDirectly 替代
     */
    async solve(page, options = {}) {
        const {
            language = 'en',
            proxy = null,
            headless = true,
            timeout = this.timeout,
            maxRetries = 2
        } = options;

        console.log('🐍 Using Python reCAPTCHA solver...');

        // 检查依赖
        const depCheck = await this.checkDependencies();
        if (!depCheck.available) {
            console.warn('⚠️ Python dependencies not available:', depCheck.error);
            throw new Error('Python dependencies not installed: ' + depCheck.error);
        }

        // 获取当前页面 URL
        const url = page.url();
        console.log(`🔗 Solving reCAPTCHA on: ${url}`);

        // 实现重试逻辑
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            try {
                console.log(`🎯 Python solver attempt ${attempt}/${maxRetries + 1}`);
                const result = await this._solveSingle(url, { language, proxy, headless, timeout });
                console.log(`✅ Python solver succeeded on attempt ${attempt}`);
                return result;
            } catch (error) {
                console.error(`❌ Python solver attempt ${attempt} failed:`, error.message);
                
                if (attempt <= maxRetries) {
                    console.log(`🔄 Retrying in 3 seconds... (${maxRetries + 1 - attempt} attempts remaining)`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } else {
                    throw error;
                }
            }
        }
    }

    /**
     * 单次解决尝试
     */
    async _solveSingle(url, { language, proxy, headless, timeout }) {
        return new Promise((resolve, reject) => {
            const args = [
                this.solverScript,
                '--url', url,
                '--language', language,
                '--output', 'json'
            ];

            if (proxy) {
                // 处理代理格式转换
                let proxyString;
                if (typeof proxy === 'object' && proxy.host && proxy.port) {
                    // 对象格式: {host, port, username, password}
                    if (proxy.username && proxy.password) {
                        proxyString = `${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
                    } else {
                        proxyString = `${proxy.host}:${proxy.port}`;
                    }
                } else if (typeof proxy === 'string') {
                    // 字符串格式直接使用
                    proxyString = proxy;
                } else {
                    console.warn('⚠️  Invalid proxy format, skipping proxy');
                    proxyString = null;
                }
                
                if (proxyString) {
                    args.push('--proxy', proxyString);
                    console.log(`🌐 Using proxy: ${proxyString.replace(/:[^:@]*@/, ':***@')}`); // 隐藏密码
                }
            }

            if (headless) {
                args.push('--headless');
            }

            console.log(`🚀 启动独立 Python 浏览器进程: ${this.pythonPath} ${args.join(' ')}`);
            console.log('💡 注意: Python 脚本将启动自己的浏览器实例，这是正常的');

            const python = spawn(this.pythonPath, args, {
                cwd: path.dirname(this.solverScript),
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            python.stderr.on('data', (data) => {
                stderr += data.toString();
                // 实时输出 Python 脚本的日志
                console.log('Python:', data.toString().trim());
            });

            // 设置超时
            const timeoutId = setTimeout(() => {
                python.kill('SIGTERM');
                reject(new Error('Python solver timeout'));
            }, timeout);

            python.on('close', (code) => {
                clearTimeout(timeoutId);
                
                try {
                    if (code === 0) {
                        const result = JSON.parse(stdout.trim());
                        
                        if (result.success && result.token) {
                            console.log(`✅ Python solver succeeded in ${result.solve_time}ms`);
                            resolve({
                                success: true,
                                token: result.token,
                                challengeType: result.challenge_type,
                                solveTime: result.solve_time
                            });
                        } else {
                            console.error('❌ Python solver failed:', result.error);
                            reject(new Error(result.error || 'Unknown Python solver error'));
                        }
                    } else {
                        console.error('❌ Python process failed with code:', code);
                        console.error('Stderr:', stderr);
                        reject(new Error(`Python process failed with code ${code}: ${stderr}`));
                    }
                } catch (parseError) {
                    console.error('❌ Failed to parse Python output:', stdout);
                    reject(new Error(`Failed to parse Python output: ${parseError.message}`));
                }
            });

            python.on('error', (error) => {
                clearTimeout(timeoutId);
                console.error('❌ Python process error:', error);
                reject(new Error(`Python process error: ${error.message}`));
            });
        });
    }

    /**
     * 获取解决器信息
     */
    getInfo() {
        return {
            name: 'Python reCAPTCHA v2 Solver',
            version: '1.0.0',
            description: 'Uses GoogleRecaptchaBypass Python implementation via child_process',
            pythonPath: this.pythonPath,
            solverScript: this.solverScript,
            timeout: this.timeout,
            supportedChallenges: ['audio'],
            dependencies: ['python3', 'DrissionPage', 'pydub', 'SpeechRecognition']
        };
    }

    /**
     * 环境验证
     */
    async validateEnvironment() {
        const issues = [];

        // 检查 Python 脚本文件
        if (!fs.existsSync(this.solverScript)) {
            issues.push(`Python solver script not found: ${this.solverScript}`);
        }

        // 检查 Python 可执行文件
        try {
            const { execSync } = require('child_process');
            execSync(`${this.pythonPath} --version`, { stdio: 'ignore' });
        } catch (error) {
            issues.push(`Python not found or not executable: ${this.pythonPath}`);
        }

        // 检查 Python 依赖
        const depCheck = await this.checkDependencies();
        if (!depCheck.available) {
            issues.push(`Python dependencies missing: ${depCheck.error}`);
        }

        return {
            valid: issues.length === 0,
            issues: issues
        };
    }
}

module.exports = PythonRecaptchaSolver;