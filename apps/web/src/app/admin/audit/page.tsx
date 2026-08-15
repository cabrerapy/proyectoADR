import type { Metadata } from "next";
import { AuditClient } from "./audit-client";

export const metadata: Metadata = { robots: { follow: false, index: false }, title: "Auditoría" };
export default function AuditPage() { return <main className="mx-auto min-h-[70vh] w-full max-w-5xl px-4 py-10 sm:px-6" id="main-content" tabIndex={-1}><AuditClient /></main>; }
