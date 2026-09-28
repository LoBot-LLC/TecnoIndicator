import { handlePrices } from "../../../lib/api/handlers/prices";

// Live upstream lookups: never statically rendered or cached by Next.js.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  return handlePrices(request);
}
