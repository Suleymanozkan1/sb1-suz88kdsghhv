import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HotelCost", template: "%s · HotelCost" },
  description: "Hotel cost intelligence and cost-control platform",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#158459" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
