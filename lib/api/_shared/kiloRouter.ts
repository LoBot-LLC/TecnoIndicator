import { sanitizeError } from "./validation";
import {
  KILO_GATEWAY_MODELS_URL,
  KILO_GATEWAY_CHAT_URL,
  DEFAULT_KILO_MODEL_ID,
  KILO_KEY_ENV_NAMES,
  ACCESS_PROBE_CACHE_MS,
  MODEL_CACHE_MS,
  readConfiguredKeys,
  isGlobalRateLimitStatus,
  isRetryableUpstreamStatus,
  isJwtApiKey,
  isOpaqueApiKey,
  isRecognizedKiloGatewayKeyFormat,
  KILO_GATEWAY_JWT_PREFIX,
} from "./http";
import { getCache, setCache } from "./cache";
import { KiloResponse, KiloStatus } from "./types";

/**
 * The real catalog response is ~481KB, so an aggressive abort can time out on a
 * cold start. 8s (down from 15s) is the compromise: the
 * `kilo:model-catalog:backup` 24h key still resolves a miss, and the catalog
 * fetch no longer eats a third of a 45s route budget while serving one.
 */
const CATALOG_FETCH_TIMEOUT_MS = 8_000;
/** Long-lived copy of the last good catalog, used when a refresh fails. */
const CATALOG_BACKUP_KEY = "kilo:model-catalog:backup";
const CATALOG_BACKUP_TTL_MS = 24 * 60 * 60 * 1000;
/** A 4-token cap is routinely rejected by router/auto models; 32 is safe. */
const PROBE_MAX_TOKENS = 32;
const PROBE_TEMPERATURE = 0.2;
const MAX_PROBE_MODELS_PER_KEY = 2;
/** Bounded backoff: 60s, 120s, 240s, then capped. */
const KEY_REPROBE_BASE_MS = 60_000;
const KEY_REPROBE_MAX_MS = 4 * 60_000;
/** A rejected credential is still retried occasionally (a key can be rotated). */
const ACCESS_DENIED_REPROBE_MS = 10 * 60_000;
const REPROBE_TIMEOUT_MS = 5_000;
/** Overall budget for the whole init-time key-probe phase (was 8s). */
const INIT_PROBE_TIMEOUT_MS = 3_000;
/**
 * Per-attempt cap for a single Kilo chat call.
 *
 * `abortSignal ?? AbortSignal.timeout(10_000)` meant the cap was DEAD whenever a
 * route passed its own timer, so one hung fetch could consume the whole route
 * budget. The caller's signal and this cap are now always combined.
 */
const PER_ATTEMPT_TIMEOUT_MS = 10_000;
/**
 * How many usable models `kiloInfer` will try. The K x M fan-out was unbounded:
 * a large catalog meant dozens of sequential 10s attempts, which no route budget
 * can contain. The first three usable models is ample.
 */
const MAX_INFER_MODELS = 3;
/** How long a model is skipped after a transient upstream failure. */
const UPSTREAM_BLOCK_DEFAULT_MS = 2_000;
const UPSTREAM_BLOCK_MAX_MS = 15_000;
/** At most one auto-retry per key/model combination after a 502/503/504. */
const MAX_UPSTREAM_RETRIES = 1;

/** Abort-aware sleep used to honour `Retry-After` before a single auto-retry. */
async function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    abortSignal?.addEventListener("abort", done, { once: true });
  });
}

function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => {
      controller.abort(signal.reason);
    }, { once: true });
  }
  return controller.signal;
}

/** Caller signal (may be absent) AND a per-attempt cap, always both. */
function attemptSignal(abortSignal?: AbortSignal): AbortSignal {
  const perAttempt = AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS);
  return abortSignal ? combineAbortSignals(abortSignal, perAttempt) : perAttempt;
}

function makeId(prefix = "chatcmpl"): string {
  try {
    const arr = crypto.getRandomValues(new Uint32Array(3));
    return `${prefix}-${Array.from(arr).map((v) => v.toString(16).padStart(8, "0")).join("").slice(0, 24)}`;
  } catch {
    return `${prefix}-${Math.random().toString(36).substring(2, 11)}`;
  }
}

export interface KiloKeyState {
  keyIndex: number;
  envName: string;
  /** Normalized key material. Never logged or exposed in any status/health response. */
  keyValue: string;
  endpointUrl: string;
  inputPrice: number | null;
  outputPrice: number | null;
  zeroCostVerified: boolean;
  available: boolean;
  rateLimited: boolean;
  rateLimitScope: "key" | "model" | "global" | "unknown" | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  /** Last HTTP status seen for this key, for /api/health diagnostics. */
  lastStatus: number | null;
  /** Last failure message for this key, for /api/health diagnostics. */
  lastError: string | null;
  /** Earliest time a failed key may be probed again; null means "no cooldown". */
  reprobeAfter: string | null;
  /** Current cooldown length; doubles up to {@link KEY_REPROBE_MAX_MS}. */
  reprobeDelayMs: number;
}

export interface ModelCandidate {
  modelId: string;
  inputPrice: number | null;
  outputPrice: number | null;
  zeroCostVerified: boolean;
  available: boolean;
  rateLimited: boolean;
  rateLimitScope: "key" | "model" | "global" | "unknown" | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  /** Epoch ms until which this model is skipped after a transient failure. */
  blockedUntil: number | null;
}

