import { handleForecast } from "../../../lib/api/handlers/forecast";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(request: Request): Promise<Response> { return handleForecast(request); }
export async function OPTIONS(request: Request): Promise<Response> { return handleForecast(request); }
export async function POST(request: Request): Promise<Response> { return handleForecast(request); }
export async function PUT(request: Request): Promise<Response> { return handleForecast(request); }
export async function PATCH(request: Request): Promise<Response> { return handleForecast(request); }
export async function DELETE(request: Request): Promise<Response> { return handleForecast(request); }
