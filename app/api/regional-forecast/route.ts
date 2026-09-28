import { handleRegionalForecast } from "../../../lib/api/handlers/regional-forecast";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  return handleRegionalForecast(request);
}
