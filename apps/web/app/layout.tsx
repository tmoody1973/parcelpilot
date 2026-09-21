import type { ReactNode } from "react";

export const metadata = {
  title: "ParcelPilot",
  description: "Preliminary zoning screen for Milwaukee infill parcels. Not an official zoning determination.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
