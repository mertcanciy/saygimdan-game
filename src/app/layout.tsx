import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk, JetBrains_Mono } from "next/font/google";
import SongDock from "@/components/SongDock";
import "./globals.css";

const sans = Schibsted_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin", "latin-ext"],
});

const mono = JetBrains_Mono({
  variable: "--font-jb-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["500"],
});

export const metadata: Metadata = {
  title: "Saygımdan",
  description: "Bengü'nün Saygımdan'ı çalarken şehirde ağ at, drift yap, F-16 ile gökdelenlerin arasından geç.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={`${sans.variable} ${mono.variable} antialiased`}>
      <body>
        {children}
        <SongDock />
      </body>
    </html>
  );
}
