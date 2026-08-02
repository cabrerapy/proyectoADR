import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Gym ADR",
  description: "Plataforma del gimnasio Gym ADR",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
