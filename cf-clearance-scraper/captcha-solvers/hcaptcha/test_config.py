#!/usr/bin/env python3
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# 加载根目录的统一配置文件
root_dir = Path(__file__).parent.parent.parent
env_path = root_dir / '.env'
print(f"🔍 环境文件路径: {env_path}")
print(f"🔍 文件是否存在: {env_path.exists()}")

load_dotenv(env_path)

api_key = os.getenv('GEMINI_API_KEY')
print(f"🔑 API密钥状态: {'已配置' if api_key and api_key != 'your_actual_gemini_api_key_here' else '未配置或为示例值'}")
if api_key:
    print(f"🔑 API密钥末尾: ...{api_key[-8:]}")

# 测试导入
try:
    from hcaptcha_challenger import AgentV, AgentConfig
    print("✅ hcaptcha-challenger 导入成功")
except ImportError as e:
    print(f"❌ hcaptcha-challenger 导入失败: {e}")

try:
    from playwright.async_api import async_playwright
    print("✅ playwright 导入成功")
except ImportError as e:
    print(f"❌ playwright 导入失败: {e}")