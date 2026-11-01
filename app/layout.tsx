import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import "./translate.css";
import DepositSync from "@/app/components/DepositSync";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata: Metadata = {
  title: "Evergreen Econ",
  description: "Evergreen alliance economic department: bank, warchest and requests.",
};

export const viewport: Viewport = { themeColor: "#06120d" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={outfit.variable}>
      <body className="antialiased">{children}<DepositSync /></body>
    </html>
  );
}
