import type { Metadata } from "next";
import { AdminGalleryClient } from "./gallery-client";

export const metadata: Metadata = { robots: { follow: false, index: false }, title: "Galería administrativa" };
export default function AdminGalleryPage() { return <main className="mx-auto min-h-[70vh] w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8" id="main-content" tabIndex={-1}><AdminGalleryClient /></main>; }
