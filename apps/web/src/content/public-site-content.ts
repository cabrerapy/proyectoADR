export type PublicNavigationItem = Readonly<{
  href: `/${string}`;
  label: string;
}>;

export type PublicPlan = Readonly<{
  description: string;
  frequency: string;
  name: string;
  priceLabel: string;
}>;

export type PublicSchedule = Readonly<{
  days: string;
  hours: string;
  name: string;
}>;

export type PublicTrainer = Readonly<{
  name: string;
  specialty: string;
}>;

export type PublicSiteContent = Readonly<{
  address: string;
  city: string;
  equipment: readonly string[];
  facilities: readonly string[];
  facebookUrl: string | undefined;
  instagramUrl: string | undefined;
  mapUrl: string;
  navigation: readonly PublicNavigationItem[];
  plans: readonly PublicPlan[];
  schedules: readonly PublicSchedule[];
  siteUrl: string;
  trainers: readonly PublicTrainer[];
  whatsappUrl: string | undefined;
}>;

type PublicSiteEnvironment = Readonly<Record<string, string | undefined>>;

const navigation: readonly PublicNavigationItem[] = [
  { href: "/gimnasio", label: "El gimnasio" },
  { href: "/planes", label: "Planes" },
  { href: "/horarios", label: "Horarios" },
  { href: "/galeria", label: "Galería" },
  { href: "/contacto", label: "Contacto" },
];

const optionalHttpsUrl = (
  value: string | undefined,
  allowedHosts: readonly string[],
): string | undefined => {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !allowedHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

const whatsappUrl = (value: string | undefined): string | undefined => {
  if (!value || !/^\+595\d{9}$/u.test(value)) return undefined;

  return `https://wa.me/${value.slice(1)}?text=${encodeURIComponent(
    "Hola, quisiera recibir información sobre Gym ADR.",
  )}`;
};

const publicSiteUrl = (value: string | undefined): string => {
  const fallback = "http://localhost:3000";
  if (!value) return fallback;

  try {
    const url = new URL(value);
    const isLocalHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (
      (url.protocol !== "https:" && !isLocalHttp) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return fallback;
    }
    return url.origin;
  } catch {
    return fallback;
  }
};

export const getPublicSiteContent = (
  environment: PublicSiteEnvironment = process.env,
): PublicSiteContent => ({
  address: "Limpio, Departamento Central",
  city: "Limpio, Paraguay",
  equipment: [
    "Barras, discos y racks para fuerza",
    "Kettlebells, mancuernas y cajones",
    "Equipos para acondicionamiento y movilidad",
  ],
  facilities: [
    "Área funcional para clases grupales",
    "Espacio de fuerza y levantamiento",
    "Zona de movilidad y recuperación",
  ],
  facebookUrl: optionalHttpsUrl(environment.NEXT_PUBLIC_GYM_FACEBOOK_URL, [
    "facebook.com",
  ]),
  instagramUrl: optionalHttpsUrl(environment.NEXT_PUBLIC_GYM_INSTAGRAM_URL, [
    "instagram.com",
  ]),
  mapUrl:
    "https://www.google.com/maps/search/?api=1&query=cross%20training%20Limpio%20Paraguay",
  navigation,
  plans: [
    {
      description: "Entrenamiento guiado para construir constancia y técnica.",
      frequency: "Frecuencia a confirmar",
      name: "Plan de iniciación",
      priceLabel: "Consultar",
    },
    {
      description: "Clases de cross training adaptadas a tu nivel.",
      frequency: "Frecuencia a confirmar",
      name: "Plan regular",
      priceLabel: "Consultar",
    },
    {
      description: "Una alternativa para entrenar con mayor frecuencia.",
      frequency: "Frecuencia a confirmar",
      name: "Plan intensivo",
      priceLabel: "Consultar",
    },
  ],
  schedules: [
    { days: "Lunes a viernes", hours: "Horarios a confirmar", name: "Turnos regulares" },
    { days: "Sábados", hours: "Horarios a confirmar", name: "Entrenamiento de fin de semana" },
  ],
  siteUrl: publicSiteUrl(environment.NEXT_PUBLIC_GYM_SITE_URL),
  trainers: [
    { name: "Equipo Gym ADR", specialty: "Cross training y acondicionamiento" },
  ],
  whatsappUrl: whatsappUrl(environment.NEXT_PUBLIC_GYM_WHATSAPP_NUMBER),
});
