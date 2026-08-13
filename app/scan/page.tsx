import type { Metadata } from "next";
import { Scanner } from "@/components/scan/scanner";

export const metadata: Metadata = {
  title: "Scan",
  description: "Point your camera at a UPC, EAN, QR, or GS1 code.",
};

export default function ScanPage() {
  return <Scanner />;
}
