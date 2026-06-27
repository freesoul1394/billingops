import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Billops — Redington AWS Billing Transfer Ops",
  description: "Internal billing operations tool for Redington AWS distributor PMAs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
