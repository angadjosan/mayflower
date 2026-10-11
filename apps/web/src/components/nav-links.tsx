"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/chat", label: "Chat" },
  { href: "/profile", label: "Profile" },
  { href: "/activity", label: "Activity" },
  { href: "/status", label: "Status" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn("rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text", path.startsWith(l.href) && "bg-surface-2 text-text")}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
