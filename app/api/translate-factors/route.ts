import { handleTranslateFactors } from "../../../lib/api/handlers/translate-factors";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleTranslateFactors(request);
}
