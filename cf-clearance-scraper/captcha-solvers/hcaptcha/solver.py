#!/usr/bin/env python3
"""
hCaptcha 解决器 - 使用原始 hcaptcha-challenger 库
只作为中间件，不修改原始代码
"""
import asyncio
import json
import sys
import os
import random
from pathlib import Path
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# 加载根目录的统一配置文件
root_dir = Path(__file__).parent.parent.parent
env_path = root_dir / '.env'
load_dotenv(env_path, override=True)  # 强制覆盖现有环境变量

# 根据配置设置日志级别
log_level = os.getenv('PYTHON_LOG_LEVEL', 'CRITICAL')
import logging
if log_level == 'CRITICAL':
    logging.disable(logging.CRITICAL)
else:
    logging.basicConfig(level=getattr(logging, log_level.upper()))

# 禁用loguru日志 (如果配置为CRITICAL)
try:
    from loguru import logger
    if log_level == 'CRITICAL':
        logger.remove()
        logger.add(lambda _: None)  # 禁用所有输出
except ImportError:
    pass

from hcaptcha_challenger import AgentV, AgentConfig

def get_random_gemini_api_key():
    """
    从配置中随机选择一个Gemini API密钥
    """
    # 优先使用多个密钥配置
    api_keys_str = os.getenv('GEMINI_API_KEYS')
    if api_keys_str:
        api_keys = [key.strip() for key in api_keys_str.split(',') if key.strip()]
        if api_keys:
            selected_key = random.choice(api_keys)
            print(f"🔑 从{len(api_keys)}个API密钥中随机选择了一个密钥 (末尾: ...{selected_key[-8:]})")
            return selected_key
    
    # 如果没有配置多个密钥，使用单个密钥
    single_key = os.getenv('GEMINI_API_KEY')
    if single_key:
        print(f"🔑 使用单个API密钥 (末尾: ...{single_key[-8:]})")
        return single_key
    
    # 没有配置任何密钥
    raise ValueError("未配置任何Gemini API密钥。请设置GEMINI_API_KEY或GEMINI_API_KEYS环境变量")

async def solve_hcaptcha(website_url: str, website_key: str, proxy: str = None):
    """
    使用原始 hcaptcha-challenger 解决验证码
    """
    try:
        async with async_playwright() as p:
            # 使用简单的浏览器配置
            launch_options = {
                "headless": True,
                "args": ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
            }
            
            if proxy:
                launch_options["proxy"] = {"server": proxy}
            
            browser = await p.chromium.launch(**launch_options)
            context = await browser.new_context()
            page = await context.new_page()
            
            # 导航到目标页面 (使用统一配置的超时时间)
            page_timeout = int(os.getenv('HCAPTCHA_PAGE_TIMEOUT', '30000'))
            await page.goto(website_url, timeout=page_timeout)
            
            # 随机选择一个API密钥
            selected_api_key = get_random_gemini_api_key()
            
            # 按照官方示例初始化Agent，传入选择的API密钥
            agent_config = AgentConfig()
            
            # 设置Gemini API密钥到环境变量（hcaptcha-challenger会从环境变量读取）
            os.environ['GEMINI_API_KEY'] = selected_api_key
            
            agent = AgentV(page=page, agent_config=agent_config)
            
            # 按照官方API流程：点击checkbox -> 等待挑战
            await agent.robotic_arm.click_checkbox()
            await agent.wait_for_challenge()
            
            await browser.close()
            
            # 提取结果 - 按照官方示例
            if agent.cr_list:
                cr = agent.cr_list[-1]
                response_data = cr.model_dump(by_alias=True)
                
                # 提取token
                token = None
                if 'generated_pass_UUID' in response_data:
                    token = response_data['generated_pass_UUID']
                elif 'c' in response_data and response_data['c'] and 'req' in response_data['c']:
                    token = response_data['c']['req']
                
                if token:
                    return {
                        "code": 200,
                        "message": "hCaptcha solved successfully",
                        "token": token
                    }
                else:
                    return {
                        "code": 500,
                        "message": "Failed to extract token from response",
                        "token": None
                    }
            else:
                return {
                    "code": 500,
                    "message": "No challenge response found",
                    "token": None
                }
                
    except Exception as e:
        return {
            "code": 500,
            "message": f"Error: {str(e)}",
            "token": None
        }

async def main():
    """主函数"""
    try:
        if len(sys.argv) < 2:
            result = {
                "code": 400,
                "message": "Usage: python solver.py '{\"websiteUrl\":\"...\",\"websiteKey\":\"...\",\"proxy\":\"...\"}'",
                "token": None
            }
            print(json.dumps(result))
            return
        
        params = json.loads(sys.argv[1])
        website_url = params.get('websiteUrl')
        website_key = params.get('websiteKey')
        proxy = params.get('proxy')
        
        if not website_url or not website_key:
            result = {
                "code": 400,
                "message": "Missing required parameters: websiteUrl and websiteKey",
                "token": None
            }
            print(json.dumps(result))
            return
        
        result = await solve_hcaptcha(website_url, website_key, proxy)
        print(json.dumps(result))
        
    except json.JSONDecodeError:
        result = {
            "code": 400,
            "message": "Invalid JSON parameters",
            "token": None
        }
        print(json.dumps(result))
    except Exception as e:
        result = {
            "code": 500,
            "message": f"Unexpected error: {str(e)}",
            "token": None
        }
        print(json.dumps(result))

if __name__ == "__main__":
    asyncio.run(main())