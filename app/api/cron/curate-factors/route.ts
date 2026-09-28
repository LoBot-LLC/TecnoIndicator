import { handleCurateFactorsCron } from "../../../../lib/api/handlers/cron-curate-factors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Invoked by the Vercel cron configured in vercel.json. */
export async function GET(request: Request): Promise<Response> {
  return handleCurateFactorsCron(request);
}
