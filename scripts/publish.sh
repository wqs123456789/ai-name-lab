#!/usr/bin/env bash
# ===========================================================================
# 一键发布：建 GitHub 仓库 → 推送 → （可选）部署 Vercel
#
# 用法 A（令牌方式，最省事）：
#   GH_TOKEN=ghp_xxx bash scripts/publish.sh
#   GH_TOKEN=ghp_xxx VERCEL_TOKEN=xxx bash scripts/publish.sh   # 连 Vercel 一起
#
# 用法 B（已装 GitHub CLI 并 gh auth login）：
#   bash scripts/publish.sh
#
# 可选变量：
#   REPO_NAME=ai-name-lab     仓库名
#   PRIVATE=1                 建私有仓库（默认公开）
# ===========================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

REPO_NAME="${REPO_NAME:-ai-name-lab}"
PRIVATE_FLAG="false"; [ "${PRIVATE:-0}" = "1" ] && PRIVATE_FLAG="true"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"

say()  { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n\n' "$1"; exit 1; }

# ---------------------------------------------------------------------------
# 0. 前置检查
# ---------------------------------------------------------------------------
say "检查仓库状态"
git rev-parse --git-dir >/dev/null 2>&1 || die "当前目录不是 git 仓库"
[ -f .gitignore ] || die "缺少 .gitignore"
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  die ".env 已被 git 跟踪！先执行：git rm --cached .env && git commit -m 'chore: 移除 .env'"
fi
ok "分支 $BRANCH，.env 不会被提交"

if [ -n "$(git status --porcelain)" ]; then
  warn "有未提交的改动，先自动提交"
  git add -A
  git commit -q -m "chore: 更新" || true
fi

# ---------------------------------------------------------------------------
# 1. 认证方式
# ---------------------------------------------------------------------------
if [ -n "${GH_TOKEN:-}" ]; then
  MODE="token"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  MODE="gh"
else
  cat >&2 <<EOF
✗ 没有任何 GitHub 凭据，无法继续。

  方式一（推荐）：生成一个带 repo 权限的临时令牌
    https://github.com/settings/tokens/new?scopes=repo&description=ai-name-lab
    然后：GH_TOKEN=ghp_xxx bash scripts/publish.sh

  方式二：装 GitHub CLI 后浏览器登录
    winget install --id GitHub.cli
    gh auth login
    bash scripts/publish.sh
EOF
  exit 1
fi
ok "认证方式：$MODE"

# ---------------------------------------------------------------------------
# 2. 建仓库（已存在则复用）
# ---------------------------------------------------------------------------
say "准备 GitHub 仓库：$REPO_NAME"

if [ "$MODE" = "token" ]; then
  LOGIN="$(curl -sS -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/user \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).login||'')}catch{console.log('')}})" 2>/dev/null || true)"
  [ -n "$LOGIN" ] || die "令牌无效或已过期（拿不到 GitHub 用户名）"
  ok "登录账号：$LOGIN"

  HTTP_CODE="$(curl -sS -o /tmp/gh-repo.json -w '%{http_code}' -X POST https://api.github.com/user/repos \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"name\":\"$REPO_NAME\",\"private\":$PRIVATE_FLAG,\"description\":\"多模型 AI 起名平台：SSE 流式输出 + Supabase 历史记录\"}")"

  case "$HTTP_CODE" in
    201) ok "仓库已创建" ;;
    422) warn "仓库已存在，直接复用" ;;
    *)   cat /tmp/gh-repo.json 2>/dev/null; die "建仓库失败（HTTP $HTTP_CODE）" ;;
  esac

  REMOTE_URL="https://github.com/$LOGIN/$REPO_NAME.git"
  git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$REMOTE_URL" || git remote add origin "$REMOTE_URL"
  ok "远程地址：$REMOTE_URL"

  # 把这次提交的作者改成你的 GitHub 账号，避免出现无主提交
  git -c user.name="$LOGIN" -c user.email="${LOGIN}@users.noreply.github.com" \
      commit --amend --reset-author --no-edit >/dev/null 2>&1 \
    && ok "提交作者已设为 $LOGIN <$LOGIN@users.noreply.github.com>" || true
else
  if git remote get-url origin >/dev/null 2>&1; then
    ok "已有远程：$(git remote get-url origin)"
  else
    gh repo create "$REPO_NAME" --public --source=. --remote=origin --push
    ok "仓库已创建并推送"
    SKIP_PUSH=1
    GH_LOGIN="$(gh api user -q .login 2>/dev/null || true)"
    [ -n "$GH_LOGIN" ] && warn "提交作者仍是占位名；如需改为 $GH_LOGIN，执行：git commit --amend --reset-author --no-edit"
  fi
fi

# ---------------------------------------------------------------------------
# 3. 推送
# ---------------------------------------------------------------------------
say "推送 $BRANCH 分支"
if [ "${SKIP_PUSH:-0}" != "1" ]; then
  if [ "$MODE" = "token" ]; then
    # 令牌只出现在这一条命令里，不写入 .git/config
    AUTH_B64="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"
    git -c http.extraheader="AUTHORIZATION: basic $AUTH_B64" push -u origin "$BRANCH"
  else
    git push -u origin "$BRANCH"
  fi
  ok "推送完成"
fi

REPO_URL="$(git remote get-url origin | sed 's/\.git$//' | sed 's#git@github.com:#https://github.com/#')"
printf '\n\033[32m仓库地址：%s\033[0m\n' "$REPO_URL"

# ---------------------------------------------------------------------------
# 4. 可选：Vercel 部署（需要 VERCEL_TOKEN）
# ---------------------------------------------------------------------------
if [ -z "${VERCEL_TOKEN:-}" ]; then
  cat <<EOF

下一步（Vercel 网页导入）：
  1. 打开 https://vercel.com/new
  2. 选择仓库 $REPO_NAME → Import
  3. Framework Preset 选 Other，Build Command / Output Directory 留空
  4. 在 Environment Variables 里填入 .env 中的密钥（不要填 *_BASE_URL）
  5. Deploy

或者带 Vercel 令牌一次做完：
  GH_TOKEN=... VERCEL_TOKEN=... bash scripts/publish.sh
EOF
  exit 0
fi

say "部署到 Vercel"
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    KEY="${line%%=*}"; VALUE="${line#*=}"
    case "$KEY" in
      *_BASE_URL) warn "跳过 $KEY（本地联调用，线上填了会指向本机）" ; continue ;;
    esac
    [ -z "$VALUE" ] && continue
    printf '%s' "$VALUE" | npx --yes vercel env add "$KEY" production --token "$VERCEL_TOKEN" --force >/dev/null 2>&1 \
      && ok "环境变量 $KEY 已配置" || warn "环境变量 $KEY 配置失败（可能已存在）"
  done < .env
else
  warn "没有 .env，跳过环境变量；请在 Vercel 控制台手动添加"
fi

npx --yes vercel deploy --prod --yes --token "$VERCEL_TOKEN" | tee /tmp/vercel-out.txt
URL="$(grep -Eo 'https://[a-zA-Z0-9.-]+\.vercel\.app' /tmp/vercel-out.txt | tail -1 || true)"
[ -n "$URL" ] && printf '\n\033[32m线上地址：%s\033[0m\n' "$URL"
