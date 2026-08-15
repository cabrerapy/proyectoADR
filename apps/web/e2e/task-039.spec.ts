import { expect, test } from "@playwright/test";

const available = {
  capacity: 12, classDate: "2099-08-20", classTypeName: "Cross training",
  confirmedCount: 7, endsAt: "2099-08-20T23:00:00.000Z", id: "class-available",
  startsAt: "2099-08-20T22:00:00.000Z", status: "SCHEDULED", trainerName: "Entrenadora Ana",
} as const;
const upcoming = {
  classId: "class-upcoming", createdAt: "2026-08-10T12:00:00.000Z", id: "reservation-upcoming",
  session: { ...available, id: "class-upcoming" }, startsAt: available.startsAt,
  status: "CONFIRMED", updatedAt: "2026-08-10T12:00:00.000Z", version: 1,
} as const;
const history = {
  classId: "class-history", createdAt: "2020-08-10T12:00:00.000Z", id: "reservation-history",
  startsAt: "2020-08-20T22:00:00.000Z", status: "CANCELLED",
  updatedAt: "2020-08-11T12:00:00.000Z", version: 2,
} as const;

interface ScheduleReservation {
  readonly classId: string;
  readonly createdAt: string;
  readonly id: string;
  readonly session?: Omit<typeof available, "id"> & { readonly id: string };
  readonly startsAt: string;
  readonly status: "ADMIN_CANCELLED" | "CANCELLED" | "CONFIRMED";
  readonly updatedAt: string;
  readonly version: number;
}

test("shows own classes and completes reserve/cancel flows on mobile", async ({ page }) => {
  const methods: string[] = [];
  let reservations: ScheduleReservation[] = [upcoming, history];
  await page.route("**/api/v1/me/classes**", (route) => {
    expect(new URL(route.request().url()).searchParams.has("userId")).toBe(false);
    return route.fulfill({ contentType: "application/json", json: { available: [available], reservations } });
  });
  await page.route("**/api/v1/class-sessions/*/reservations", async (route) => {
    methods.push(route.request().method());
    const classId = new URL(route.request().url()).pathname.split("/").at(-2);
    if (route.request().method() === "POST") {
      reservations = [...reservations, { ...upcoming, classId: classId ?? "", id: "reservation-new", session: available }];
    } else {
      reservations = reservations.map((item) => item.classId === classId ? { ...item, status: "CANCELLED" as const } : item);
    }
    await route.fulfill({ contentType: "application/json", json: { disposition: "CREATED" } });
  });

  await page.goto("/me/classes");
  await expect(page.getByRole("heading", { name: "Mis clases" })).toBeVisible();
  await expect(page.getByText("5 cupos disponibles")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mis próximas reservas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Historial de reservas" })).toBeVisible();
  await page.getByRole("button", { name: "Reservar" }).click();
  await expect(page.getByText("Reserva confirmada.")).toBeVisible();
  await page.getByRole("button", { name: "Cancelar reserva" }).first().click();
  await expect(page.getByText("Reserva cancelada.")).toBeVisible();
  expect(methods).toEqual(["POST", "DELETE"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("renders empty states and denies an unauthenticated schedule request", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/v1/me/classes**", (route) => route.fulfill({ contentType: "application/json", json: { available: [], reservations: [] } }));
  await page.goto("/me/classes");
  await expect(page.getByText("No hay clases con cupos en los próximos 15 días.")).toBeVisible();
  await expect(page.getByText("No tienes reservas futuras.")).toBeVisible();
  await expect(page.getByText("Todavía no tienes reservas anteriores.")).toBeVisible();
  const response = await request.get("/api/v1/me/classes?from=2026-08-14&to=2026-08-28");
  expect(response.status()).toBe(401);
});
