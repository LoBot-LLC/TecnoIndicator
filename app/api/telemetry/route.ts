import { track } from '@vercel/analytics/server';
import { reportValue } from 'flags';

/**
 * Server-side analytics endpoint.
 *
 * Demonstrates the Vercel Flags + Web Analytics integration pattern:
 *
 * 1. `reportValue` records the resolved feature-flag value so the flag is
 *    visible in Runtime Logs and can be attached to server-side events.
 * 2. `track` records a custom Web Analytics event and, via the `flags`
 *    option, automatically resolves the flag value from the request context
 *    and enriches the event with it.
 *
 * IMPORTANT FIX vs. the reference example: the `track` function from
 * `@vercel/analytics/server` requires session context (request headers). It
 * throws `No session context found. Pass \`request\` or \`headers\` to the
 * \`track\` function.` when none is provided. This implementation passes the
 * full `request` object so the SDK can extract the origin and headers.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Name of the sample feature flag used for this demo. */
export const ANALYTICS_FLAG = 'tecnoindicator-server-tracking';

export async function GET(request: Request): Promise<Response> {
  // Report the feature flag value for observability (Runtime Logs + Web Analytics).
  reportValue(ANALYTICS_FLAG, true);

  // Track a custom server-side event, enriched with the flag value.
  // `request` supplies the required session context (origin/headers).
  await track('telemetry_sample_event', { endpoint: '/api/telemetry' }, {
    flags: [ANALYTICS_FLAG],
    request,
  });

  return Response.json({ ok: true });
}
