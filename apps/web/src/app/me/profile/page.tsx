import type { Metadata } from "next";

import { ProfileClient } from "./profile-client";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Mi perfil",
};

export default function ProfilePage() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto min-h-[70vh] w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <ProfileClient />
    </main>
  );
}
