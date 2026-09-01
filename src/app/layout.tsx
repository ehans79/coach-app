import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Coach App",
  description: "Eduardo's personal training dashboard",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen font-sans lg:flex lg:h-full">
        <Nav />
        <main className="min-w-0 bg-page px-4 pt-6 pb-24 sm:px-6 lg:flex-1 lg:overflow-y-auto lg:px-8 lg:py-8 lg:pb-8">
          {children}
        </main>
      </body>
    </html>
  );
}
