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
  isJwtApiKey,
  isOpaqueApiKey,
  isRecognizedKiloGatewayKeyFormat,
  KILO_GATEWAY_JWT_PREFIX,
} from "./http";
import { getCache, setCache } from "./cache";
import { KiloResponse, KiloStatus } from "./types";

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
    await this.initializing;
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

await this.refreshKiloModels(true, abortSignal);

    // Probe keys against eligible models in PARALLEL with a timeout.
    // Prefer zero-cost models, but fall back to any available model.
    // Sequential probing would cause Vercel function timeouts with many keys/models.
    let eligibleModels = this.modelCandidates.filter(m => m.zeroCostVerified && m.available && !m.rateLimited);
    if (eligibleModels.length === 0) {
      eligibleModels = this.modelCandidates.filter(m => m.available && !m.rateLimited);
    }
    if (eligibleModels.length > 0) {
      // Combine the passed abort signal with our 5s internal timeout. The caller's
      // signal is still honoured, so /api/health's 4s budget continues to bound this.
      const controller = new AbortController();
      const combinedSignal = abortSignal
        ? combineAbortSignals(abortSignal, controller.signal)
        : controller.signal;
      const overallTimeout = setTimeout(() => controller.abort(), 5000);
      try {
        // For each key, probe against the FIRST eligible model only (one success is enough)
        // to minimize total probe time. Run all key probes in parallel.
        const probeResults = await Promise.all(
          this.keyStates.map(async (keyState) => {
            try {
              return await this.probeKeyModel(keyState, eligibleModels[0], combinedSignal);
            } catch {
              return { success: false };
            }
          }),
        );
      for (let i = 0; i < this.keyStates.length; i++) {
          const keyState = this.keyStates[i];
          const probe = probeResults[i];
          if (probe.success) {
            keyState.available = true;
            keyState.inputPrice = probe.inputPrice ?? null;
            keyState.outputPrice = probe.outputPrice ?? null;
            keyState.zeroCostVerified = probe.zeroCostVerified ?? false;
            keyState.lastCheckedAt = new Date().toISOString();
            keyState.lastSuccessAt = keyState.lastCheckedAt;
          }
        }
      } finally {
        clearTimeout(overallTimeout);
        controller.abort();
      }
    }

    this.initialized = true;
    this.initializing = null;
  }

  async refreshKiloModels(force: boolean = false, abortSignal?: AbortSignal): Promise<void> {
    const cached = await getCache<{ models: KiloModelCatalogEntry[]; timestamp: number }>(
      "kilo:model-catalog",
      MODEL_CACHE_MS
    );

    // Combine passed abort signal with our 5s internal timeout. A short budget here
    // latches `initialized` to true on a cold start, leaving keys permanently
    // unavailable; the caller's signal still bounds fast paths like /api/health.
    const controller = new AbortController();
    const combinedSignal = abortSignal
      ? combineAbortSignals(abortSignal, controller.signal)
      : controller.signal;
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      if (!force && cached && Date.now() - cached.timestamp < MODEL_CACHE_MS) {
        this.modelCandidates = this.buildCandidatePool(cached.models);
        return;
      }

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
        const models: KiloModelCatalogEntry[] = Array.isArray(data.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];

        this.modelCandidates = this.buildCandidatePool(models);
        this.catalogLastRefresh = new Date().toISOString();
        await setCache("kilo:model-catalog", { models, timestamp: Date.now() }, MODEL_CACHE_MS);
      } catch (error) {
        console.error("Kilo model catalog refresh failed:", error);
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
    const cached = await getCache<{ success: boolean; inputPrice: number | null; outputPrice: number | null }>(
      probeKey,
      ACCESS_PROBE_CACHE_MS
    );

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
          max_tokens: 4,
          temperature: 0,
        }),
        signal: abortSignal ? abortSignal : AbortSignal.timeout(10000),
      });

      const status = response.status;
      const responseHeaders = response.headers;
      const retryAfter = responseHeaders.get("retry-after");
      const rateLimitRemaining = responseHeaders.get("x-ratelimit-remaining");
      const rateLimitReset = responseHeaders.get("x-ratelimit-reset");

      if (status === 200) {
        const result = {
          success: true,
          inputPrice: modelCandidate.inputPrice,
          outputPrice: modelCandidate.outputPrice,
          zeroCostVerified: modelCandidate.zeroCostVerified,
        };
        await setCache(probeKey, result, ACCESS_PROBE_CACHE_MS);
        return result;
      }

      if (status === 401 || status === 403) {
        keyState.available = false;
        keyState.lastCheckedAt = new Date().toISOString();
        return { success: false };
      }

      if (status === 429 || isGlobalRateLimitStatus(status)) {
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

      // Other errors - mark key as unavailable
      keyState.available = false;
      keyState.lastCheckedAt = new Date().toISOString();
      return { success: false };
    } catch (error) {
      // Network errors or timeouts
      console.error("Kilo access probe failed:", sanitizeError(String(error)));
      keyState.available = false;
      keyState.lastCheckedAt = new Date().toISOString();
      return { success: false };
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

    // Force refresh before returning complete Kilo-unavailable
    const hasAnyUsableKeys = this.keyStates.some(k => k.available && !k.rateLimited);
    const hasAnyUsableModels = this.modelCandidates.some(m => m.available && !m.rateLimited);

    if (!hasAnyUsableKeys || !hasAnyUsableModels) {
      await this.refreshKiloModels(true, abortSignal);
    }

    const keys = this.keyStates
      .filter(k => k.available && !k.rateLimited)
      .map((_k, i) => i);

    // First try zero-cost models only
    let models = this.modelCandidates
      .filter(m => m.zeroCostVerified && m.available && !m.rateLimited)
      .map((_m, i) => i);

    // If no zero-cost models available, fall back to any available model
    if (models.length === 0) {
      console.warn("No zero-cost Kilo models available; falling back to any available model");
      models = this.modelCandidates
        .filter(m => m.available && !m.rateLimited)
        .map((_m, i) => i);
    }

    if (keys.length === 0 || models.length === 0) {
      const availableKeys = this.keyStates.filter(k => k.available && !k.rateLimited);
      const configuredKeys = this.keyStates.filter(k => k.keyIndex !== undefined);
      if (availableKeys.length > 0 && configuredKeys.length > 0) {
        throw new Error("No zero-cost Kilo Gateway models available and no fallback models available");
      }
      throw new Error("No available Kilo Gateway key/model combinations");
    }

    // Shuffle keys and models using crypto-secure random
    const shuffledKeys = this.shuffle(keys);
    const shuffledModels = this.shuffle(models);

    let lastError: Error | null = null;

    for (const keyIndex of shuffledKeys) {
      const keyState = this.keyStates[keyIndex];
      for (const modelIndex of shuffledModels) {
        const modelCandidate = this.modelCandidates[modelIndex];

        try {
          const response = await fetch(KILO_GATEWAY_CHAT_URL, {
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
            signal: abortSignal ?? AbortSignal.timeout(10000),
          });

          const status = response.status;

          if (status === 200) {
            const data = await response.json();
const result: KiloResponse = {
               id: data.id ?? makeId(),
               object: data.object ?? "chat.completion",
              created: data.created ?? Math.floor(Date.now() / 1000),
              model: data.model ?? modelCandidate.modelId,
              choices: Array.isArray(data.choices) && data.choices.length > 0
                ? data.choices.map((choice: any) => ({
                    index: choice.index ?? 0,
                    message: {
                      role: choice.message?.role ?? "assistant",
                      content: choice.message?.content ?? "",
                    },
                    logprobs: choice.logprobs ?? null,
                    finish_reason: choice.finish_reason ?? "stop",
                  }))
                : [],
              usage: {
                prompt_tokens: data.usage?.prompt_tokens ?? 0,
                completion_tokens: data.usage?.completion_tokens ?? 0,
                total_tokens: data.usage?.total_tokens ?? 0,
              },
            };

            keyState.lastCheckedAt = new Date().toISOString();
            keyState.lastSuccessAt = keyState.lastCheckedAt;
            keyState.rateLimited = false;
            modelCandidate.lastCheckedAt = new Date().toISOString();
            modelCandidate.lastSuccessAt = modelCandidate.lastCheckedAt;
            modelCandidate.rateLimited = false;

            return result;
          }

          if (status === 401 || status === 403) {
            keyState.available = false;
            keyState.lastCheckedAt = new Date().toISOString();
            continue;
          }

          if (status === 429 || isGlobalRateLimitStatus(status)) {
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

            lastError = new Error(`Kilo request failed with status ${status}`);
            continue;
          }

          lastError = new Error(`Kilo request failed with status ${status}`);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          keyState.available = false;
          keyState.lastCheckedAt = new Date().toISOString();
        }

        // If the abort signal has been fired, stop retrying
        if (abortSignal && abortSignal.aborted) {
          throw new Error("Kilo inference aborted");
        }
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
