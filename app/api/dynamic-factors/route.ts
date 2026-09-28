import { handleDynamicFactors } from "../../../lib/api/handlers/dynamic-factors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  return handleDynamicFactors(request);
}
