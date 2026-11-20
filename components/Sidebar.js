"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

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
  { href: "/grades", label: "Grades" },
  { href: "/weather", label: "Weather" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="hamburger" onClick={() => setOpen(true)} style={{ position: "fixed", top: 12, left: 12, zIndex: 98 }}>
        &#9776;
      </button>
      <div className={`sidebar-overlay${open ? " open" : ""}`} onClick={() => setOpen(false)} />
      <nav className={`sidebar${open ? " open" : ""}`}>
        <h2 className="sidebar-title">Dashboard</h2>
        <ul className="sidebar-nav">
          {pages.map((p) => (
            <li key={p.href}>
              <Link
                href={p.href}
                className={`sidebar-link ${pathname === p.href ? "active" : ""}`}
                onClick={() => setOpen(false)}
              >
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
