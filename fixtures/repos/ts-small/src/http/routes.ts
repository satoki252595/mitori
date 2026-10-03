import { Hono } from "hono";
import { BookRepo } from "../db/repo.ts";
import type { BookStatus } from "../db/types.ts";
import { fetchMetadata } from "../services/metadata.ts";

interface CreateBody {
  isbn?: string;
  title?: string;
  status?: BookStatus;
}

/** Parse a path parameter that must be a positive integer id. */
function idParam(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Build the HTTP application on top of a repo (a fresh in-memory one by default). */
export function createApp(repo: BookRepo = new BookRepo()): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok"));

  app.get("/api/books", (c) => c.json(repo.list()));

  app.get("/api/books/:id", (c) => {
    const id = idParam(c.req.param("id"));
    const book = id === null ? undefined : repo.get(id);
    return book ? c.json(book) : c.json({ error: "book not found" }, 404);
  });

  app.post("/api/books", async (c) => {
    const body = await c.req.json<CreateBody>();
    if (!body.isbn) return c.json({ error: "isbn is required" }, 400);
    const title = body.title ?? (await fetchMetadata(body.isbn)).title;
    return c.json(repo.create({ isbn: body.isbn, title, status: body.status }), 201);
  });

  app.delete("/api/books/:id", (c) => {
    const id = idParam(c.req.param("id"));
    if (id !== null) repo.remove(id);
    return c.body(null, 204);
  });

  // TODO(old): app.get("/api/v0/books") still redirects to /api/books until the mobile client drops it

  const admin = new Hono();
  admin.post("/reindex", (c) => c.json({ queued: true }, 202));
  app.route("/admin", admin);

  return app;
}
