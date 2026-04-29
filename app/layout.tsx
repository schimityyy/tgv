import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TGVMax Finder",
  description: "Find currently available MAX JEUNE and MAX SENIOR train seats from a French origin station."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
