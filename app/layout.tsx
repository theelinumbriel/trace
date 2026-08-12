import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/shell/site-header";
import { SiteFooter } from "@/components/shell/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Trace — Where did this come from?",
    template: "%s · Trace",
  },
  description:
    "Scan almost any product to trace the people, places, materials, and movements behind it. Every step sourced or honestly marked unknown.",
  applicationName: "Trace",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Trace",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAF9F6",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
