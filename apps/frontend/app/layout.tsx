import type { Metadata } from "next";
import "./globals.css";
import { Appbar } from "@/components/Appbar";

export const metadata: Metadata = {
  title: "DPIN Uptime",
  description: "Distributed uptime monitoring control plane",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <Appbar />
        {children}
      </body>
    </html>
  );
}
