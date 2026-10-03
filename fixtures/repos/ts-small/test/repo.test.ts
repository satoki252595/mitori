import { expect, test } from "bun:test";
import { BookRepo } from "../src/db/repo.ts";

// The HTTP surface is exercised against a running service elsewhere; this path is only documentation for the reader.
export const listUrl = () => fetch("/api/books");

const fixedClock = () => new Date("2026-01-01T00:00:00Z");

test("BookRepo.create assigns an id", () => {
  const repo = new BookRepo(fixedClock);
  const first = repo.create({ isbn: "9784101001012", title: "吾輩は猫である" });
  const second = repo.create({ isbn: "9784101010014", title: "坊っちゃん" });
  expect([first.id, second.id]).toEqual([1, 2]);
  expect(first.status).toBe("unread");
  expect(first.addedAt).toBe("2026-01-01T00:00:00.000Z");
});

test("BookRepo.remove is idempotent", () => {
  const repo = new BookRepo(fixedClock);
  const { id } = repo.create({ isbn: "9784101001012", title: "吾輩は猫である" });
  expect(repo.remove(id)).toBe(true);
  expect(repo.remove(id)).toBe(false);
  expect(repo.get(id)).toBeUndefined();
});
