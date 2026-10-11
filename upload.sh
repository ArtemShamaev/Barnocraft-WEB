#!/usr/bin/env bash
set -euo pipefail

# Publish Barnocraft WEB to GitHub.
#   ./upload.sh                     — commit with the message "Update Barnocraft WEB"
#   ./upload.sh "Добавил лодки"     — commit with your own message
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_URL="https://github.com/ArtemShamaev/Barnocraft-WEB.git"
BRANCH="master"
COMMIT_MESSAGE="${1:-Update Barnocraft WEB}"

cd "$ROOT_DIR"

if ! command -v git >/dev/null 2>&1; then
    echo "Ошибка: git не найден" >&2
    exit 1
fi
if [ ! -f index.html ] || [ ! -f server.js ]; then
    echo "Ошибка: скрипт запущен не из проекта Barnocraft WEB" >&2
    exit 1
fi

# Optional checks before publishing: tests (Node.js) and assets (Python + Pillow).
if command -v node >/dev/null 2>&1; then
    echo "Проверка: node --test test/"
    node --test test/ >/dev/null || { echo "Ошибка: тесты не прошли, публикация отменена" >&2; exit 1; }
fi
if command -v python3 >/dev/null 2>&1 && python3 -c "import PIL" >/dev/null 2>&1; then
    python3 tools/build-assets.py
fi

# The fork was cloned from the Java edition; its history holds ~300 MB of old JAR builds.
# The first publish starts a clean history, so the site repository stays small.
if git rev-parse --verify -q HEAD >/dev/null && [ -n "$(git log --oneline -1 -- pom.xml 2>/dev/null)" ]; then
    echo "Первая публикация: создаю чистую историю без файлов Java-версии"
    git checkout -q --orphan barnocraft-web-clean
    git add -A .
    git commit -q -m "Barnocraft WEB — браузерная версия Barnocraft Java Edition"
    git branch -D "$BRANCH" >/dev/null 2>&1 || true
    git branch -m "$BRANCH"
    git reflog expire --expire=now --all
    git gc -q --prune=now
else
    git add -A .
    if git rev-parse --verify -q HEAD >/dev/null && git diff --cached --quiet; then
        echo "Нет новых изменений для коммита."
    else
        git commit -q -m "$COMMIT_MESSAGE"
    fi
fi

git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE_URL"
git remote set-url origin "$REMOTE_URL"

if ! git push -u origin "$BRANCH"; then
    echo >&2
    echo "Не удалось отправить изменения. Проверьте:" >&2
    echo "  1. Репозиторий $REMOTE_URL создан на GitHub (пустой, без README)." >&2
    echo "  2. Git может войти в GitHub: при запросе пароля нужен Personal Access Token," >&2
    echo "     а не пароль от аккаунта (github.com → Settings → Developer settings → Tokens)." >&2
    echo "  3. Если на GitHub уже есть другие коммиты: git pull --rebase origin $BRANCH, затем ./upload.sh" >&2
    exit 1
fi

echo
echo "Готово: $REMOTE_URL"
echo "Сайт (после включения GitHub Pages): https://artemshamaev.github.io/Barnocraft-WEB/"
