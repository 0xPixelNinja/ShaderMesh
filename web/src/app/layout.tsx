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
      <body>
        <WalletProvider>
          <Shell>{children}</Shell>
        </WalletProvider>
      </body>
    </html>
  );
}