interface KiloModelCatalogEntry {
  id: string;
  pricing?: {
    prompt?: number | null;
    input?: number | null;
    completion?: number | null;
    output?: number | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** A model can be used unless it is rate limited or inside a transient cooldown. */
function isModelUsable(model: ModelCandidate): boolean {
  return model.available && !model.rateLimited && (model.blockedUntil ?? 0) <= Date.now();
}

/**
 * Accepts every shape the gateway has used for the catalog payload:
 * `{data: []}`, a bare array, `{models: []}` and `{data: {models: []}}`.
 * Returning `[]` for an unrecognised shape used to leave the pool empty, which
 * (combined with a 5s fetch abort on a 481KB payload) killed every key.
 */
function parseCatalogModels(data: unknown): KiloModelCatalogEntry[] {
  if (Array.isArray(data)) return data as KiloModelCatalogEntry[];
  if (!data || typeof data !== "object") return [];
  const root = data as Record<string, unknown>;
  if (Array.isArray(root.data)) return root.data as KiloModelCatalogEntry[];
  if (Array.isArray(root.models)) return root.models as KiloModelCatalogEntry[];
  if (root.data && typeof root.data === "object" && Array.isArray((root.data as Record<string, unknown>).models)) {
    return (root.data as Record<string, unknown>).models as KiloModelCatalogEntry[];
  }
  return [];
}

export interface KiloInferPayload {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  response_format?: unknown;
}

export class KiloRouter {
  private keyStates: KiloKeyState[] = [];
  private modelCandidates: ModelCandidate[] = [];
  private initialized: boolean = false;
  private initializing: Promise<void> | null = null;
  private catalogLastRefresh: string | null = null;

  async initKiloRouter(abortSignal?: AbortSignal): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) {
      await this.initializing;
      return;
    }
    this.initializing = this._doInit(abortSignal);
    try {
      await this.initializing;
    } finally {
      // A failed/aborted init must not poison the instance: without this the
      // rejected promise stayed cached as `initializing` and every later request
      // rethrew the FIRST caller's timeout.
      if (!this.initialized) this.initializing = null;
    }
  }

  private async _doInit(abortSignal?: AbortSignal): Promise<void> {
    const keys = readConfiguredKeys(KILO_KEY_ENV_NAMES);
    if (keys.length === 0) {
      this.keyStates = [];
      this.initialized = true;
      this.initializing = null;
      return;
    }
    this.keyStates = keys.map((key, index) => ({
      keyIndex: index,
      envName: key.envName,
      keyValue: key.value,
      endpointUrl: KILO_GATEWAY_CHAT_URL,
      inputPrice: null,
      outputPrice: null,
      zeroCostVerified: false,
      available: false,
      rateLimited: false,
      rateLimitScope: null,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: null,
      lastStatus: null,
      lastError: null,
      reprobeAfter: null,
      reprobeDelayMs: KEY_REPROBE_BASE_MS,
    }));

    for (const key of keys) {
      if (!isRecognizedKiloGatewayKeyFormat(key.value)) {
        console.warn(
          `Kilo Gateway key ${key.envName} does not match a recognized format ` +
          `(expected a JWT starting with "${KILO_GATEWAY_JWT_PREFIX}" or an "sk-" key). ` +
          `It will still be tried, but the gateway will likely reject it.`
        );
      }
    }

    // `force: false` so a fresh catalog cache entry is honoured instead of
    // re-downloading ~481KB on every cold start.
    await this.refreshKiloModels(false, abortSignal);

    // Probe keys against eligible models in PARALLEL with a timeout.
    // Prefer zero-cost models, but fall back to any available model.
    // Sequential probing would cause Vercel function timeouts with many keys/models.
    let eligibleModels = this.usableProbeModels();
    if (eligibleModels.length === 0 && this.modelCandidates.length === 0) {
      // The catalog fetch failed or returned an unknown shape. Key validity
      // must not depend on catalog success, so probe against the default model
      // instead of skipping probing entirely and later throwing "no keys".
      console.warn(
        "Kilo model catalog is empty; probing keys against the default model only",
      );
      this.modelCandidates = this.buildCandidatePool([{ id: DEFAULT_KILO_MODEL_ID }]);
      eligibleModels = this.usableProbeModels();
    }
    if (eligibleModels.length > 0) {
      // Combine the passed abort signal with our internal timeout. The caller's
      // signal is still honoured, so /api/health's 10s budget continues to bound this.
      const controller = new AbortController();
      const combinedSignal = abortSignal
        ? combineAbortSignals(abortSignal, controller.signal)
        : controller.signal;
      const overallTimeout = setTimeout(() => controller.abort(), INIT_PROBE_TIMEOUT_MS);
      try {
        // For each key, probe up to MAX_PROBE_MODELS_PER_KEY eligible models
        // (one success is enough) and run all key probes in parallel.
        const probeResults = await Promise.all(
          this.keyStates.map(async (keyState) => {
            for (const model of eligibleModels.slice(0, MAX_PROBE_MODELS_PER_KEY)) {
              try {
                const probe = await this.probeKeyModel(keyState, model, combinedSignal);
                if (probe.success) return probe;
              } catch {
                // Already recorded on the key state by probeKeyModel.
              }
            }
            return { success: false };
          }),
        );
      for (let i = 0; i < this.keyStates.length; i++) {
          const keyState = this.keyStates[i];
          const probe = probeResults[i];
          if (probe.success) this.applyProbeResult(keyState, probe);
        }
      } finally {
        clearTimeout(overallTimeout);
        controller.abort();
      }
    }

    this.initialized = true;
    this.initializing = null;
  }

  /** Models eligible for a probe/inference right now (not rate limited, not cooling down). */
  private usableProbeModels(): ModelCandidate[] {
    const usable = this.modelCandidates.filter(isModelUsable);
    // Prefer zero-cost models, but never at the cost of having no model at all.
    const zeroCost = usable.filter((m) => m.zeroCostVerified);
    return zeroCost.length > 0 ? zeroCost : usable;
  }

