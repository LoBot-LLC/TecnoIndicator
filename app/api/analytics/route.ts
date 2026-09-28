import { handleAnalytics } from "../../../lib/api/handlers/analytics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  return handleAnalytics(request);
}
