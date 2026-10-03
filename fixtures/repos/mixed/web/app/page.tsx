import Nav from "../components/Nav";

export default function Home() {
  return (
    <main>
      <Nav active="books" />
      <h1>積読</h1>
      <p>買ったけれどまだ読んでいない本の一覧。</p>
    </main>
  );
}
