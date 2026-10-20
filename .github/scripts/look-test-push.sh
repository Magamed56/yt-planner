#!/usr/bin/env bash
# Результат «сравнения подачи» (video-studio-look-test.yml) → ветка claude/look-test-out.
# Ветка без истории и перезаписывается каждым запуском: в ней только out/look этого запуска.
# Запуск из video-studio/: нужны GH_TOKEN, STAGE и GITHUB_REPOSITORY.
set -euo pipefail

dest="$RUNNER_TEMP/look-out"
rm -rf "$dest"
mkdir -p "$dest"
cp -r out/look/. "$dest/"
# У A (полный рендер) нужен только готовый ролик — стоки из его public не тащим.
rm -rf "$dest"/a/*/public
# Лимит GitHub — 100 МБ на файл.
find "$dest" -type f -size +95M -print -delete
du -sh "$dest"/*/ || true

cd "$dest"
git init -q
git checkout -q -b look-out
git add -A
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -q -m "look-test: $STAGE (${GITHUB_SHA::7})"
git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" HEAD:refs/heads/claude/look-test-out
echo "Запушено в claude/look-test-out: $STAGE"
