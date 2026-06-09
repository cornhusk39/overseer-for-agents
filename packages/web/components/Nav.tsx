"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Top navigation. A client component only because it highlights the active
// route from the current path; the data pages it links to stay server-rendered.
const LINKS = [
  { href: "/", label: "Agents" },
  { href: "/runs", label: "Runs" },
  { href: "/trends", label: "Trends" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} className={active ? "active" : ""}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
