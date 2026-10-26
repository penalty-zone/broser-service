#!/usr/bin/env bash
# broser-service 一键运维脚本（macOS）
#   1. 识别 pm2 里 broser-service 实际跑的目录 / 入口 / Node 版本 / 端口
#   2. 把 Node 升级到 Brotli 漏洞（CVE-2026-111497）的安全版本
#   3. 用新 Node 重新拉起 pm2 和服务，并 pm2 save
#   4. 配置「用户登录后自动拉起 pm2」（解决机器重启后 pm2 掉了的问题）
#   5. 顺带检查 Chrome / Python brotli / nvm 下其他旧 Node
#
# 用法：在那台机器上「本地终端」（不要用 ssh，服务要开有界面的 Chrome）执行：
#   bash ops/upgrade-node-and-restart.sh

# ==================== 运行配置（直接改这里） ====================
APP_NAME="browser-service"     # pm2 里的服务名（找不到时，pm2 里只有一个服务就自动用它）
TARGET_NODE="24.22.1"          # 目标 Node 版本（24.x 线安全版本 ≥ 24.22.1）
APP_DIR=""                     # 项目目录；留空=从 pm2 记录自动识别（pm2 记录全丢了才需要填）
APP_ENTRY=""                   # 入口脚本（相对 APP_DIR 或绝对路径）；留空=自动识别
CHECK_ONLY=false               # true=只打印当前运行情况，不做任何修改
SETUP_AUTOSTART=true           # true=写 LaunchAgent，用户登录后自动 pm2 resurrect
UNINSTALL_OLD_NVM_NODES=false  # true=卸载 nvm 下其他有漏洞的 Node 版本（默认只列出来）
# ================================================================

set -o pipefail

CHROME_APP="/Applications/Google Chrome.app"
BACKUP_DIR="$HOME/${APP_NAME}-upgrade-backup-$(date +%Y%m%d-%H%M%S)"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m[注意] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[失败] %s\033[0m\n' "$*"; exit 1; }

# a >= b（只比较 x.y.z）
ver_ge() {
    local IFS=.
    local a=($1) b=($2) i
    for i in 0 1 2; do
        [ "${a[i]:-0}" -gt "${b[i]:-0}" ] && return 0
        [ "${a[i]:-0}" -lt "${b[i]:-0}" ] && return 1
    done
    return 0
}

# 只有 22 / 24 / 26 三条线有补丁
node_is_safe() {
    local v="${1#v}"
    case "${v%%.*}" in
        22) ver_ge "$v" 22.23.4 ;;
        24) ver_ge "$v" 24.22.1 ;;
        26) ver_ge "$v" 26.12.1 ;;
        *)  return 1 ;;
    esac
}

load_version_managers() {
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    [ -d "$HOME/.volta/bin" ] && export PATH="$HOME/.volta/bin:$PATH"
    command -v fnm >/dev/null 2>&1 && eval "$(fnm env)"
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
        [ -x "$b" ] && { eval "$("$b" shellenv)"; break; }
    done
}

# 从运行中的 pm2 读取服务信息（只取非敏感字段，不读 env）
# 输出：status|pid|cwd|entry|node_version|interpreter
pm2_app_info() {
    [ -n "$PM2" ] || return 0
    "$PM2" jlist 2>/dev/null | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
    const line = s.split("\n").reverse().find(l => l.trim().startsWith("[{") || l.trim() === "[]")
    if (!line) return
    let list
    try { list = JSON.parse(line) } catch (e) { return }
    const p = list.find(x => x.name === process.argv[1])
    if (!p) return
    const e = p.pm2_env || {}
    console.log([e.status, p.pid, e.pm_cwd, e.pm_exec_path, e.node_version, e.exec_interpreter].join("|"))
})' "$APP_NAME"
}

