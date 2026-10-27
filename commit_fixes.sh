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
git commit -m "Fix water price live fetching and AI dynamic factor curation

Root causes fixed:
1. DuckDuckGo URL: html.duckduckgo.com/lite/ -> lite.duckduckgo.com/lite/
2. DuckDuckGo HTML parser: Updated for current DDG Lite structure
   (a class='result-link' in <tr> rows vs old <tr class='result...'>)
3. kiloRouter.ts: Fixed array index mapping after filtering
4. factor-analysis.ts: Removed importanceScore < 20 threshold that rejected
   all AI factors (default importance was 0)
5. DuckDuckGo referer header: html.duckduckgo.com/ -> lite.duckduckgo.com/
   (cross-origin referer caused DDG to reject requests)
6. extractPriceFromText: Added currency patterns for GBP (£), PHP (₱),
   INR (₹), ZAR (R), SEK/NOK/DKK (kr) so water prices in non-USD
   currencies are extracted from search snippets
7. DuckDuckGo Lite parser regex: Fixed class-before-href attribute order
   assumption that caused silent zero-results when DDG emits href before
   class. Now matches <a> tags with class='result-link' regardless of
   attribute order, restoring search results for factor curation news
   queries so Kilo AI can generate 8 dynamic reasons instead of static
   hard-coded fallbacks.

These fixes restore live water price fetching and AI-curated dynamic
factors via tinyfish, playwright, and DuckDuckGo HTTP search instead of
falling back to static benchmarks."

echo ""
echo "=== Pushing to remote ==="
git push

echo ""
echo "=== Done ==="
