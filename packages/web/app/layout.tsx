import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "../components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Overseer for Agents",
  description: "Self-hosted observability for production LLM agents.",
};

// Root layout: the top bar with navigation wraps every page, and pages render
// their own container.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app">
          <header className="topbar">
            <div className="topbar-inner">
              <div className="brand">
                <span className="brand-dot" />
                Overseer
              </div>
              <Nav />
            </div>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