# pm2 里所有服务名，一行一个
pm2_names() {
    [ -n "$PM2" ] || return 0
    "$PM2" jlist 2>/dev/null | node -e '
let s = ""
process.stdin.on("data", d => s += d).on("end", () => {
    const line = s.split("\n").reverse().find(l => l.trim().startsWith("[{") || l.trim() === "[]")
    if (!line) return
    try { [...new Set(JSON.parse(line).map(p => p.name))].forEach(n => console.log(n)) } catch (e) {}
})'
}

# pm2 进程都没了时，从 ~/.pm2/dump.pm2 读取目录和入口
dump_app_info() {
    [ -f "$HOME/.pm2/dump.pm2" ] || return 0
    node -e '
const fs = require("fs")
let list
try { list = JSON.parse(fs.readFileSync(process.argv[1], "utf8")) } catch (e) { process.exit(0) }
const p = list.find(x => x.name === process.argv[2])
if (p) console.log([p.pm_cwd, p.pm_exec_path].join("|"))' "$HOME/.pm2/dump.pm2" "$APP_NAME"
}

listen_port_of_pid() {
    [ -n "$1" ] && [ "$1" != "0" ] || return 0
    local p
    for p in $(pid_tree "$1"); do
        lsof -nP -iTCP -sTCP:LISTEN -a -p "$p" 2>/dev/null | awk 'NR>1 {print $9}' | sed 's/.*://'
    done | sort -un | head -1
}

# pid 及其所有子孙进程（pm2 可能启动的是 npm / shell 外壳，真正干活的是子进程）
pid_tree() {
    local c
    [ -n "$1" ] && [ "$1" != "0" ] || return 0
    echo "$1"
    for c in $(pgrep -P "$1" 2>/dev/null); do pid_tree "$c"; done
}

# 服务进程树里实际在用的 node（pm2 记录的 node_version 可能是守护进程的版本，不可靠）
# 输出：可执行文件路径|版本
real_node_of_pid() {
    local p exe
    for p in $(pid_tree "$1"); do
        exe="$(lsof -a -p "$p" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
        if [ "$(basename "$exe")" = "node" ] && [ -x "$exe" ]; then
            echo "$exe|$("$exe" -v 2>/dev/null)"
            return 0
        fi
    done
}

# 等服务 online（最多 60 秒），再等它开始监听端口（最多 30 秒，等不到只提示）
wait_online() {
    local st pid ok=false
    for _ in $(seq 1 30); do
        IFS='|' read -r st pid _ _ _ _ <<< "$(pm2_app_info)"
        [ "$st" = "online" ] && { ok=true; break; }
        sleep 2
    done
    [ "$ok" = true ] || return 1
    for _ in $(seq 1 15); do
        IFS='|' read -r st pid _ _ _ _ <<< "$(pm2_app_info)"
        [ "$st" = "online" ] || return 1
        [ -n "$(listen_port_of_pid "$pid")" ] && return 0
        sleep 2
    done
    warn "服务是 online，但没检测到监听端口（服务可能不监听端口，或启动较慢），继续"
    return 0
}

# 失败时打印最近日志，方便直接定位
die_with_logs() {
    "$PM2" list 2>/dev/null
    "$PM2" logs "$APP_NAME" --lines 40 --nostream 2>/dev/null
    die "$1"
}

print_status() {
    local info status pid cwd entry nver interp port real_exe real_ver
    info="$(pm2_app_info)"
    if [ -z "$info" ]; then
        warn "pm2 里没有找到 $APP_NAME"
        return 1
    fi
    IFS='|' read -r status pid cwd entry nver interp <<< "$info"
    IFS='|' read -r real_exe real_ver <<< "$(real_node_of_pid "$pid")"
    port="$(listen_port_of_pid "$pid")"
    info "服务名      : $APP_NAME"
    info "状态 / PID  : $status / $pid"
    info "项目目录    : $cwd"
    info "入口脚本    : $entry"
    info "Node 版本   : ${real_ver:-未知}   (${real_exe:-interpreter: $interp})"
    info "监听端口    : ${port:-未检测到}"
    if [ -n "$port" ]; then
        info "健康检查    : $(curl -s -m 5 "http://127.0.0.1:$port/health" 2>/dev/null | head -c 300)"
    fi
    return 0
}

