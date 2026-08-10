import type { Metadata } from "next";

import { AdminPaymentsClient } from "./payments-client";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Registrar pagos",
};

export default function AdminPaymentsPage() {
  return <main id="main-content" tabIndex={-1} className="mx-auto min-h-[70vh] w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8"><AdminPaymentsClient /></main>;
}
