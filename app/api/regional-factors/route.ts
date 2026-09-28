import { handleRegionalFactors } from "../../../lib/api/handlers/regional-factors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  return handleRegionalFactors(request);
}