# ---------------------------------------------------------------- 0. 现状
[ "$(uname -s)" = "Darwin" ] || die "这个脚本只支持 macOS（服务写死了 /Applications/Google Chrome.app）"

load_version_managers
OLD_NODE="$(command -v node || true)"
OLD_NODE_VER="$(node -v 2>/dev/null || true)"
PM2="$(command -v pm2 || true)"
OLD_PM2="$PM2"

log "当前环境"
info "node : ${OLD_NODE:-未安装}  ${OLD_NODE_VER}"
info "pm2  : ${PM2:-未安装}"
[ -n "$OLD_NODE" ] || die "找不到 node。如果之前用 nvm，请确认 ~/.nvm 存在"

if [ -n "$PM2" ] && [ -z "$(pm2_names)" ]; then
    log "pm2 里一个进程都没有（机器重启过？），尝试 pm2 resurrect 恢复上次保存的进程"
    "$PM2" resurrect >/dev/null 2>&1 || true
    sleep 5
fi

if [ -n "$PM2" ] && [ -z "$(pm2_app_info)" ]; then
    names="$(pm2_names)"
    if [ -n "$names" ] && [ "$(echo "$names" | wc -l | tr -d ' ')" = "1" ]; then
        warn "pm2 里没有 ${APP_NAME}，只有一个服务「${names}」，按它处理"
        APP_NAME="$names"
    elif [ -n "$names" ]; then
        warn "pm2 里没有 ${APP_NAME}，现有服务：$(echo "$names" | tr '\n' ' ')；请把脚本顶部 APP_NAME 改成正确的名字"
    fi
fi

log "$APP_NAME 当前运行情况"
APP_IN_PM2=false
if print_status; then
    APP_IN_PM2=true
    IFS='|' read -r _ _ cwd entry _ _ <<< "$(pm2_app_info)"
    [ -n "$APP_DIR" ]   || APP_DIR="$cwd"
    [ -n "$APP_ENTRY" ] || APP_ENTRY="$entry"
else
    IFS='|' read -r cwd entry <<< "$(dump_app_info)"
    [ -n "$APP_DIR" ]   || APP_DIR="$cwd"
    [ -n "$APP_ENTRY" ] || APP_ENTRY="$entry"
    info "从 dump.pm2 读到：目录=${APP_DIR:-无}  入口=${APP_ENTRY:-无}"
fi

if [ "$CHECK_ONLY" = true ]; then
    log "CHECK_ONLY=true，只看不改，结束"
    exit 0
fi

