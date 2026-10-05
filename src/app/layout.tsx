import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getLocale } from "@/i18n/server";
import { I18nProvider } from "@/i18n/client";

export const metadata: Metadata = {
  title: { default: "HotelCost", template: "%s · HotelCost" },
  description: "Otel maliyet kontrol platformu",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#158459" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-screen font-sans"><I18nProvider locale={locale}>{children}</I18nProvider></body>
    </html>
  );
}
