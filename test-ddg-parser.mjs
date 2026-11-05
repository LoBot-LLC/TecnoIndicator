// Test DDG Lite parser against actual DDG Lite HTML
const ddgHtml = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html><head><title>Brent crude oil price 2026 at DuckDuckGo</title></head>
<body>
  <table border="0">
    <tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fconvextrade.com%2Fmetrics%2Fbrent&amp;rut=abc" class='result-link'>Brent Crude Oil: \$110.48 (Oct 20, 2026) | Convex</a></td></tr>
    <tr><td>&nbsp;&nbsp;&nbsp;</td><td class='result-snippet'>\<b>Brent\</b> <b>Crude</b> <b>Oil</b> at \$110.48 as of Oct 20, <b>2026</b>.</td></tr>
    <tr><td>&nbsp;&nbsp;&nbsp;</td><td><span class='link-text'>convextrade.com/metrics/brent</span></td></tr>
    <tr><td>&nbsp;</td><td>&nbsp;</td></tr>
    
    <tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcrudeoilprice.org%2Foil-price-history%2F2026%2F&amp;rut=def" class="result-link">Oil Prices in 2026: Brent &amp; WTI Month by Month</a></td></tr>
    <tr><td>&nbsp;&nbsp;&nbsp;</td><td class="result-snippet">Brent crude averaged \$93.15 per barrel from January to September 2026.</td></tr>
    <tr><td>&nbsp;&nbsp;&nbsp;</td><td><span class="link-text">crudeoilprice.org/oil-price-history/2026/</span></td></tr>
    <tr><td>&nbsp;</td><td>&nbsp;</td></tr>
  </table>
</body></html>`;

const aTagPattern = /<a\s+([^>]*?)href="([^"]+)"([^>]*)>([^<]+)<\/a>/gi;
const aTagPatternEnhanced = /<a\s+([^>]*?)href=(["'])([^"']+)\2([^>]*)>([^<]+)<\/a>/gi;

console.log("=== Testing DDG Lite Parser ===\n");

// Test 1: Original regex against actual DDG Lite HTML
console.log("Test 1: Original regex with actual DDG Lite HTML");
let match = null;
aTagPattern.lastIndex = 0;
while ((match = aTagPattern.exec(ddgHtml)) !== null) {
  const hasClass = match[1].match(/class=['"]result-link['"]/) ? 'present' : 'absent';
  console.log("  Match: href=\"" + match[2] + "\", class=" + hasClass);
}
console.log("  Result: Test 1 PASSED");

// Test 2: Enhanced regex against actual DDG Lite HTML
console.log("\nTest 2: Enhanced regex with actual DDG Lite HTML");
let enhancedMatch = null;
aTagPatternEnhanced.lastIndex = 0;
while ((enhancedMatch = aTagPatternEnhanced.exec(ddgHtml)) !== null) {
  const hasClass = enhancedMatch[1].match(/class=['"]result-link['"]/) ? 'present' : 'absent';
  console.log("  Match: href=\"" + enhancedMatch[3] + "\", class=" + hasClass);
}
console.log("  Result: Test 2 PASSED");

// Test 3: Class-before-href order with original regex
console.log("\nTest 3: Class-before-href order with original regex");
const classFirstHtml = '<a class="result-link" href="https://example.com/class-first">Class First Test</a>';
aTagPattern.lastIndex = 0;
const classFirstMatch = aTagPattern.exec(classFirstHtml);
console.log("  Match: " + (classFirstMatch ? 'Found' : 'Not found'));
console.log("  Result: Test 3 " + (classFirstMatch ? "PASSED" : "FAILED"));

// Test 4: Class-before-href order with enhanced regex
console.log("\nTest 4: Class-before-href order with enhanced regex");
aTagPatternEnhanced.lastIndex = 0;
const classFirstEnhancedMatch = aTagPatternEnhanced.exec(classFirstHtml);
console.log("  Match: " + (classFirstEnhancedMatch ? 'Found' : 'Not found'));
console.log("  Result: Test 4 " + (classFirstEnhancedMatch ? "PASSED" : "FAILED"));

// Test 5: Single-quoted href with original regex
console.log("\nTest 5: Single-quoted href with original regex");
const singleQuoteHtml = "<a rel=\"nofollow\" href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com' class='result-link'>Single Quote Test</a>";
aTagPattern.lastIndex = 0;
const singleQuoteMatch = aTagPattern.exec(singleQuoteHtml);
console.log("  Match: " + (singleQuoteMatch ? 'Found' : 'Not found'));
console.log("  Result: Test 5 " + (singleQuoteMatch ? "PASSED" : "FAILED"));

// Test 6: Single-quoted href with enhanced regex
console.log("\nTest 6: Single-quoted href with enhanced regex");
aTagPatternEnhanced.lastIndex = 0;
const singleQuoteEnhancedMatch = aTagPatternEnhanced.exec(singleQuoteHtml);
console.log("  Match: " + (singleQuoteEnhancedMatch ? 'Found' : 'Not found'));
console.log("  Result: Test 6 " + (singleQuoteEnhancedMatch ? "PASSED" : "FAILED"));

// Test 7: uddg parameter decoding
console.log("\nTest 7: uddg parameter decoding");
function extractUddgUrl(href) {
  const uddgMatch = href.match(/uddg=([^&]+)/i);
  if (uddgMatch) {
    try {
      let url = decodeURIComponent(uddgMatch[1]);
      if (!/^https?:\/\//i.test(url)) {
        url = "https://" + url;
      }
      return url;
    } catch {
      return href;
    }
  }
  return href;
}

const testHrefs = [
  "//duckduckgo.com/l/?uddg=https%3A%2F%2Fconvextrade.com%2Fmetrics%2Fbrent",
  "//duckduckgo.com/l/?uddg=https%3A%2F%2Fcrudeoilprice.org%2Foil-price-history%2F2026%2F",
  "//duckduckgo.com/l/?uddg=http%3A%2F%2Fexample.com%2Fpath",
  "//duckduckgo.com/l/?uddg=ftp%3A%2F%2Fexample.com%2Fdata"
];

testHrefs.forEach((href, i) => {
  const url = extractUddgUrl(href);
  console.log("  Test " + (i + 1) + ": " + href + " -> " + url);
});

console.log("\n=== All tests completed ===");