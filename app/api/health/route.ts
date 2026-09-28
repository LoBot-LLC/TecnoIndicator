import { handleHealth } from "../../../lib/api/handlers/health";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  return handleHealth(request);
}
