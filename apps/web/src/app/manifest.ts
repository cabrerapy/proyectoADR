import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#f7f5ef",
    description: "Plataforma web de Gym ADR en Limpio, Paraguay.",
    display: "standalone",
    lang: "es-PY",
    name: "Gym ADR",
    short_name: "Gym ADR",
    start_url: "/",
    theme_color: "#12372a",
  };
}
