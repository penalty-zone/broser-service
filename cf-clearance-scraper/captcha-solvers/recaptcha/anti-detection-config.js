/**
 * reCAPTCHA 反检测配置
 * 用于绕过 Google 的自动化检测
 */

// 随机用户代理列表
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
];

// 随机屏幕分辨率
const SCREEN_SIZES = [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 2560, height: 1440 },
    { width: 1680, height: 1050 }
];

// 随机语言设置
const LANGUAGES = [
    'en-US,en;q=0.9',
    'en-GB,en;q=0.9',
    'zh-CN,zh;q=0.9,en;q=0.8',
    'ja-JP,ja;q=0.9,en;q=0.8',
    'de-DE,de;q=0.9,en;q=0.8'
];

// 随机时区
const TIMEZONES = [
    'America/New_York',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Berlin',
    'Asia/Tokyo',
    'Asia/Shanghai'
];

/**
 * 生成随机的反检测配置
 */
function generateAntiDetectionConfig() {
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const screenSize = SCREEN_SIZES[Math.floor(Math.random() * SCREEN_SIZES.length)];
    const language = LANGUAGES[Math.floor(Math.random() * LANGUAGES.length)];
    const timezone = TIMEZONES[Math.floor(Math.random() * TIMEZONES.length)];
    
    return {
        userAgent,
        viewport: {
            width: screenSize.width,
            height: screenSize.height
        },
        language,
        timezone,
        // 随机延迟范围 (秒)
        delays: {
            beforeClick: Math.random() * 2 + 1, // 1-3秒
            afterClick: Math.random() * 3 + 2,  // 2-5秒
            beforeSubmit: Math.random() * 2 + 1 // 1-3秒
        }
    };
}

/**
 * 获取 DrissionPage 的反检测配置
 */
function getDrissionPageConfig() {
    const config = generateAntiDetectionConfig();
    
    return {
        userAgent: config.userAgent,
        windowSize: [config.viewport.width, config.viewport.height],
        language: config.language.split(',')[0],
        timezone: config.timezone,
        delays: config.delays,
        // Chrome 启动参数
        chromiumArgs: [
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-images', // 禁用图片加载以提高速度
            `--user-agent=${config.userAgent}`,
            `--window-size=${config.viewport.width},${config.viewport.height}`,
            `--lang=${config.language.split(',')[0]}`,
            // 禁用自动化检测
            '--disable-blink-features=AutomationControlled',
            '--exclude-switches=enable-automation',
            '--disable-extensions-http-throttling',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-sync',
            '--metrics-recording-only',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--enable-automation=false'
        ]
    };
}

/**
 * 模拟人类行为的延迟
 */
async function humanDelay(min = 1000, max = 3000) {
    const delay = Math.random() * (max - min) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 模拟鼠标移动
 */
async function simulateMouseMovement(page) {
    try {
        // 随机移动鼠标几次
        for (let i = 0; i < Math.floor(Math.random() * 3) + 2; i++) {
            const x = Math.floor(Math.random() * 800) + 100;
            const y = Math.floor(Math.random() * 600) + 100;
            await page.mouse.move(x, y);
            await humanDelay(200, 800);
        }
    } catch (error) {
        // 忽略鼠标移动错误
    }
}

/**
 * 请求限制管理器
 */
class RequestRateLimiter {
    constructor() {
        this.lastRequestTime = 0;
        this.requestCount = 0;
        this.dailyLimit = 50; // 每日限制
        this.minInterval = 30000; // 最小间隔30秒
        this.requests = []; // 记录请求时间
    }

    /**
     * 检查是否可以发起请求
     */
    canMakeRequest() {
        const now = Date.now();
        
        // 清理24小时前的请求记录
        this.requests = this.requests.filter(time => now - time < 24 * 60 * 60 * 1000);
        
        // 检查日限制
        if (this.requests.length >= this.dailyLimit) {
            return { allowed: false, reason: 'Daily limit exceeded', waitTime: null };
        }
        
        // 检查时间间隔
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minInterval) {
            const waitTime = this.minInterval - timeSinceLastRequest;
            return { allowed: false, reason: 'Too frequent', waitTime };
        }
        
        return { allowed: true };
    }

    /**
     * 记录请求
     */
    recordRequest() {
        const now = Date.now();
        this.lastRequestTime = now;
        this.requests.push(now);
        this.requestCount++;
    }

    /**
     * 获取建议的等待时间
     */
    getSuggestedWaitTime() {
        // 根据最近的请求频率动态调整等待时间
        const recentRequests = this.requests.filter(time => Date.now() - time < 60 * 60 * 1000); // 1小时内
        
        if (recentRequests.length > 10) {
            return Math.random() * 60000 + 60000; // 1-2分钟
        } else if (recentRequests.length > 5) {
            return Math.random() * 30000 + 30000; // 30秒-1分钟
        } else {
            return Math.random() * 15000 + 15000; // 15-30秒
        }
    }
}

// 全局限制器实例
const globalRateLimiter = new RequestRateLimiter();

module.exports = {
    generateAntiDetectionConfig,
    getDrissionPageConfig,
    humanDelay,
    simulateMouseMovement,
    RequestRateLimiter,
    globalRateLimiter,
    USER_AGENTS,
    SCREEN_SIZES,
    LANGUAGES,
    TIMEZONES
};