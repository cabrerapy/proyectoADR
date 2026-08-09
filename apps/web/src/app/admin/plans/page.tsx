import type { Metadata } from "next";

import { AdminPlansClient } from "./plans-client";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Administrar planes",
};

export default function AdminPlansPage() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto min-h-[70vh] w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <AdminPlansClient />
    </main>
  );
}
