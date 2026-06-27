"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/accounts", label: "Accounts", icon: "🏢" },
  { href: "/relationships", label: "Relationships", icon: "🔗" },
  { href: "/invoices", label: "Invoices", icon: "📄" },
  { href: "/reconciliation", label: "Reconciliation", icon: "📊" },
  { href: "/directory", label: "Directory", icon: "📁" },
  { href: "/cur", label: "CUR Status", icon: "📦" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-16 items-center border-b border-gray-200 px-6">
        <Link href="/" className="text-xl font-bold text-indigo-600">
          Billops
        </Link>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-gray-200 p-4">
        <Link
          href="/api/auth/logout"
          className="block text-center text-sm text-gray-500 hover:text-gray-700"
        >
          Sign out
        </Link>
      </div>
    </aside>
  );
}
