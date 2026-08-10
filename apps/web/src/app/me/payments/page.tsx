import type { Metadata } from "next";

import { OwnPaymentsClient } from "./payments-client";

export const metadata: Metadata = { robots: { follow: false, index: false }, title: "Mis pagos" };
export default function OwnPaymentsPage() {
  return <main id="main-content" tabIndex={-1} className="mx-auto min-h-[70vh] w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8"><OwnPaymentsClient /></main>;
}
