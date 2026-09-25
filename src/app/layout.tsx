import type { Metadata, Viewport } from "next";
import { Archivo, Schibsted_Grotesk, JetBrains_Mono } from "next/font/google";
import SongDock from "@/components/SongDock";
import "./globals.css";

const sans = Schibsted_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin", "latin-ext"],
});

// poster type: Archivo's condensed widths (wdth 62–125) for the big display lines
const display = Archivo({
  variable: "--font-archivo",
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
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
    <html lang="tr" className={`${sans.variable} ${display.variable} ${mono.variable} antialiased`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        <SongDock />
      </body>
    </html>
  );
}
