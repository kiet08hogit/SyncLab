import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import { AppSidebar } from "@/components/app-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: { default: "SyncLab", template: "%s · SyncLab" },
  description: "Dependency migrations opened as pull requests, tracked end to end.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="flex min-h-dvh flex-col md:h-dvh md:flex-row">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <TooltipProvider>
          <AppSidebar />
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none md:overflow-y-auto">
            {children}
          </main>
        </TooltipProvider>
      </body>
    </html>
  );
}
