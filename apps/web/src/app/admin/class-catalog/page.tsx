import type { Metadata } from "next";
import { AdminClassCatalogClient } from "./class-catalog-client";

export const metadata: Metadata = { robots: { follow: false, index: false }, title: "Entrenadores y tipos de clase" };
export default function AdminClassCatalogPage() {
  return <main className="mx-auto min-h-[70vh] w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8" id="main-content" tabIndex={-1}><AdminClassCatalogClient /></main>;
}
