import { handleSolutions } from "../../../lib/api/handlers/solutions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  return handleSolutions(request);
}
