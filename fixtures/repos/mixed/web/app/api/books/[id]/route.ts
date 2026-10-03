import { relay } from "../../../../lib/upstream";

type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  return relay(`/api/v1/books/${encodeURIComponent(params.id)}`);
}

export async function DELETE(_request: Request, { params }: Params) {
  return relay(`/api/v1/books/${encodeURIComponent(params.id)}`, { method: "DELETE" });
}
