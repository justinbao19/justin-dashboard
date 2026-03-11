#!/bin/bash
# 提交并推送更新到 Vercel
# 用法: ./deploy.sh "commit message"

set -e

cd "$(dirname "$0")/.."

MESSAGE="${1:-Auto-update dashboard data}"

# 检查是否有变更
if git diff --quiet data/; then
    echo "📝 data/ 无变更，跳过部署"
    exit 0
fi

# 提交并推送
git add data/
git commit -m "$MESSAGE"
git push origin main

echo "🚀 已推送到 GitHub，Vercel 将自动部署"
