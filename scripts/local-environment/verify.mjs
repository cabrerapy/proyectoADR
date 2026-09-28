import {
  prepareLocalEnvironment,
  shutdownLocalEnvironment,
} from "./runtime.mjs";

const results = [];
const record = (role, flow, expected, obtained, passed) => {
  results.push({ expected, flow, obtained, passed, role });
  if (!passed) throw new Error(`${role}/${flow}: esperado ${expected}; obtenido ${obtained}`);
};

const cookieFor = async (url, profile) => {
  const response = await fetch(`${url}/api/auth/local-login?profile=${profile}`, { redirect: "manual" });
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (response.status !== 303 || cookie === undefined) {
    throw new Error(`No se pudo iniciar la sesión local ${profile}.`);
  }
  return cookie;
};

const request = (url, path, cookie, init = {}) => fetch(`${url}${path}`, {
  ...init,
  headers: {
    ...(cookie === undefined ? {} : { cookie }),
    ...(init.headers ?? {}),
  },
  redirect: "manual",
});

const { fixtures, web } = await prepareLocalEnvironment({ port: 3102, reset: true });
try {
  let response = await request(web.url, "/", undefined);
  record("VISITOR", "sitio público", "HTTP 200", `HTTP ${response.status}`, response.status === 200);
  response = await request(web.url, "/gimnasio", undefined);
  record("VISITOR", "navegación pública", "HTTP 200", `HTTP ${response.status}`, response.status === 200);
  response = await request(web.url, "/api/v1/me/profile", undefined);
  record("VISITOR", "portal privado bloqueado", "HTTP 401", `HTTP ${response.status}`, response.status === 401);

  const studentCookie = await cookieFor(web.url, "student");
  response = await request(web.url, "/api/v1/me/profile", studentCookie);
  record("STUDENT", "perfil", "HTTP 200", `HTTP ${response.status}`, response.status === 200);
  response = await request(web.url, "/api/v1/me/membership", studentCookie);
  record("STUDENT", "membresía", "HTTP 200", `HTTP ${response.status}`, response.status === 200);
  response = await request(
    web.url,
    `/api/v1/me/classes?from=${fixtures.classDate}&to=${fixtures.classDate}`,
    studentCookie,
  );
  const classesDetail = response.ok ? "" : ` ${await response.clone().text()}`;
  record("STUDENT", "clases", "HTTP 200", `HTTP ${response.status}${classesDetail}`, response.status === 200);
  response = await request(
    web.url,
    `/api/v1/class-sessions/${fixtures.classId}/reservations`,
    studentCookie,
    { headers: { "idempotency-key": "local-verify-reserve", origin: web.url }, method: "POST" },
  );
  record("STUDENT", "reservar", "HTTP 201", `HTTP ${response.status}`, response.status === 201);
  response = await request(
    web.url,
    `/api/v1/class-sessions/${fixtures.classId}/reservations`,
    studentCookie,
    { headers: { "idempotency-key": "local-verify-cancel", origin: web.url }, method: "DELETE" },
  );
  record("STUDENT", "cancelar", "HTTP 200", `HTTP ${response.status}`, response.status === 200);

  const staffCookie = await cookieFor(web.url, "staff");
  response = await request(web.url, "/api/v1/admin/dashboard", staffCookie);
  record("STAFF", "panel operativo", "HTTP 200", `HTTP ${response.status}`, response.status === 200);
  response = await request(web.url, "/api/v1/admin/settings", staffCookie);
  record("STAFF", "acción exclusiva ADMIN bloqueada", "HTTP 403", `HTTP ${response.status}`, response.status === 403);

  const adminCookie = await cookieFor(web.url, "admin");
  response = await request(web.url, "/api/v1/admin/dashboard", adminCookie);
  record("ADMIN", "panel", "HTTP 200", `HTTP ${response.status}`, response.status === 200);
  response = await request(web.url, "/api/v1/admin/students?filter=pending", adminCookie);
  record("ADMIN", "gestión de alumnos", "HTTP 200", `HTTP ${response.status}`, response.status === 200);
  response = await request(web.url, "/api/v1/admin/settings", adminCookie);
  record("ADMIN", "configuración", "HTTP 200", `HTTP ${response.status}`, response.status === 200);

  const suspendedCookie = await cookieFor(web.url, "suspended");
  response = await request(
    web.url,
    `/api/v1/class-sessions/${fixtures.classId}/reservations`,
    suspendedCookie,
    { headers: { "idempotency-key": "local-verify-suspended", origin: web.url }, method: "POST" },
  );
  record("STUDENT", "suspendido no reserva", "HTTP 403", `HTTP ${response.status}`, response.status === 403);

  console.table(results);
  console.log("Matriz local VISITOR/STUDENT/STAFF/ADMIN: completada.");
} finally {
  await shutdownLocalEnvironment(web);
}
