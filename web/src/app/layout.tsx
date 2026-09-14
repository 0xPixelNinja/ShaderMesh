import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { WalletProvider } from "@/components/WalletProvider";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "ShaderMesh",
  description: "Rent GPU compute from a decentralized mesh.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <WalletProvider>
          <Shell>{children}</Shell>
        </WalletProvider>
      </body>
    </html>
  );
}
