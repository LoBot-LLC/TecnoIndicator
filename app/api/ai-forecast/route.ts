import { handleAiForecast } from "../../../lib/api/handlers/ai-forecast";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  return handleAiForecast(request);
}
