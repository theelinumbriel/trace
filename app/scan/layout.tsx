import type { Viewport } from "next";

/** The camera view is black — match the browser chrome to it. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function ScanLayout({ children }: LayoutProps<"/scan">) {
  return children;
}
