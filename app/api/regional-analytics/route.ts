import { handleRegionalAnalytics } from "../../../lib/api/handlers/regional-analytics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  return handleRegionalAnalytics(request);
}