  private applyProbeResult(
    keyState: KiloKeyState,
    probe: { success: boolean; inputPrice?: number | null; outputPrice?: number | null; zeroCostVerified?: boolean },
  ): void {
    if (!probe.success) return;
    keyState.available = true;
    keyState.inputPrice = probe.inputPrice ?? null;
    keyState.outputPrice = probe.outputPrice ?? null;
    keyState.zeroCostVerified = probe.zeroCostVerified ?? false;
    keyState.lastCheckedAt = new Date().toISOString();
    keyState.lastSuccessAt = keyState.lastCheckedAt;
    keyState.lastStatus = 200;
    keyState.lastError = null;
    keyState.rateLimited = false;
    keyState.rateLimitScope = null;
    // A key that works again is back to the shortest cooldown.
    keyState.reprobeAfter = null;
    keyState.reprobeDelayMs = KEY_REPROBE_BASE_MS;
  }

  /**
   * Marks a key as currently unusable WITHOUT latching it off forever: a bounded
   * cooldown is recorded so {@link reprobeUnusableKeys} can try it again.
   *
   * Also clears the rateLimited flag: this method is called for inconclusive
   * errors (400, 402, 404, 5xx, timeouts), none of which are rate-limit
   * responses. If we leave rateLimited=true from an earlier 429, the key is
   * permanently excluded from both reprobeUnusableKeys and kiloInfer's usable
   * set, creating a self-inflicted deadlock.
   */
  private markKeyUnavailable(
    keyState: KiloKeyState,
    reason: string,
    status: number | null,
    cooldownMs: number = keyState.reprobeDelayMs,
  ): void {
    keyState.available = false;
    keyState.lastStatus = status;
    keyState.lastError = reason;
    keyState.lastCheckedAt = new Date().toISOString();
    keyState.reprobeAfter = new Date(Date.now() + cooldownMs).toISOString();
    keyState.reprobeDelayMs = Math.min(keyState.reprobeDelayMs * 2, KEY_REPROBE_MAX_MS);
    keyState.rateLimited = false;
    keyState.rateLimitScope = null;
    keyState.rateLimitResetAt = null;
    keyState.rateLimitRemaining = null;
  }

  private canReprobe(keyState: KiloKeyState): boolean {
    if (keyState.reprobeAfter === null) return true;
    const at = Date.parse(keyState.reprobeAfter);
    return !Number.isFinite(at) || at <= Date.now();
  }

  private isRateLimitResetElapsed(keyState: KiloKeyState): boolean {
    if (!keyState.rateLimited) return true;
    if (keyState.rateLimitResetAt === null) return false;
    return Date.parse(keyState.rateLimitResetAt) <= Date.now();
  }

  async refreshKiloModels(force: boolean = false, abortSignal?: AbortSignal): Promise<void> {
    const cached = await getCache<{ models: KiloModelCatalogEntry[]; timestamp: number }>(
      "kilo:model-catalog",
      MODEL_CACHE_MS
    );

    if (!force && cached && Date.now() - cached.timestamp < MODEL_CACHE_MS) {
      this.modelCandidates = this.buildCandidatePool(cached.models);
      this.catalogLastRefresh = new Date(cached.timestamp).toISOString();
      return;
    }

    // Combine the passed abort signal with a realistic internal timeout. The
    // caller's signal still bounds fast paths like /api/health.
    const controller = new AbortController();
    const combinedSignal = abortSignal
      ? combineAbortSignals(abortSignal, controller.signal)
      : controller.signal;
    const timeoutId = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS);

