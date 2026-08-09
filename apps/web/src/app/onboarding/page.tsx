import type { Metadata } from "next";

import { OnboardingClient } from "./onboarding-client";

export const metadata: Metadata = { title: "Completar perfil | Gym ADR" };

export default function OnboardingPage() {
  return (
    <main className="mx-auto min-h-[70vh] w-full max-w-2xl px-4 py-10 sm:px-6">
      <OnboardingClient />
    </main>
  );
}
