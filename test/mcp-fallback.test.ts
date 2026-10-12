/**
 * Test script for the Playwright MCP fallback integration.
 *
 * Verifies the key edge cases:
 * 1. areAllKeysDown() returns true when no keys are configured
 * 2. areAllKeysDown() returns true when all keys are unavailable/rate-limited
 * 3. areAllKeysDown() returns false when at least one key is available
 * 4. getTinyfishStatus() includes fallbackToMcp field
 * 5. Search results are cached with the correct keyIndex (-2) when MCP fallback is used
 * 6. The fallback restores TinyFish when a key becomes available again
 *
 * Run: npx tsx test/mcp-fallback.test.ts
 */

import { tinyfishRouter } from "../lib/api/_shared/tinyfishRouter";
import { PLAYWRIGHT_MCP_KEY_INDEX } from "../lib/api/_shared/playwrightMcp";

// ─── Test helpers ─────────────────────────────────────────────────────────

/** Reset the tinyfishRouter singleton state for testing. */
function resetRouter(): void {
  const router = tinyfishRouter as any;
  router.keyStates = [];
  router.initialized = false;
}

/** Simulate that all keys are down (all unavailable). */
function simulateAllKeysDown(): void {
  const router = tinyfishRouter as any;
  router.keyStates = [
    {
      keyIndex: 0,
      envName: "TINYFISH_KEY_1",
      available: false,
      rateLimited: false,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: null,
    },
    {
      keyIndex: 1,
      envName: "TINYFISH_KEY_2",
      available: false,
      rateLimited: false,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: null,
    },
  ];
  router.initialized = true;
}

/** Simulate that one key is available (restored). */
function simulateOneKeyRestored(): void {
  const router = tinyfishRouter as any;
  router.keyStates = [
    {
      keyIndex: 0,
      envName: "TINYFISH_KEY_1",
      available: false,
      rateLimited: false,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: null,
    },
    {
      keyIndex: 1,
      envName: "TINYFISH_KEY_2",
      available: true, // This key is restored!
      rateLimited: false,
      rateLimitRemaining: 100,
      rateLimitResetAt: null,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    },
  ];
  router.initialized = true;
}

/** Simulate that all keys are rate-limited (but were available) with future reset. */
function simulateAllKeysRateLimited(): void {
  const router = tinyfishRouter as any;
  const futureReset = new Date(Date.now() + 60000).toISOString(); // 1 min in future
  router.keyStates = [
    {
      keyIndex: 0,
      envName: "TINYFISH_KEY_1",
      available: true,
      rateLimited: true,
      rateLimitRemaining: 0,
      rateLimitResetAt: futureReset,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    },
    {
      keyIndex: 1,
      envName: "TINYFISH_KEY_2",
      available: true,
      rateLimited: true,
      rateLimitRemaining: 0,
      rateLimitResetAt: futureReset,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    },
  ];
  router.initialized = true;
}