    try {
      try {
        const authKey = this.keyStates[0]?.keyValue ?? "";
        if (abortSignal?.aborted) {
          throw new Error("Kilo model catalog refresh aborted");
        }
        const response = await fetch(KILO_GATEWAY_MODELS_URL, {
          headers: {
            Accept: "application/json",
            ...(authKey ? { Authorization: `Bearer ${authKey}` } : {}),
          },
          signal: combinedSignal,
        });

        if (!response.ok) {
          throw new Error(`Model catalog request failed with status ${response.status}`);
        }

        const data = await response.json();
        const models = parseCatalogModels(data);

        this.modelCandidates = this.buildCandidatePool(models);
        this.catalogLastRefresh = new Date().toISOString();
        await setCache("kilo:model-catalog", { models, timestamp: Date.now() }, MODEL_CACHE_MS);
        // Keep a long-lived copy so a failed refresh can still resolve models.
        await setCache(CATALOG_BACKUP_KEY, { models, timestamp: Date.now() }, CATALOG_BACKUP_TTL_MS);
      } catch (error) {
        // A caller-cancelled refresh is a TIMEOUT, not a failed refresh. Falling
        // through to the backup lookup and then to key probing here burned up to
        // 8 more seconds PAST the caller's deadline, which is how an aborted
        // request kept running well after its route timer had fired.
        if (abortSignal?.aborted) throw error;
        console.error("Kilo model catalog refresh failed:", error);
        // A failed refresh must not leave the pool empty: fall back to the last
        // known-good catalog. Previously only a log was emitted, which made every
        // subsequent request throw "No available Kilo Gateway key/model combinations".
        const backup = await getCache<{ models: KiloModelCatalogEntry[]; timestamp: number }>(
          CATALOG_BACKUP_KEY,
          CATALOG_BACKUP_TTL_MS,
        );
        if (backup && Array.isArray(backup.models) && backup.models.length > 0) {
          this.modelCandidates = this.buildCandidatePool(backup.models);
          this.catalogLastRefresh = new Date(backup.timestamp).toISOString();
          console.warn(
            `Kilo model catalog refresh failed; using last known-good catalog from ${this.catalogLastRefresh}`,
          );
        }
      }
    } finally {
      clearTimeout(timeoutId);
      controller.abort();
    }
  }

  private buildCandidatePool(models: KiloModelCatalogEntry[]): ModelCandidate[] {
    const candidates: ModelCandidate[] = [];

    for (const model of models) {
      const modelId = typeof model.id === "string" ? model.id : "";
      if (!modelId) continue;

      const pricing = model.pricing ?? {};
      const inputPrice = this.parsePrice(pricing.prompt ?? pricing.input);
      const outputPrice = this.parsePrice(pricing.completion ?? pricing.output);

      const zeroCostVerified =
        inputPrice !== null &&
        outputPrice !== null &&
        inputPrice === 0 &&
        outputPrice === 0;

      candidates.push({
        modelId,
        inputPrice,
        outputPrice,
        zeroCostVerified,
        available: true,
        rateLimited: false,
        rateLimitScope: null,
        rateLimitRemaining: null,
        rateLimitResetAt: null,
        lastCheckedAt: null,
        lastSuccessAt: null,
        lastStatus: null,
        lastError: null,
        blockedUntil: null,
      });
    }

    // Prefer default model first
    candidates.sort((a, b) => {
      const aDefault = a.modelId === DEFAULT_KILO_MODEL_ID ? 0 : 1;
      const bDefault = b.modelId === DEFAULT_KILO_MODEL_ID ? 0 : 1;
      return aDefault - bDefault;
    });

    return candidates;
  }

  private parsePrice(value: unknown): number | null {
    if (typeof value !== "number" && typeof value !== "string") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async probeKeyModel(
    keyState: KiloKeyState,
    modelCandidate: ModelCandidate,
    abortSignal?: AbortSignal
  ): Promise<{
    success: boolean;
    inputPrice?: number | null;
    outputPrice?: number | null;
    zeroCostVerified?: boolean;
    rateLimitScope?: "key" | "model" | "global" | "unknown" | null;
  }> {
    const probeKey = `kilo:access-probe:${keyState.keyIndex}:${modelCandidate.modelId}`;
    // `zeroCostVerified` is part of the cached payload: omitting it made a cache
    // hit silently downgrade the key's zero-cost flag to false.
    const cached = await getCache<{
      success: boolean;
      inputPrice: number | null;
      outputPrice: number | null;
      zeroCostVerified?: boolean;
    }>(probeKey, ACCESS_PROBE_CACHE_MS);

    if (cached) {
      return cached;
    }

    try {
      const response = await fetch(KILO_GATEWAY_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${keyState.keyValue}`,
        },
        body: JSON.stringify({
          model: modelCandidate.modelId,
          messages: [
            {
              role: "system",
              content: "You are a test assistant. Reply with exactly: probe-ok",
            },
            {
              role: "user",
              content: "probe-ok",
            },
          ],
          // A 4-token cap is routinely rejected by router/auto models, which
          // turned a perfectly valid key into a "dead" one.
          max_tokens: PROBE_MAX_TOKENS,
          temperature: PROBE_TEMPERATURE,
        }),
        signal: attemptSignal(abortSignal),
      });

      const status = response.status;
      const responseHeaders = response.headers;
      const retryAfter = responseHeaders.get("retry-after");
      const rateLimitRemaining = responseHeaders.get("x-ratelimit-remaining");
      const rateLimitReset = responseHeaders.get("x-ratelimit-reset");

      // Any 2xx proves the credential works. Requiring exactly 200 marked a
      // valid key dead over a harmless status difference.
      if (status >= 200 && status < 300) {
        const result = {
          success: true,
          inputPrice: modelCandidate.inputPrice,
          outputPrice: modelCandidate.outputPrice,
          zeroCostVerified: modelCandidate.zeroCostVerified,
        };
        keyState.lastStatus = status;
        keyState.lastError = null;
        await setCache(probeKey, result, ACCESS_PROBE_CACHE_MS);
        return result;
      }

      if (status === 401 || status === 403) {
        // The only genuinely permanent verdict about a credential — still given a
        // long cooldown so a rotated key is not re-probed on every request.
        keyState.available = false;
        keyState.lastStatus = status;
        keyState.lastError = `Access denied (status ${status})`;
        keyState.lastCheckedAt = new Date().toISOString();
        keyState.reprobeAfter = new Date(Date.now() + ACCESS_DENIED_REPROBE_MS).toISOString();
        return { success: false };
      }

      if (isRetryableUpstreamStatus(status)) {
        // "Provider temporarily unavailable" is not a verdict on the key: cool
        // the model down and let the next combination be tried.
        this.blockModel(modelCandidate, this.retryAfterMs(retryAfter));
        keyState.lastStatus = status;
        keyState.lastError = `Upstream unavailable (status ${status})`;
        keyState.lastCheckedAt = new Date().toISOString();
        return { success: false, inputPrice: modelCandidate.inputPrice, outputPrice: modelCandidate.outputPrice };
      }

      if (isGlobalRateLimitStatus(status)) {
        let scope: "key" | "model" | "global" | "unknown" | null = "unknown";
        const body = await response.text();
        const code = this.extractRateLimitCode(body);

        if (code.includes("key") || code.includes("rate_limit_key")) {
          scope = "key";
        } else if (code.includes("model") || code.includes("rate_limit_model")) {
          scope = "model";
        } else if (code.includes("global") || code.includes("ip")) {
          scope = "global";
        }

        const resetAt = this.parseResetAt(retryAfter, rateLimitReset);

        if (scope === "global") {
          // Mark all keys and models as globally rate-limited
          for (const key of this.keyStates) {
            key.rateLimited = true;
            key.rateLimitScope = "global";
            key.rateLimitResetAt = resetAt;
            key.rateLimitRemaining = this.parseRateLimitRemaining(rateLimitRemaining);
            key.lastCheckedAt = new Date().toISOString();
          }
          for (const model of this.modelCandidates) {
            model.rateLimited = true;
            model.rateLimitScope = "global";
            model.rateLimitResetAt = resetAt;
          }
        } else if (scope === "key") {
          keyState.rateLimited = true;
          keyState.rateLimitScope = "key";
          keyState.rateLimitResetAt = resetAt;
          keyState.rateLimitRemaining = this.parseRateLimitRemaining(rateLimitRemaining);
          keyState.lastCheckedAt = new Date().toISOString();
        } else if (scope === "model") {
          modelCandidate.rateLimited = true;
          modelCandidate.rateLimitScope = "model";
          modelCandidate.rateLimitResetAt = resetAt;
          modelCandidate.rateLimitRemaining = this.parseRateLimitRemaining(rateLimitRemaining);
          modelCandidate.lastCheckedAt = new Date().toISOString();
        } else {
          keyState.rateLimited = true;
          keyState.rateLimitScope = "unknown";
          keyState.rateLimitResetAt = resetAt;
          keyState.lastCheckedAt = new Date().toISOString();
          modelCandidate.rateLimited = true;
          modelCandidate.rateLimitScope = "unknown";
          modelCandidate.lastCheckedAt = new Date().toISOString();
        }

        return {
          success: false,
          inputPrice: modelCandidate.inputPrice,
          outputPrice: modelCandidate.outputPrice,
          rateLimitScope: scope,
        };
      }

      // Anything else (400, 402, 404, 5xx, ...) is inconclusive: park the key
      // behind a short, growing cooldown instead of latching it off forever.
      this.markKeyUnavailable(keyState, `Probe failed with status ${status}`, status);
      return { success: false };
    } catch (error) {
      // Network errors or timeouts say nothing about the credential either.
      console.error("Kilo access probe failed:", sanitizeError(String(error)));
      // BUT a probe that was cut short by the caller's budget is not evidence
      // about the key at all. Walking a healthy key onto the 60 -> 120 -> 240s
      // cooldown ladder because a route timed out is a self-inflicted outage:
      // the key is reported as failed and never retried for minutes.
      if (abortSignal?.aborted) return { success: false };
      this.markKeyUnavailable(
        keyState,
        `Probe error: ${sanitizeError(String(error)).slice(0, 160)}`,
        null,
        5000,
      );
      return { success: false };
    }
  }

  /** Temporarily skips a model; the block expires so a later request retries it. */
  private blockModel(modelCandidate: ModelCandidate, ms: number): void {
    modelCandidate.blockedUntil = Date.now() + Math.max(0, ms);
  }

  private retryAfterMs(retryAfter: string | null): number {
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, UPSTREAM_BLOCK_MAX_MS);
      }
      const at = Date.parse(retryAfter);
      if (!Number.isNaN(at)) {
        return Math.min(Math.max(at - Date.now(), 0), UPSTREAM_BLOCK_MAX_MS);
      }
    }
    return UPSTREAM_BLOCK_DEFAULT_MS;
  }

  /**
   * Re-probes keys that are currently marked unavailable whose cooldown has
   * elapsed. The previous recovery path only re-fetched the model catalog, so a
   * key that failed a single transient probe stayed dead for the whole
   * instance lifetime.
   *
   * Rate-limited keys are also re-probed once their rate-limit cooldown has
   * elapsed (rateLimitResetAt), since the rateLimited flag is otherwise
   * permanent and creates a deadlock with the only recovery path.
   */
  private async reprobeUnusableKeys(abortSignal?: AbortSignal): Promise<number> {
    const pending = this.keyStates.filter((k) => {
      if (k.available) return false;
      if (!this.canReprobe(k)) return false;
      if (k.rateLimited && !this.isRateLimitResetElapsed(k)) return false;
      return true;
    });
    if (pending.length === 0) return 0;

    let models = this.usableProbeModels();
    if (models.length === 0 && this.modelCandidates.length === 0) {
      this.modelCandidates = this.buildCandidatePool([{ id: DEFAULT_KILO_MODEL_ID }]);
      models = this.usableProbeModels();
    }
    if (models.length === 0) return 0;

    const controller = new AbortController();
    const combinedSignal = abortSignal
      ? combineAbortSignals(abortSignal, controller.signal)
      : controller.signal;
    const timeout = setTimeout(() => controller.abort(), REPROBE_TIMEOUT_MS);
    try {
      const results = await Promise.all(
        pending.map(async (keyState) => {
          for (const model of models.slice(0, MAX_PROBE_MODELS_PER_KEY)) {
            try {
              const probe = await this.probeKeyModel(keyState, model, combinedSignal);
              if (probe.success) {
                this.applyProbeResult(keyState, probe);
                return true;
              }
            } catch {
              // Recorded on the key state.
            }
          }
          return false;
        }),
      );
      const recovered = results.filter(Boolean).length;
      if (recovered > 0) {
        console.warn(`Kilo: re-probe recovered ${recovered}/${pending.length} previously unavailable key(s)`);
      }
      return recovered;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  private extractRateLimitCode(body: string): string {
    try {
      const data = JSON.parse(body);
      return JSON.stringify(data).toLowerCase();
    } catch {
      return body.toLowerCase();
    }
  }

  private parseRateLimitRemaining(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseResetAt(retryAfter: string | null, rateLimitReset: string | null): string | null {
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) {
        return new Date(Date.now() + seconds * 1000).toISOString();
      }
    }
    if (rateLimitReset) {
      const parsed = Date.parse(rateLimitReset);
      if (!Number.isNaN(parsed)) {
        return new Date(parsed).toISOString();
      }
    }
    return null;
  }

  async kiloInfer(payload: KiloInferPayload, abortSignal?: AbortSignal): Promise<KiloResponse> {
    if (!this.initialized) {
      await this.initKiloRouter(abortSignal);
    } else if (this.initializing) {
      await this.initializing;
    }

    // Recovery. The old path re-fetched the model catalog but never re-probed
    // KEYS, so one transient failure latched every key off for the lifetime of
    // the instance. Models are refreshed, keys whose cooldown has elapsed are
    // re-probed, and an empty catalog falls back to the default model.
    const isKeyUsable = (k: KiloKeyState): boolean =>
      k.available && (!k.rateLimited || this.isRateLimitResetElapsed(k));

    const hasAnyUsableKeys = this.keyStates.some(isKeyUsable);
    const hasAnyUsableModels = this.modelCandidates.some(isModelUsable);

    if (!hasAnyUsableModels) {
      await this.refreshKiloModels(false, abortSignal);
    }
    if (!hasAnyUsableKeys || !this.modelCandidates.some(isModelUsable)) {
      await this.reprobeUnusableKeys(abortSignal);
    }
    if (this.modelCandidates.length === 0) {
      this.modelCandidates = this.buildCandidatePool([{ id: DEFAULT_KILO_MODEL_ID }]);
    }

    const keys = this.shuffle(this.keyStates.filter(isKeyUsable));

    // First try zero-cost models only
    let models = this.shuffle(
      this.modelCandidates.filter(isModelUsable).filter((m) => m.zeroCostVerified),
    );

    // If no zero-cost models available, fall back to any available model
    if (models.length === 0) {
      console.warn("No zero-cost Kilo models available; falling back to any available model");
      models = this.shuffle(this.modelCandidates.filter(isModelUsable));
    }

    // Bound the K x M fan-out. With a large catalog the unbounded loop below
    // could make dozens of sequential 10s attempts, which no route budget can
    // contain; the first few usable models are enough to get a usable answer.
    if (models.length > MAX_INFER_MODELS) models = models.slice(0, MAX_INFER_MODELS);

    if (keys.length === 0 || models.length === 0) {
      // FIRST, before any diagnostic: a timeout must never be reported as an
      // unavailable gateway. Callers map this message onto `kilo-unavailable`,
      // which blames the credential for what is really an exhausted budget.
      if (abortSignal?.aborted) throw new Error("Kilo inference aborted");
      if (this.keyStates.length === 0) {
        throw new Error(
          "No Kilo Gateway key is configured (set KILO_API_KEY or KILO_GATEWAY_KEY[_1..5])",
        );
      }
      if (models.length === 0) {
        throw new Error("No Kilo Gateway models available (model catalog empty or all models cooling down)");
      }
      const coolingDown = this.keyStates.filter((k) => !this.canReprobe(k)).length;
      throw new Error(
        `No available Kilo Gateway key/model combinations (0/${this.keyStates.length} usable keys, ` +
        `${coolingDown} still in re-probe cooldown)`,
      );
    }

    let lastError: Error | null = null;
    // Bounds the Retry-After auto-retries to one per key/model combination.
    const retriedUpstreamCombinations = new Set<string>();

    for (const keyState of keys) {
      for (const modelCandidate of models) {
        // If the abort signal has been fired, stop retrying
        if (abortSignal && abortSignal.aborted) {
          throw new Error("Kilo inference aborted");
        }

        let response: Response;
        try {
          response = await fetch(KILO_GATEWAY_CHAT_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${keyState.keyValue}`,
            },
            body: JSON.stringify({
              model: modelCandidate.modelId,
              messages: payload.messages ?? [],
              max_tokens: payload.max_tokens ?? 2048,
              temperature: payload.temperature ?? 0.7,
              response_format: payload.response_format ?? undefined,
            }),
            signal: attemptSignal(abortSignal),
          });
        } catch (error) {
          if (abortSignal && abortSignal.aborted) {
            throw new Error("Kilo inference aborted");
          }
          lastError = error instanceof Error ? error : new Error(String(error));
          this.markKeyUnavailable(
            keyState,
            `Request error: ${sanitizeError(String(lastError.message)).slice(0, 160)}`,
            null,
            15_000,
          );
          continue;
        }

        const status = response.status;

        if (status === 200) {
          let data: any;
          try {
            data = await response.json();
          } catch (error) {
            // A body that will not parse is a per-model failure, not a verdict
            // on the credential; the key must stay usable.
            this.blockModel(modelCandidate, UPSTREAM_BLOCK_DEFAULT_MS);
            lastError = new Error(
              `Kilo returned an unparseable body with status 200: ${sanitizeError(String(error)).slice(0, 120)}`,
            );
            continue;
          }

          const rawChoices = Array.isArray(data?.choices) ? data.choices : [];
          const firstChoice = rawChoices[0];
          const content =
            typeof firstChoice?.message?.content === "string" ? firstChoice.message.content : "";
          const finishReason =
            typeof firstChoice?.finish_reason === "string" ? firstChoice.finish_reason : "stop";

          // A 200 whose body is empty or truncated at the token cap is
          // RETRYABLE. Coercing null content to "" made every caller parse an
          // empty string and silently fall back to the static factor set.
          if (rawChoices.length === 0 || content.trim() === "" || finishReason === "length") {
            this.blockModel(modelCandidate, UPSTREAM_BLOCK_DEFAULT_MS);
            lastError = new Error(
              `Kilo response unusable (choices=${rawChoices.length}, finish_reason=${finishReason}, ` +
              `contentChars=${content.length})`,
            );
            console.warn(
              `Kilo: ${lastError.message} — retrying with a larger max_tokens or the next model`,
            );
            continue;
          }

          const result: KiloResponse = {
            id: data.id ?? makeId(),
            object: data.object ?? "chat.completion",
            created: data.created ?? Math.floor(Date.now() / 1000),
            model: data.model ?? modelCandidate.modelId,
            choices: rawChoices.map((choice: any) => ({
              index: choice?.index ?? 0,
              message: {
                role: choice?.message?.role ?? "assistant",
                content: choice?.message?.content ?? "",
              },
              logprobs: choice?.logprobs ?? null,
              finish_reason: choice?.finish_reason ?? "stop",
            })),
            usage: {
              prompt_tokens: data.usage?.prompt_tokens ?? 0,
              completion_tokens: data.usage?.completion_tokens ?? 0,
              total_tokens: data.usage?.total_tokens ?? 0,
            },
          };

          keyState.lastCheckedAt = new Date().toISOString();
          keyState.lastSuccessAt = keyState.lastCheckedAt;
          keyState.rateLimited = false;
          keyState.lastStatus = status;
          keyState.lastError = null;
          keyState.reprobeAfter = null;
          keyState.reprobeDelayMs = KEY_REPROBE_BASE_MS;
          modelCandidate.lastCheckedAt = new Date().toISOString();
          modelCandidate.lastSuccessAt = modelCandidate.lastCheckedAt;
          modelCandidate.rateLimited = false;
          modelCandidate.lastStatus = status;
          modelCandidate.lastError = null;
          modelCandidate.blockedUntil = null;

          return result;
        }

        if (status === 401 || status === 403) {
          keyState.available = false;
          keyState.lastStatus = status;
          keyState.lastError = `Access denied (status ${status})`;
          keyState.lastCheckedAt = new Date().toISOString();
          // Long cooldown rather than "never": a rotated credential must be able
          // to recover without a redeploy.
          keyState.reprobeAfter = new Date(Date.now() + ACCESS_DENIED_REPROBE_MS).toISOString();
          continue;
        }

        if (isRetryableUpstreamStatus(status)) {
          // 502/503/504 mean "upstream temporarily unavailable" (the gateway even
          // remaps an upstream 402 to 503). They are handled per model, so a
          // single hiccup can no longer latch every key and model as blocked.
          const retryAfterMs = this.retryAfterMs(response.headers.get("retry-after"));
          this.blockModel(modelCandidate, retryAfterMs);
          modelCandidate.lastStatus = status;
          modelCandidate.lastError = `Upstream unavailable (status ${status})`;
          modelCandidate.lastCheckedAt = new Date().toISOString();
          keyState.lastStatus = status;
          keyState.lastError = `Upstream unavailable (status ${status})`;
          lastError = new Error(`Kilo upstream unavailable (status ${status})`);

          // One bounded auto-retry of the same combination when the upstream
          // told us when to come back; otherwise fall through to the next model.
          if (retriedUpstreamCombinations.size < MAX_UPSTREAM_RETRIES) {
            retriedUpstreamCombinations.add(`${keyState.keyIndex}:${modelCandidate.modelId}`);
            console.warn(
              `Kilo: status ${status} on ${modelCandidate.modelId}; retrying this key/model once in ${retryAfterMs}ms`,
            );
            await sleep(retryAfterMs, abortSignal);
            continue;
          }
          continue;
        }

        if (isGlobalRateLimitStatus(status)) {
          const body = await response.text();
          const code = this.extractRateLimitCode(body);
          const retryAfter = response.headers.get("retry-after");
          const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
          const rateLimitReset = response.headers.get("x-ratelimit-reset");
          let scope: "key" | "model" | "global" | "unknown" | null = "unknown";

          if (code.includes("key") || code.includes("rate_limit_key")) {
            scope = "key";
          } else if (code.includes("model") || code.includes("rate_limit_model")) {
            scope = "model";
          } else if (code.includes("global") || code.includes("ip")) {
            scope = "global";
          }

          const resetAt = this.parseResetAt(retryAfter, rateLimitReset);

          if (scope === "global") {
            for (const key of this.keyStates) {
              key.rateLimited = true;
              key.rateLimitScope = "global";
              key.rateLimitResetAt = resetAt;
              key.rateLimitRemaining = this.parseRateLimitRemaining(rateLimitRemaining);
              key.lastCheckedAt = new Date().toISOString();
              key.lastStatus = status;
            }
            for (const model of this.modelCandidates) {
              model.rateLimited = true;
              model.rateLimitScope = "global";
              model.rateLimitResetAt = resetAt;
            }
            throw new Error("Global Kilo rate limit detected");
          } else if (scope === "key") {
            keyState.rateLimited = true;
            keyState.rateLimitScope = "key";
            keyState.rateLimitResetAt = resetAt;
            keyState.rateLimitRemaining = this.parseRateLimitRemaining(rateLimitRemaining);
            keyState.lastCheckedAt = new Date().toISOString();
            keyState.lastStatus = status;
          } else if (scope === "model") {
            modelCandidate.rateLimited = true;
            modelCandidate.rateLimitScope = "model";
            modelCandidate.rateLimitResetAt = resetAt;
            modelCandidate.rateLimitRemaining = this.parseRateLimitRemaining(rateLimitRemaining);
            modelCandidate.lastCheckedAt = new Date().toISOString();
            modelCandidate.lastStatus = status;
          } else {
            keyState.rateLimited = true;
            keyState.rateLimitScope = "unknown";
            keyState.rateLimitResetAt = resetAt;
            keyState.lastCheckedAt = new Date().toISOString();
            keyState.lastStatus = status;
            modelCandidate.rateLimited = true;
            modelCandidate.rateLimitScope = "unknown";
            modelCandidate.lastCheckedAt = new Date().toISOString();
            modelCandidate.lastStatus = status;
          }

          lastError = new Error(`Kilo request failed with status ${status}`);
          continue;
        }

        // Anything else (400, 402, 404, unexpected 5xx, ...) is inconclusive:
        // park the key behind a short cooldown and try the next combination.
        this.markKeyUnavailable(keyState, `Request failed with status ${status}`, status, 30_000);
        lastError = new Error(`Kilo request failed with status ${status}`);
      }
    }

    throw lastError ?? new Error("No available Kilo Gateway key/model combinations");
  }

  async getKiloStatus(abortSignal?: AbortSignal, quick: boolean = false): Promise<KiloStatus> {
    if (!quick && !this.initialized) {
      await this.initKiloRouter(abortSignal);
    } else if (this.initializing) {
      await this.initializing;
    }

    // In quick mode, ensure keyStates is populated at least with configured keys
    if (!this.initialized && this.keyStates.length === 0) {
      const keys = readConfiguredKeys(KILO_KEY_ENV_NAMES);
      this.keyStates = keys.map((key, index) => ({
        keyIndex: index,
        envName: key.envName,
        keyValue: key.value,
        endpointUrl: KILO_GATEWAY_CHAT_URL,
        inputPrice: null,
        outputPrice: null,
        zeroCostVerified: false,
        available: false,
        rateLimited: false,
        rateLimitScope: null,
        rateLimitRemaining: null,
        rateLimitResetAt: null,
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: null,
        lastStatus: null,
        lastError: null,
        reprobeAfter: null,
        reprobeDelayMs: KEY_REPROBE_BASE_MS,
      }));
    }

    if (!this.initialized) {
      // Quick mode: return basic status even if not initialized
      const usableKeys = this.keyStates.filter(k => k.available && !k.rateLimited).length;
      const rateLimitedKeys = this.keyStates
        .filter(k => k.rateLimited)
        .map((k) => k.keyIndex);
      const globalRateLimited = this.keyStates.length > 0 &&
        this.keyStates.every(k => k.rateLimited);

      return {
        available: false,
        zeroCostModels: [],
        defaultModel: DEFAULT_KILO_MODEL_ID,
        activeModel: null,
        configuredKeys: this.keyStates.length,
        usableKeys,
        rateLimitedKeys,
        rateLimitedModels: [],
        globalRateLimited,
        catalogLastRefresh: this.catalogLastRefresh,
        keyFormats: {
          jwt: this.keyStates.filter(k => isJwtApiKey(k.keyValue)).length,
          opaque: this.keyStates.filter(k => isOpaqueApiKey(k.keyValue)).length,
          unrecognized: this.keyStates.filter(k => !isRecognizedKiloGatewayKeyFormat(k.keyValue)).length,
        },
        ...this.diagnosticFields(),
      };
    }

    const zeroCostModels = this.modelCandidates
      .filter(m => m.zeroCostVerified && m.available && !m.rateLimited)
      .map(m => m.modelId);

    const anyModels = this.modelCandidates
      .filter(m => m.available && !m.rateLimited)
      .map(m => m.modelId);

    const usableKeys = this.keyStates.filter(k => k.available && !k.rateLimited).length;
    const rateLimitedKeys = this.keyStates
      .filter(k => k.rateLimited)
      .map((k) => k.keyIndex);

    const rateLimitedModels = this.modelCandidates
      .filter(m => m.rateLimited)
      .map(m => m.modelId);

    const globalRateLimited = this.keyStates.length > 0 &&
      this.keyStates.every(k => k.rateLimited);

    return {
      available: (zeroCostModels.length > 0 || anyModels.length > 0) && usableKeys > 0,
      zeroCostModels,
      defaultModel: DEFAULT_KILO_MODEL_ID,
      activeModel: (zeroCostModels.length > 0 ? zeroCostModels[0] : (anyModels.length > 0 ? anyModels[0] : null)),
      configuredKeys: this.keyStates.length,
      usableKeys,
      rateLimitedKeys,
      rateLimitedModels,
      globalRateLimited,
      catalogLastRefresh: this.catalogLastRefresh,
      keyFormats: {
        jwt: this.keyStates.filter(k => isJwtApiKey(k.keyValue)).length,
        opaque: this.keyStates.filter(k => isOpaqueApiKey(k.keyValue)).length,
        unrecognized: this.keyStates.filter(k => !isRecognizedKiloGatewayKeyFormat(k.keyValue)).length,
      },
      ...this.diagnosticFields(),
    };
  }

  /**
   * Diagnostic detail for /api/health: the env-var NAMES in use (never values),
   * per-key probe outcomes and catalog state. A pipeline that silently serves
   * static fallbacks is otherwise impossible to debug.
   */
  private diagnosticFields() {
    return {
      keyEnvNames: this.keyStates.map((k) => k.envName),
      keyEnvNamesRead: [...KILO_KEY_ENV_NAMES],
      keyDetails: this.keyStates.map((k) => ({
        envName: k.envName,
        available: k.available,
        rateLimited: k.rateLimited,
        zeroCostVerified: k.zeroCostVerified,
        lastStatus: k.lastStatus,
        lastError: k.lastError,
        lastCheckedAt: k.lastCheckedAt,
        lastSuccessAt: k.lastSuccessAt,
        reprobeAfter: k.reprobeAfter,
      })),
      modelCount: this.modelCandidates.length,
      zeroCostModelCount: this.modelCandidates.filter((m) => m.zeroCostVerified).length,
      usableModelCount: this.modelCandidates.filter(isModelUsable).length,
    };
  }

  private shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      let cryptoArray: Uint32Array;
      try {
        cryptoArray = crypto.getRandomValues(new Uint32Array(1));
      } catch {
        cryptoArray = new Uint32Array([Math.floor(Math.random() * 0xFFFFFFFF)]);
      }
      const j = cryptoArray[0] % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

export const kiloRouter = new KiloRouter();

/**
 * Warms the Kilo router once per instance, at module load, off the request path.
 *
 * Kilo init alone can cost ~11s (8s catalog fetch of a ~481KB payload + a 3s
 * probe) and it used to run lazily INSIDE `kiloInfer`, competing with the very
 * request it was serving. `initKiloRouter` is idempotent, so a later request
 * just awaits the same in-flight promise. Guarded to run once per instance, and
 * any rejection is swallowed so a failed warm-up never breaks module load.
 */
(function warmKiloRouterOnce(): void {
  try {
    void kiloRouter.initKiloRouter().catch((error: unknown) => {
      console.warn("Kilo router warm-up failed:", error instanceof Error ? error.message : String(error));
    });
  } catch (error) {
    console.warn("Kilo router warm-up could not start:", error);
  }
})();
