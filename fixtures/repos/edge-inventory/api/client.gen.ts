export interface BookDto {
  isbn: string;
  title: string;
}

export async function listBooks(base: string): Promise<BookDto[]> {
  const res = await fetch(`${base}/books`);
  return (await res.json()) as BookDto[];
}
