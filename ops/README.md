# broser-service 运维说明

## 这个服务是什么

- pm2 服务名 `browser-service`（注意和仓库名 broser-service 不同），是一个 Express HTTP 服务（代码见 `cf-clearance-scraper/captcha-solvers/turnstile/index.js`）。
  - 端口：环境变量 `PORT`，默认 3000
  - 接口：`POST /cf-clearance-scraper`，`GET /health`
  - 打开物流商网页（例如 posindonesia tracking 页）走 `mode: "source"`：`endpoints/getSource.js` → `source/cloudflare.js | hcaptcha.js | f5.js`
- 通过 `puppeteer-real-browser` 启动 **有界面的系统 Chrome**（`/Applications/Google Chrome.app`，`headless: false`），
  所以只能跑在 macOS 上，而且必须在 **已登录的图形界面会话** 中启动（不能只靠 ssh 或开机未登录的状态）。
- 仓库里只导入了 `captcha-solvers` 目录，没有 `package.json` 和 pm2 配置。服务器上实际的项目目录和入口文件，以 `pm2 describe browser-service` 为准；
  脚本会自动从 pm2 读取。

## 一键升级 Node + 重启 + 开机自启

在那台机器的 **本地终端** 执行：

```bash
bash ops/upgrade-node-and-restart.sh
```

只想看看现在是怎么跑的，不做修改：把脚本顶部的 `CHECK_ONLY` 改成 `true` 再运行。

脚本做的事：

1. 打印 pm2 中 `browser-service` 的目录、入口、Node 版本、端口和 `/health`；pm2 里一个进程都没有（机器重启过）时，先执行 `pm2 resurrect`；按名字找不到但 pm2 里只有一个服务时，自动用这个服务
2. 备份 `~/.pm2/dump.pm2`
3. 安装 Node 24.22.1（按顺序选用 nvm / volta / fnm / Homebrew / nodejs.org 官方 pkg）。Homebrew 的情况：安装 `node@24`，把 `brew` 的 node 链接从 25 切到 24，同时升级 brotli
4. 在新 Node 下安装 pm2，用 `kill` + `resurrect` 让守护进程和服务都换到新 Node 上，确认 online 后执行 `pm2 save`
5. 写入 `~/Library/LaunchAgents/com.aftership.browser-service.pm2.plist`，用户登录后自动执行 `pm2 resurrect`
   - 需要在「系统设置 → 用户与群组」中给该用户打开 **自动登录**，否则机器重启后会停在登录界面，服务不会被拉起
6. 检查 Chrome 版本、项目 venv 里的 Python Brotli、nvm 下其他有漏洞的 Node 版本

## 脚本跑完后还需要手动做

- Chrome 本身也带 Brotli，服务正是用它打开外部网页的：打开 Chrome → 设置 → 关于 Chrome，更新到最新版本，然后执行 `pm2 restart browser-service`
- 如果脚本提示有 Python venv 中的 Brotli 低于 1.2.1，执行：`<venv>/bin/python -m pip install -U 'brotli>=1.2.1'`

## 日常命令

```bash
pm2 ls
pm2 logs browser-service --lines 100
pm2 restart browser-service
pm2 save
```
