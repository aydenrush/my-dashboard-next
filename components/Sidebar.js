"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const sections = [
  ["Today", [["/", "Home"], ["/weather", "Weather"]]],
  ["Training", [["/running", "Running"]]],
  ["School", [["/grades", "Grades"]]],
  ["Notes", [["/brain-dump", "Brain Dump"],["/books", "Books"], ["/lyric-lab", "Lyric Lab"]]],
  ["Life", [["/wardrobe", "Wardrobe"]]],
  ["Games", [["/pokemon-go", "Pokémon GO"], ["/madden", "Madden Franchise"], ["/cfb-dynasty", "CFB Dynasty"], ["/minecraft", "Minecraft"]]],
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
        {sections.map(([title, links]) => (
          <div key={title}>
            <h3 className="sidebar-section">{title}</h3>
            <ul className="sidebar-nav">
              {links.map(([href, label]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className={`sidebar-link ${pathname === href ? "active" : ""}`}
                    onClick={() => setOpen(false)}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
