import { relay } from "../../../lib/upstream";

export async function GET() {
  return relay("/api/v1/books");
}

export async function POST(request: Request) {
  return relay("/api/v1/books", { method: "POST", body: await request.text() });
}
