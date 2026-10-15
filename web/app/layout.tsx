import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Lora } from "next/font/google";
import { ThemeProvider } from "next-themes";

import { AppSidebar } from "@/components/app-sidebar";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

const lora = Lora({ variable: "--font-lora", subsets: ["latin"], weight: ["400", "500"] });

const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "SyncLab", template: "%s · SyncLab" },
  description: "Dependency migrations opened as pull requests, tracked end to end.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // next-themes sets the theme class before hydration, so the server markup cannot match it.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${lora.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col md:h-dvh md:flex-row">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
          >
            Skip to content
          </a>
          <AppSidebar />
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none md:overflow-y-auto">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
