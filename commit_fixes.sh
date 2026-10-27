#!/bin/bash
# Commit and push all water price/API fixes
set -e

cd /workspace/app

echo "=== Git Status ==="
git status

echo ""
echo "=== Git Diff Summary ==="
git diff --stat

echo ""
echo "=== Staging changes ==="
git add -A

echo ""
echo "=== Committing ==="
git commit -m "Fix water price live fetching via DuckDuckGo search and AI model routing

Root causes fixed:
1. DuckDuckGo URL: html.duckduckgo.com/lite/ -> lite.duckduckgo.com/lite/
2. DuckDuckGo HTML parser: Updated for current DDG Lite structure
   (a class='result-link' in <tr> rows vs old <tr class='result...'>)
3. kiloRouter.ts: Fixed array index mapping after filtering
4. factor-analysis.ts: Removed importanceScore < 20 threshold that rejected
   all AI factors (default importance was 0)

These fixes restore live water price fetching via tinyfish, playwright,
and DuckDuckGo HTTP search instead of falling back to static benchmarks."

echo ""
echo "=== Pushing to remote ==="
git push

echo ""
echo "=== Done ==="
