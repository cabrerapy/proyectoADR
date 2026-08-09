import type { Metadata } from "next";

import { AdminStudentsClient } from "./students-client";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Administrar alumnos",
};

export default function AdminStudentsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto min-h-[70vh] w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <AdminStudentsClient />
    </main>
  );
}
