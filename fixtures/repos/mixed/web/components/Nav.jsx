const LINKS = [
  { id: "books", href: "/", label: "本" },
  { id: "stats", href: "/stats", label: "集計" },
];

export default function Nav({ active }) {
  return (
    <nav>
      {LINKS.map((link) => (
        <a key={link.id} href={link.href} aria-current={link.id === active ? "page" : undefined}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}