[ -n "$APP_DIR" ] && [ -n "$APP_ENTRY" ] || die "识别不到项目目录/入口，请在脚本顶部填写 APP_DIR 和 APP_ENTRY 后重跑"
[ -d "$APP_DIR" ] || die "项目目录不存在：$APP_DIR"
case "$APP_ENTRY" in /*) ;; *) APP_ENTRY="$APP_DIR/$APP_ENTRY" ;; esac
[ -f "$APP_ENTRY" ] || die "入口脚本不存在：$APP_ENTRY"

# ---------------------------------------------------------------- 1. 备份
log "备份 pm2 进程列表到 $BACKUP_DIR"
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
# 只有服务确实在 pm2 里时才 save，避免用空列表覆盖掉好的 dump
if [ "$APP_IN_PM2" = true ]; then
    "$PM2" save --force >/dev/null 2>&1 || warn "pm2 save 失败，继续使用已有的 dump.pm2"
fi
cp -p "$HOME/.pm2/dump.pm2" "$BACKUP_DIR/" 2>/dev/null || warn "没有 ~/.pm2/dump.pm2 可备份"
echo "$OLD_NODE $OLD_NODE_VER" > "$BACKUP_DIR/old-node.txt"

# ---------------------------------------------------------------- 2. 安装 Node
install_node_pkg() {
    local tmp pkg="node-v${TARGET_NODE}.pkg"
    tmp="$(mktemp -d)"
    info "从 nodejs.org 下载官方安装包 $pkg"
    curl -fsSL -o "$tmp/$pkg" "https://nodejs.org/dist/v${TARGET_NODE}/$pkg" || die "下载失败"
    curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v${TARGET_NODE}/SHASUMS256.txt" || die "下载 SHASUMS256 失败"
    (cd "$tmp" && grep " ${pkg}\$" SHASUMS256.txt | shasum -a 256 -c -) || die "安装包校验失败"
    info "安装需要 sudo 密码"
    sudo installer -pkg "$tmp/$pkg" -target / || die "安装失败"
    rm -rf "$tmp"
    NEW_NODE="/usr/local/bin/node"
}

log "安装 Node v$TARGET_NODE"
NEW_NODE=""
if node_is_safe "$OLD_NODE_VER"; then
    info "当前 $OLD_NODE_VER 已经是安全版本，跳过安装"
    NEW_NODE="$OLD_NODE"
elif type nvm >/dev/null 2>&1; then
    info "使用 nvm"
    nvm install "$TARGET_NODE" || die "nvm install 失败"
    nvm alias default "$TARGET_NODE" >/dev/null
    nvm use "$TARGET_NODE" >/dev/null
    NEW_NODE="$NVM_DIR/versions/node/v${TARGET_NODE}/bin/node"
elif command -v volta >/dev/null 2>&1; then
    info "使用 volta"
    volta install "node@${TARGET_NODE}" || die "volta install 失败"
    NEW_NODE="$(volta which node)"
elif command -v fnm >/dev/null 2>&1; then
    info "使用 fnm"
    fnm install "$TARGET_NODE" && fnm default "$TARGET_NODE" && fnm use "$TARGET_NODE" || die "fnm 安装失败"
    NEW_NODE="$(command -v node)"
else
    case "$OLD_NODE" in
        "$(brew --prefix 2>/dev/null)"/*)
            # brew 的 node 跟最新大版本走（现在是 25，没有补丁），改用 node@24 并接管 brew 的 node 链接
            major="${TARGET_NODE%%.*}"
            info "当前 node 来自 Homebrew，安装 node@${major} 并把 $(brew --prefix)/bin/node 切到它"
            brew update >/dev/null
            if brew list --versions "node@${major}" >/dev/null 2>&1; then
                brew upgrade "node@${major}"
            else
                brew install "node@${major}" || die "brew install node@${major} 失败"
            fi
            brew_node="$(brew --prefix "node@${major}")/bin/node"
            brew unlink node >/dev/null 2>&1 || true
            if [ -x "$brew_node" ] && node_is_safe "$("$brew_node" -v)"; then
                brew link --force --overwrite "node@${major}" >/dev/null || die "brew link node@${major} 失败"
                NEW_NODE="$(brew --prefix)/bin/node"
            else
                warn "Homebrew 的 node@${major} 是 $("$brew_node" -v 2>/dev/null)，还不是安全版本，改装 nodejs.org 官方包到 /usr/local/bin"
                install_node_pkg
            fi
            info "顺带升级 Homebrew 的 brotli（要求 ≥ 1.2.1）"
            brew upgrade brotli >/dev/null 2>&1 || true
            info "brotli: $(brew list --versions brotli 2>/dev/null)"
            ;;
        *) install_node_pkg ;;
    esac
fi

[ -x "$NEW_NODE" ] || die "找不到新装的 node：$NEW_NODE"
NEW_NODE_VER="$("$NEW_NODE" -v)"
node_is_safe "$NEW_NODE_VER" || die "安装后版本 $NEW_NODE_VER 仍不是安全版本"
export PATH="$(dirname "$NEW_NODE"):$PATH"
hash -r
info "新 node：$NEW_NODE  $NEW_NODE_VER"

# ---------------------------------------------------------------- 3. 给新 Node 装 pm2
log "在新 Node 下安装 pm2"
if ! npm install -g pm2@latest >/dev/null 2>&1; then
    info "需要 sudo 才能写全局目录"
    sudo npm install -g pm2@latest >/dev/null || die "安装 pm2 失败"
fi
hash -r
PM2="$(command -v pm2)"
[ -n "$PM2" ] || die "装完找不到 pm2"
info "pm2：$PM2  $("$PM2" -v 2>/dev/null | tail -1)"

# ---------------------------------------------------------------- 4. 用新 Node 重启服务
# 守护进程和服务都已经在新 node 上（比如重跑脚本）就不再重启，避免服务中断
IFS='|' read -r st pid _ _ _ _ <<< "$(pm2_app_info)"
IFS='|' read -r _ svc_ver <<< "$(real_node_of_pid "$pid")"
IFS='|' read -r _ daemon_ver <<< "$(real_node_of_pid "$(cat "$HOME/.pm2/pm2.pid" 2>/dev/null)")"
if [ "$st" = "online" ] && [ "$svc_ver" = "$NEW_NODE_VER" ] && [ "$daemon_ver" = "$NEW_NODE_VER" ]; then
    log "pm2 守护进程和服务都已经在 Node $NEW_NODE_VER 上，跳过重启"
else
    log "停掉旧的 pm2 守护进程（它本身跑在旧 Node 上）"
    if [ -n "$OLD_PM2" ] && [ "$OLD_PM2" != "$PM2" ]; then
        PATH="$(dirname "$OLD_NODE"):$PATH" "$OLD_PM2" kill >/dev/null 2>&1 || true
    fi
    "$PM2" kill >/dev/null 2>&1 || true

    log "用新 pm2 恢复进程"
    "$PM2" resurrect >/dev/null 2>&1 || true
    sleep 3
    if [ -z "$(pm2_app_info)" ]; then
        warn "dump 里没有 ${APP_NAME}，按目录/入口新建（原来通过 pm2 设置的环境变量需要自己补）"
        (cd "$APP_DIR" && "$PM2" start "$APP_ENTRY" --name "$APP_NAME" --interpreter "$NEW_NODE") || die "pm2 start 失败"
    fi
fi

log "等待服务启动"
wait_online || die_with_logs "服务没有 online"

# dump 里如果写死了旧 node 的绝对路径，服务会还在旧 node 上，这里改成新 node
IFS='|' read -r _ pid _ _ _ _ <<< "$(pm2_app_info)"
IFS='|' read -r _ cur_ver <<< "$(real_node_of_pid "$pid")"
if [ "$cur_ver" != "$NEW_NODE_VER" ]; then
    info "服务还在用 Node ${cur_ver:-未知}，切换 interpreter 到 $NEW_NODE"
    "$PM2" restart "$APP_NAME" --interpreter "$NEW_NODE" >/dev/null || die "pm2 restart 失败"
    wait_online || die_with_logs "服务没有 online"
fi

print_status || true
IFS='|' read -r _ pid _ _ _ _ <<< "$(pm2_app_info)"
IFS='|' read -r _ cur_ver <<< "$(real_node_of_pid "$pid")"
[ "$cur_ver" = "$NEW_NODE_VER" ] || die "服务仍在用 Node ${cur_ver:-未知}，请检查 pm2 describe $APP_NAME"

"$PM2" save --force >/dev/null && info "已 pm2 save"

# ---------------------------------------------------------------- 5. 开机/登录自动拉起
if [ "$SETUP_AUTOSTART" = true ]; then
    LAUNCH_LABEL="com.aftership.${APP_NAME}.pm2"
    LAUNCH_PLIST="$HOME/Library/LaunchAgents/${LAUNCH_LABEL}.plist"
    log "配置登录后自动拉起 pm2：$LAUNCH_PLIST"
    mkdir -p "$HOME/Library/LaunchAgents"
    [ -f "$LAUNCH_PLIST" ] && cp -p "$LAUNCH_PLIST" "$BACKUP_DIR/"
    cat > "$LAUNCH_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCH_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PM2}</string>
        <string>resurrect</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$(dirname "$NEW_NODE"):$(dirname "$PM2"):/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>AbandonProcessGroup</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${HOME}/.pm2/launchagent.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/.pm2/launchagent.log</string>
</dict>
</plist>
EOF
    plutil -lint "$LAUNCH_PLIST" >/dev/null || die "plist 格式错误"
    info "已写入（下次用户登录时生效，现在不会重复启动）"
    info "需要在 系统设置 → 用户与群组 打开该用户「自动登录」，否则重启后停在登录界面不会拉起"
fi

for f in /Library/LaunchDaemons/pm2.*.plist "$HOME"/Library/LaunchAgents/pm2.*.plist; do
    [ -f "$f" ] || continue
    if grep -q "$(dirname "$OLD_NODE")" "$f" 2>/dev/null && [ "$(dirname "$OLD_NODE")" != "$(dirname "$NEW_NODE")" ]; then
        warn "发现旧的 pm2 startup 配置 $f 指向旧 Node，会用旧 Node 拉起服务。建议执行：sudo rm '$f'"
    fi
done

# ---------------------------------------------------------------- 6. 其他检查
log "Chrome 版本（服务实际用这个 Chrome 打开网页，它也带 Brotli）"
if [ -d "$CHROME_APP" ]; then
    info "Google Chrome $(defaults read "$CHROME_APP/Contents/Info" CFBundleShortVersionString 2>/dev/null)"
    warn "请打开 Chrome → 设置 → 关于 Chrome 更新到最新，更新后执行：pm2 restart $APP_NAME"
else
    warn "没找到 $CHROME_APP"
fi

log "检查项目里 Python 虚拟环境的 Brotli（要求 Brotli ≥ 1.2.1 / brotlicffi ≥ 1.2.1.0）"
found_py=false
while IFS= read -r py; do
    found_py=true
    res="$("$py" -I -c 'import importlib.metadata as m
out=[]
for n in ("Brotli","brotlicffi"):
    try: out.append(n+"=="+m.version(n))
    except Exception: pass
print(" ".join(out) or "未安装 brotli")' 2>/dev/null)"
    info "$py : $res"
done < <(find "$APP_DIR" -maxdepth 6 -path '*/node_modules' -prune -o -path '*/bin/python' -print 2>/dev/null)
[ "$found_py" = true ] || info "项目目录下没有找到 Python 虚拟环境"
info "需要升级时：<venv>/bin/python -m pip install -U 'brotli>=1.2.1'"

