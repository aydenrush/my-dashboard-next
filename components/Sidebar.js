"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const pages = [
  { href: "/", label: "Home" },
  { href: "/cfb-dynasty", label: "CFB Dynasty" },
  { href: "/madden", label: "Madden Franchise" },
  { href: "/lyric-lab", label: "Lyric Lab" },
  { href: "/running", label: "Running" },
  { href: "/books", label: "Books" },
  { href: "/wardrobe", label: "Wardrobe" },
  { href: "/minecraft", label: "Minecraft" },
  { href: "/todo", label: "To Do" },
  { href: "/weather", label: "Weather" },
  { href: "/ebay", label: "eBay" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="sidebar">
      <h2 className="sidebar-title">Dashboard</h2>
      <ul className="sidebar-nav">
        {pages.map((p) => (
          <li key={p.href}>
            <Link
              href={p.href}
              className={`sidebar-link ${pathname === p.href ? "active" : ""}`}
            >
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
