import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Overseer for Agents",
  description: "Self-hosted observability for production LLM agents.",
};

// Root layout. The dashboard chrome (navigation, time-range controls) is built
// out in M5; this is the minimal shell that makes the app a valid Next.js App
// Router project from the bootstrap onward.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
