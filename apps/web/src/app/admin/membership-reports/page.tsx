import type { Metadata } from "next";

import { MembershipReportsClient } from "./reports-client";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Reportes de membresías",
};

export default function MembershipReportsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto min-h-[70vh] w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <MembershipReportsClient />
    </main>
  );
}
