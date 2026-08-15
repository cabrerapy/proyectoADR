import type { Metadata } from "next";

import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { robots: { follow: false, index: false }, title: "Configuración" };
export default function SettingsPage() { return <main className="mx-auto min-h-[70vh] w-full max-w-3xl px-4 py-10 sm:px-6" id="main-content" tabIndex={-1}><SettingsClient /></main>; }