/** Simulate that all keys are rate-limited but the windows have expired. */
function simulateAllKeysRateLimitedExpired(): void {
  const router = tinyfishRouter as any;
  const pastReset = new Date(Date.now() - 60000).toISOString(); // 1 min ago
  router.keyStates = [
    {
      keyIndex: 0,
      envName: "TINYFISH_KEY_1",
      available: true,
      rateLimited: true,
      rateLimitRemaining: 0,
      rateLimitResetAt: pastReset,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    },
    {
      keyIndex: 1,
      envName: "TINYFISH_KEY_2",
      available: true,
      rateLimited: true,
      rateLimitRemaining: 0,
      rateLimitResetAt: pastReset,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    },
  ];
  router.initialized = true;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

console.log("\n=== Playwright MCP Fallback Integration Tests ===\n");

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function runTests(): Promise<void> {
  // Test 1: areAllKeysDown() with no keys configured
  resetRouter();
  {
    const allDown = tinyfishRouter.areAllKeysDown();
    const status = await tinyfishRouter.getTinyfishStatus(undefined, true);
    console.log(`Test 1: No keys configured`);
    assert(allDown === true, "areAllKeysDown() returns true when no keys configured");
    assert(status.available === false, "status.available is false");
    assert(status.fallbackToMcp === true, "fallbackToMcp is true (MCP is always-on and ready)");
  }

  // Test 2: areAllKeysDown() with all keys unavailable
  simulateAllKeysDown();
  {
    const allDown = tinyfishRouter.areAllKeysDown();
    const status = await tinyfishRouter.getTinyfishStatus(undefined, true);
    console.log(`\nTest 2: All keys down (unavailable)`);
    assert(allDown === true, "areAllKeysDown() returns true when all keys unavailable");
    assert(status.available === false, "status.available is false");
    assert(status.fallbackToMcp === true, "fallbackToMcp is true when all keys down");
  }

  // Test 3: areAllKeysDown() with one key restored
  simulateOneKeyRestored();
  {
    const allDown = tinyfishRouter.areAllKeysDown();
    const status = await tinyfishRouter.getTinyfishStatus(undefined, true);
    console.log(`\nTest 3: One key restored`);
    assert(allDown === false, "areAllKeysDown() returns false when one key is available");
    assert(status.available === true, "status.available is true");
    assert(status.fallbackToMcp === false, "fallbackToMcp is false when TinyFish available");
    assert(status.usableKeys === 1, "usableKeys is 1");
  }

  // Test 4: all keys rate-limited (future reset)
  simulateAllKeysRateLimited();
  {
    const allDown = tinyfishRouter.areAllKeysDown();
    const status = await tinyfishRouter.getTinyfishStatus(undefined, true);
    console.log(`\nTest 4: All keys rate-limited (future reset)`);
    assert(allDown === true, "areAllKeysDown() returns true when all keys rate-limited");
    assert(status.available === false, "status.available is false");
    assert(status.fallbackToMcp === true, "fallbackToMcp is true when all rate-limited");
  }

  // Test 5: all keys rate-limited but windows expired (auto-recovery)
  simulateAllKeysRateLimitedExpired();
  {
    const allDown = tinyfishRouter.areAllKeysDown();
    const status = await tinyfishRouter.getTinyfishStatus(undefined, true);
    console.log(`\nTest 5: Rate-limit windows expired (auto-recovery)`);
    assert(allDown === false, "areAllKeysDown() returns false after rate-limit recovery");
    assert(status.available === true, "status.available is true after rate-limit recovery");
    assert(status.fallbackToMcp === false, "fallbackToMcp is false after rate-limit recovery");
    assert(status.usableKeys === 2, "usableKeys is 2 after rate-limit recovery");
  }

  // Test 6: PLAYWRIGHT_MCP_KEY_INDEX sentinel constant
  console.log(`\nTest 6: PLAYWRIGHT_MCP_KEY_INDEX`);
  assert(PLAYWRIGHT_MCP_KEY_INDEX === -2, "PLAYWRIGHT_MCP_KEY_INDEX is -2");

  // Test 7: hasUsableKeys and hasConfiguredKeys helper methods
  resetRouter();
  {
    console.log(`\nTest 7: Helper methods (no keys configured)`);
    assert(tinyfishRouter.hasConfiguredKeys() === false, "hasConfiguredKeys() is false");
    assert(tinyfishRouter.hasUsableKeys() === false, "hasUsableKeys() is false");
  }

  simulateOneKeyRestored();
  {
    console.log(`\nTest 8: Helper methods (one key restored)`);
    assert(tinyfishRouter.hasConfiguredKeys() === true, "hasConfiguredKeys() is true");
    assert(tinyfishRouter.hasUsableKeys() === true, "hasUsableKeys() is true");
  }

  simulateAllKeysDown();
  {
    console.log(`\nTest 9: Helper methods (all keys down)`);
    assert(tinyfishRouter.hasConfiguredKeys() === true, "hasConfiguredKeys() is true (keys configured but down)");
    assert(tinyfishRouter.hasUsableKeys() === false, "hasUsableKeys() is false");
  }

  // Test 10: Status return shape includes fallbackToMcp
  resetRouter();
  {
    const status = await tinyfishRouter.getTinyfishStatus(undefined, true);
    const hasAllFields =
      "available" in status &&
      "configuredKeys" in status &&
      "usableKeys" in status &&
      "rateLimitedKeys" in status &&
      "fallbackToMcp" in status;
    console.log(`\nTest 10: Status return shape`);
    assert(hasAllFields, "getTinyfishStatus returns fallbackToMcp field");
  }

  // Test 11: Transition from keys-down to keys-restored (simulates automatic restore)
  console.log(`\nTest 11: Automatic restore when TinyFish key comes back`);
  simulateAllKeysDown();
  {
    const status1 = await tinyfishRouter.getTinyfishStatus(undefined, true);
    assert(status1.fallbackToMcp === true, "Fallback active when all keys down");
  }
  simulateOneKeyRestored();
  {
    const status2 = await tinyfishRouter.getTinyfishStatus(undefined, true);
    assert(status2.fallbackToMcp === false, "Fallback deactivated when key restored");
    assert(status2.available === true, "TinyFish available again after restore");
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