if type nvm >/dev/null 2>&1; then
    log "nvm 下其他 Node 版本"
    for d in "$NVM_DIR"/versions/node/v*; do
        [ -d "$d" ] || continue
        v="$(basename "$d")"
        if node_is_safe "$v"; then
            info "$v  安全"
        elif [ "$UNINSTALL_OLD_NVM_NODES" = true ]; then
            nvm uninstall "$v" >/dev/null && info "$v  有漏洞，已卸载"
        else
            warn "$v 有漏洞（把 UNINSTALL_OLD_NVM_NODES 改成 true 可自动卸载，或手动 nvm uninstall ${v}）"
        fi
    done
fi

if command -v brew >/dev/null 2>&1; then
    old_brew_node="$(brew list --versions node 2>/dev/null | awk '{print $2}')"
    if [ -n "$old_brew_node" ] && ! node_is_safe "$old_brew_node"; then
        warn "Homebrew 里还装着有漏洞的 node ${old_brew_node}（已取消链接，不再是默认 node）。确认没别的东西依赖后可执行：brew uninstall node"
    fi
fi

log "完成"
info "Node: $OLD_NODE_VER → ${NEW_NODE_VER}，服务已用新 Node 跑起来并 pm2 save"
info "备份目录: $BACKUP_DIR"
info "回滚: 用旧 node 的 pm2 执行 pm2 kill && cp $BACKUP_DIR/dump.pm2 ~/.pm2/ && pm2 resurrect"
