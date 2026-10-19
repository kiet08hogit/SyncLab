import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";

import "./globals.css";

// Vendored in ../fonts. next/font/google fails the build when Google Fonts returns
// an extensionless /l/font?kit= URL, which Next 16.4 cannot parse.
const geist = localFont({
  src: "../fonts/geist-latin.woff2",
  variable: "--font-geist",
  weight: "100 900",
});

const lora = localFont({
  src: [
    { path: "../fonts/lora-latin-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/lora-latin-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-lora",
  adjustFontFallback: "Times New Roman",
});

const jetbrains = localFont({
  src: [
    { path: "../fonts/jetbrains-mono-latin-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/jetbrains-mono-latin-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-jetbrains",
});

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
      <body className="min-h-dvh">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
          >
            Skip to content
          </a>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
