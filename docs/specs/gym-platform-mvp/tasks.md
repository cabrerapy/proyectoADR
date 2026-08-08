# Plan incremental — Gym Platform MVP

- Estado: Borrador para revisión
- Regla: implementar una tarea por vez y actualizar este archivo al completarla.
- Persistencia: DynamoDB On-Demand como única base principal, con AWS SDK v3 y repositorios propios.

Cada tarea indica objetivo, dependencias, módulos esperados, finalización/pruebas y requisitos relacionados.

## Evidencia de ejecución

| Tarea | Estado | Fecha | Evidencia |
|---|---|---|---|
| TASK-001 | COMPLETADA | 2026-08-02 | `npm ci --offline` instaló 357 paquetes desde `package-lock.json` y auditó 359 sin vulnerabilidades; `npm run check` validó formato (26 archivos), secretos (26 archivos), lint, typecheck y pruebas disponibles; `npm run build` compiló Next.js correctamente. |
| TASK-002 | COMPLETADA | 2026-08-02 | `npm ci --offline` instaló 362 paquetes y auditó 369 sin vulnerabilidades; `npm run check` validó formato/secretos (42 archivos), límites sin ciclos (5 workspaces), lint, typecheck estricto de web y cinco paquetes, y pruebas disponibles; `npm run build` compiló correctamente. |
| TASK-003 | COMPLETADA | 2026-08-02 | La prueba específica validó App Router, Next.js 16.2.12, Tailwind CSS y herencia de TypeScript estricto; `npm run check` pasó formato/secretos (43 archivos), límites, lint, typecheck y 1 prueba; `npm run build` compiló; verificación local a 360 px confirmó cero desbordamiento horizontal y cero errores de consola. |
| TASK-004 | COMPLETADA | 2026-08-02 | Layout, navegación y tokens accesibles implementados; Vitest aprobó 2 pruebas y Playwright aprobó 1 smoke sobre build a 360 px, verificando landmarks, salto al contenido por teclado, contraste ≥ 4,5:1 y ausencia de desbordamiento horizontal; `npm run check`, build y cierre limpio del servidor E2E pasaron. |
| TASK-005 | COMPLETADA | 2026-08-04 | BFF base implementado con errores sanitizados, `correlationId` UUID, respuestas `no-store`, validación JSON y límite de 16 KiB; Vitest aprobó 11 pruebas de contratos y entradas inválidas; Playwright aprobó 2 smoke sobre build, incluido `/api/v1/health`; `npm run check` y build pasaron. |
| TASK-006 | COMPLETADA | 2026-08-04 | CDK inicializado con ambiente tipado y obligatorio para `local`, `development` y `production`, stacks separados y protección de terminación en production; 12 pruebas, `npm run check`, build de infraestructura/web y synth de local/development sin credenciales pasaron; la CLI rechazó contexto de ambiente ausente y no se desplegó ni creó ningún recurso del proyecto. |
| TASK-007 | COMPLETADA | 2026-08-04 | Foundation CDK por ambiente con clave KMS rotada, logs cifrados y retenidos 30/90 días, tags obligatorios, presupuesto mensual USD 5/25/100 con alertas SNS cifradas y rol Lambda limitado al LogGroup exacto; 19 assertions, `npm run check`, builds y synth local/development pasaron. Costo revisado: una CMK por ambiente es el costo fijo principal; Budgets/SNS y logs son variables. No hubo deploy. |
| TASK-008 | COMPLETADA | 2026-08-04 | Next.js 16.2.12 y OpenNext 4.0.2 fijados; un wrapper probado confina esbuild a la raíz del repositorio en Windows, genera el bundle real con webpack y verifica Sharp Linux ARM64v8 para la Lambda ARM64. `npm run build:serverless`, formato, lint, typecheck, 39 pruebas, builds y `cdk synth` local/development con artefactos reales pasaron. El template mantiene S3 privado SSE-S3, CloudFront OAC, URLs Lambda con IAM, roles mínimos y cero DynamoDB. No hubo deploy. |
| TASK-009 | COMPLETADA | 2026-08-05 | DynamoDB Local 2.6.1 se ejecuta aislado mediante Docker Compose, con puerto limitado a `127.0.0.1`, raíz de solo lectura, `/tmp` efímero habilitado únicamente para cargar SQLite, `no-new-privileges` y capacidades eliminadas. `npm.cmd run dynamodb:local:test` creó el contenedor, esperó readiness, creó una tabla efímera On-Demand, ejecutó `TransactWriteItems`, verificó dos elementos con lecturas fuertes y eliminó tabla, contenedor y red; terminó con `DynamoDB Local: test completado.` Cinco pruebas del tooling, formato y lint pasan; las validaciones previas de typecheck, build, 39 pruebas unitarias/integración, 2 E2E y synth local/development permanecen vigentes. No hubo conexión ni despliegue AWS. |
| TASK-010 | COMPLETADA | 2026-08-05 | Catálogo tipado de 19 tipos de elemento, codecs reversibles de PK/SK, claves de GSI1/GSI2, cuatro shards determinísticos y tokens HMAC versionados implementados en `packages/data-access`. Seis pruebas verifican round-trip y snapshot de todos los tipos, lookup de nombre shardeado, claves de índices, estabilidad de shards, rechazo de PII/delimitadores y claves malformadas. Formato, secretos, límites, lint, typecheck global, 45 pruebas y build Next.js pasan. Vitest 4.1.10 ya existente se declaró en el workspace; no hubo llamadas DynamoDB, `Scan`, infraestructura ni despliegue. |
| TASK-011 | COMPLETADA | 2026-08-05 | CDK sintetiza exactamente una tabla única por ambiente con PK/SK string, `GSI1-Operational` y `GSI2-Relationships` sparse `KEYS_ONLY`, facturación `PAY_PER_REQUEST`, cifrado mediante la CMK del ambiente y tags de costo. Production activa PITR, deletion protection y `RETAIN`; local/development mantienen PITR desactivado y `DESTROY`. Seis assertions específicas, formato, secretos, límites, lint, typecheck, 51 pruebas, build web y `cdk synth` de local/development/production pasan. No se agregaron permisos DynamoDB, credenciales ni despliegues. |
| TASK-012 | COMPLETADA | 2026-08-05 | Adaptador AWS SDK v3 y repositorio base implementados con configuración `local`/`development`/`production` validada: sólo local admite endpoint HTTP loopback y credenciales ficticias; remoto usa región explícita y cadena de credenciales estándar. El puerto permite únicamente Get, Query y BatchGet, construye expresiones con nombres/valores, pagina con `LastEvaluatedKey`, limita lotes a 100, reintenta sólo `UnprocessedKeys` y emite errores tipados sanitizados. Se fijaron `@aws-sdk/client-dynamodb` y `@aws-sdk/lib-dynamodb` 3.984.0; npm auditó 612 paquetes sin vulnerabilidades. Veintisiete pruebas específicas, formato, secretos, límites, lint, typecheck, 72 pruebas de workspaces, cinco de tooling, build web y smoke efímero de DynamoDB Local pasan. No hay `Scan`, credenciales reales, cambios de infraestructura ni despliegue. |
| TASK-013 | INCOMPLETA | 2026-08-05 | La implementación funcional está terminada: hash SHA-256 canónico, `Put` condicional, replay con lectura fuerte, conflicto por carga distinta, composición atómica mediante `TransactWriteItems` y TTL sólo para retención `EPHEMERAL`. Pasan 36 pruebas unitarias de data-access, dos integraciones concurrentes reales con DynamoDB Local (un creador y 15 replays), 30 assertions CDK, cinco pruebas de tooling, 81 pruebas de workspaces, formato, secretos, límites, lint, typecheck, build web y `cdk synth` de development. El gate queda abierto porque `npm audit --audit-level=high` informa cinco vulnerabilidades altas preexistentes en dependencias transitivas (`brace-expansion`, `nanoid`, `postcss`, `sharp`). No se agregó ninguna dependencia, `Scan`, secreto, despliegue ni funcionalidad de `TASK-014`. |

## Fase 1. Fundación del repositorio

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-001 | Completar monorepo npm, Node fijado y scripts raíz. | Aprobación | raíz/config | Instalación reproducible; scripts y secret scan pasan. | REQ-SEC-003/004 |
| TASK-002 | Crear límites de paquetes. | TASK-001 | `packages/{domain,data-access,validation,shared}`, `infrastructure` | Imports por workspace, strict y anti-ciclos verificados. | REQ-SEC-001 |

## Fase 2. Aplicación Next.js

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-003 | Validar Next.js App Router, TypeScript strict y Tailwind instalados. | TASK-002 | `apps/web` | Build/lint/typecheck; página a 360 px. | REQ-PUBLIC-001 |
| TASK-004 | Crear layout, navegación, tokens y accesibilidad base. | TASK-003 | app/components/styles | Teclado, foco, contraste; Vitest/Playwright smoke. | REQ-PUBLIC-001, REQ-SEC-002 |
| TASK-005 | Establecer BFF, errores, validación y correlation IDs. | TASK-003 | server/validation | Contratos y entradas inválidas probados. | REQ-SEC-001/002 |

## Fase 3. Infraestructura base

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-006 | Inicializar CDK y configuración tipada local/dev/prod. | TASK-001 | `infrastructure` | `cdk synth` sin credenciales/despliegue; ambiente explícito. | REQ-SEC-004 |
| TASK-007 | Definir cifrado, logs, tags, budgets y roles mínimos base. | TASK-006 | stacks security/foundation | Assertions de cifrado/IAM/tags; costo revisado. | REQ-SEC-003/004 |
| TASK-008 | Sintetizar hosting Next.js serverless sin desplegar. | TASK-003, TASK-006 | web stack | Template y compatibilidad del adaptador probados. | REQ-PUBLIC-001, REQ-SEC-004 |

## Fase 4. DynamoDB y acceso a datos

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-009 | Configurar DynamoDB Local mediante Docker. | TASK-002 | compose/scripts/test setup | Arranque/readiness/limpieza reproducibles; transacción local smoke. | REQ-DATA-001/003 |
| TASK-010 | Implementar catálogo de tipos, claves, shards y codecs. | TASK-009 | `packages/data-access/model` | Round-trip y snapshots de todos los tipos; ninguna PII directa en claves. | REQ-DATA-005/006 |
| TASK-011 | Crear tabla, GSI1/GSI2 y settings On-Demand mediante CDK. | TASK-006, TASK-010 | DynamoDB stack | Assertions de PK/SK, GSIs sparse KEYS_ONLY, cifrado, separación y PITR production. | REQ-DATA-001/006, REQ-SEC-004 |
| TASK-012 | Crear adaptador AWS SDK v3 y repositorio base. | TASK-009, TASK-010 | clients/repositories | Config local/remota segura; paginación, BatchGet y errores probados. | REQ-DATA-002/007 |
| TASK-013 | Implementar primitivas persistentes de idempotencia. | TASK-012 | idempotency repository/service | Misma clave/carga devuelve resultado; carga distinta falla; TTL solo efímero. | REQ-DATA-003/004 |
| TASK-014 | Implementar perfiles, Cognito y lookups HMAC de email/nombre. | TASK-012 | user repository/search tokens | Alta/actualización transaccional, unicidad, rotación y consultas por estado/búsqueda probadas. | REQ-AUTH-002, REQ-DATA-003/005 |
| TASK-015 | Implementar repositorios de membresías y pagos con vistas. | TASK-012, TASK-013 | membership/payment repositories | Puntero/vencimiento/estado/fecha y correcciones transaccionales probados. | REQ-MEMBER-002/003, REQ-PAY-001/002, REQ-DATA-003 |
| TASK-016 | Implementar repositorios de clases y reservas. | TASK-012, TASK-013 | class/reservation repositories | Acceso por fecha/entrenador/alumno/clase y condiciones base probados. | REQ-CLASS-001/002, REQ-BOOKING-001/002 |
| TASK-017 | Implementar galería, notificación, settings y auditoría; prohibir Scan normal. | TASK-012 | repositories + command guard | Todos los patrones restantes pasan; test falla ante `ScanCommand`. | REQ-GALLERY-001/002, REQ-NOTIFY-001/002, REQ-ADMIN-002, REQ-DATA-002 |

## Fase 5. Autenticación

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-018 | Definir Cognito y proveedores sociales por ambiente. | TASK-006, TASK-014 | auth stack/config | Callbacks/atributos/IAM sintetizados; sin secretos. | REQ-AUTH-001, REQ-SEC-003/004 |
| TASK-019 | Implementar sesión/callback y alta idempotente `PENDING`. | TASK-005, TASK-018 | auth routes/service | state/nonce/PKCE/cookies y callback repetido probados. | REQ-AUTH-001/002, REQ-DATA-003/004 |
| TASK-020 | Implementar finalización de perfil y logout. | TASK-019 | onboarding/profile | Campos, ownership y expiración E2E. | REQ-AUTH-002, REQ-MEMBER-001 |

## Fase 6. Autorización

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-021 | Codificar matriz de permisos y guards deny-by-default. | TASK-014, TASK-019 | domain/authz | Matriz por rol/estado/propiedad probada. | REQ-SEC-001, REQ-AUTH-003 |
| TASK-022 | Aplicar scoping de repositorios y rate limits. | TASK-021 | repositories/rate limit | Tests IDOR, límites y no enumeración. | REQ-SEC-001/002 |

## Fase 7. Sitio público

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-023 | Construir páginas públicas y contenido configurable. | TASK-004, TASK-017 | public routes/components | Contenido/enlaces, responsive y a11y E2E. | REQ-PUBLIC-001 |
| TASK-024 | Optimizar SEO, caché, imágenes y rendimiento. | TASK-023 | metadata/cache | Objetivos NFR medidos; caché no expone privados. | REQ-PUBLIC-001, REQ-SEC-002 |

## Fase 8. Gestión de alumnos

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-025 | Crear perfil propio con lista blanca editable. | TASK-020, TASK-022 | `/me/profile` | Ownership y campos protegidos probados. | REQ-MEMBER-001, REQ-SEC-001 |
| TASK-026 | Crear búsquedas/listados y revisión de solicitudes. | TASK-021, TASK-025 | `/admin/students` | Estado/email/nombre/pending sin Scan; transiciones y permisos probados. | REQ-AUTH-003, REQ-ADMIN-001/002, REQ-DATA-002 |

## Fase 9. Planes y membresías

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-027 | CRUD lógico de planes. | TASK-015, TASK-021 | plan service/UI | Validaciones, historial y permisos probados. | REQ-MEMBER-002 |
| TASK-028 | Gestionar membresías, puntero activo y vigencia/mora. | TASK-027 | membership service/UI | Transacciones, estados y bordes timezone probados. | REQ-MEMBER-002/003, REQ-DATA-003 |
| TASK-029 | Mostrar membresía propia y reportes por vencimiento/estado. | TASK-028 | portal/admin queries | Queries GSI paginadas/revalidación; IDOR y fechas probados. | REQ-MEMBER-001/003, REQ-DATA-002 |

## Fase 10. Pagos

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-030 | Registrar pagos idempotentes y comprobante privado. | TASK-015, TASK-021, TASK-028 | payment service/UI/S3 | Canónico/vistas/auditoría atómicos; upload firmado probado. | REQ-PAY-001, REQ-DATA-003/004 |
| TASK-031 | Historial propio y consultas administrativas fecha/estado. | TASK-030 | payment queries/UI | Paginación, ownership y cero Scan probados. | REQ-PAY-003, REQ-DATA-002 |
| TASK-032 | Anulación, ajuste y compensación inmutables. | TASK-030 | correction service/UI | Original persiste; solo ADMIN; vínculos/auditoría probados. | REQ-PAY-002, REQ-ADMIN-002 |

## Fase 11. Clases

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-033 | CRUD lógico de entrenadores y tipos de clase. | TASK-016, TASK-021 | services/UI | Referencias, permisos y soft delete probados. | REQ-CLASS-001 |
| TASK-034 | Crear/editar sesiones y claves de fecha/entrenador. | TASK-033 | session service/UI | Capacidad/hora/vistas/versión/auditoría probadas. | REQ-CLASS-001/002 |
| TASK-035 | Cancelar sesión y propagar cancelaciones idempotentes. | TASK-034 | cancellation worker/service | Bloqueo inmediato; lotes reanudables y auditoría probados. | REQ-CLASS-002, REQ-BOOKING-003 |

## Fase 12. Reservas

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-036 | Implementar reserva atómica con `TransactWriteItems`. | TASK-022, TASK-028, TASK-034 | booking service | Clase/alumno/membresía/duplicado/cupo/idempotencia en una transacción. | REQ-BOOKING-001/002/005, REQ-DATA-003/004 |
| TASK-037 | Implementar cancelación atómica y reconstrucción de contador. | TASK-036 | cancellation/reconciliation | Doble cancelación, contador positivo, repair por partición y auditoría probados. | REQ-BOOKING-003, REQ-DATA-003 |
| TASK-038 | Probar concurrencia, reintentos y fallos parciales. | TASK-036, TASK-037 | integration/load tests | N+M confirma ≤N; conflicto/timeout/replay no duplica ni desincroniza. | REQ-BOOKING-002/005, REQ-DATA-003/004 |
| TASK-039 | Crear UI de clases, cupos, futuras e historial. | TASK-036, TASK-037 | portal | Responsive; datos propios y flujo E2E. | REQ-BOOKING-004 |

## Fase 13. Galería

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-040 | Crear S3/SQS y carga privada segura. | TASK-007, TASK-017, TASK-021 | stacks/upload API | IAM/cifrado/límites/URL firmada probados. | REQ-GALLERY-001, REQ-SEC-003 |
| TASK-041 | Procesar derivados y marca de agua idempotente. | TASK-040 | image worker | MIME/EXIF/tamaños/reintento/corrupción probados. | REQ-GALLERY-001/003, REQ-DATA-004 |
| TASK-042 | Consentimiento, publicación/ocultamiento y feed público. | TASK-041, TASK-023 | gallery service/UI | Vista pública transaccional; original privado; caché probada. | REQ-GALLERY-002/003 |

## Fase 14. Notificaciones

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-043 | Crear adaptador SES, plantillas, lease e intentos. | TASK-017, TASK-007 | notification service/stack | Fake/sandbox; éxito/error/rebote/retry sanitizados. | REQ-NOTIFY-002, REQ-SEC-003 |
| TASK-044 | Job diario por índice de vencimiento y dedupe persistente. | TASK-028, TASK-043 | scheduler/Lambda | Query GSI fecha, revalidación fuerte y doble ejecución probadas. | REQ-NOTIFY-001/002, REQ-DATA-002/004 |

## Fase 15. Administración

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-045 | Integrar dashboard y vistas administrativas. | TASK-026, TASK-029, TASK-032, TASK-035, TASK-042 | `/admin` | Permisos, paginación, responsive y E2E por rol. | REQ-ADMIN-001 |
| TASK-046 | Administrar settings con versión/condiciones. | TASK-017, TASK-021, TASK-045 | settings service/UI | Solo ADMIN; conflicto/auditoría/sin secretos. | REQ-ADMIN-001/002 |

## Fase 16. Seguridad, auditoría y operación

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-047 | Completar auditoría por entidad y actor/fecha. | TASK-032, TASK-035, TASK-046 | audit service/UI | Append-only, GSI2, redacción y permisos probados. | REQ-ADMIN-002, REQ-SEC-003 |
| TASK-048 | Aplicar headers, CSRF, límites, WAF justificado y hardening. | TASK-008, TASK-022, TASK-040 | security config/stacks | Checklist OWASP, tests y assertions IAM exactas. | REQ-SEC-002/003 |
| TASK-049 | Configurar PITR, deletion protection, retención y restore runbook. | TASK-011 | DynamoDB stack/runbook | Production RETAIN/PITR; restauración a tabla nueva simulada. | REQ-DATA-001, REQ-SEC-004 |
| TASK-050 | Configurar alarmas DynamoDB, límites On-Demand, tags y budgets. | TASK-011 | monitoring stack | Consumo/throttle/error/conflict alarmados; costos atribuibles. | REQ-DATA-001/006 |
| TASK-051 | Implementar reconciliaciones y backfill segmentado seguro. | TASK-015, TASK-016, TASK-047 | ops tools/runbooks | Checkpoints, idempotencia, límite y auditoría; no corre en request. | REQ-DATA-003/007 |

## Fase 17. Pruebas

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-052 | Consolidar unitarias/integración DynamoDB y fixtures. | TASK-047, TASK-051 | test suites | Estados/permisos/transacciones/paginación y ausencia de Scan reproducibles. | Todos |
| TASK-053 | Probar consultas administrativas, E2E, a11y, rendimiento y carga. | TASK-052 | Playwright/load tests | Los 25 patrones y negativos pasan; métricas NFR documentadas. | REQ-DATA-002, REQ-BOOKING-002, REQ-SEC-001/002 |

## Fase 18. CI/CD

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-054 | CI con DynamoDB Local y controles de calidad/IaC. | TASK-006, TASK-052 | `.github/workflows/ci.yml` | lint/typecheck/test/build/synth/scans y no-Scan obligatorios. | REQ-DATA-002, REQ-SEC-003/004 |
| TASK-055 | Preparar CD con OIDC/approvals para development, sin desplegar. | TASK-054 | workflow/IAM | Dry-run, tabla/índices/IAM exactos; deploy requiere aprobación. | REQ-SEC-003/004 |

## Fase 19. Despliegue de development

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-056 | Revisar diff, costos y readiness de development. | TASK-053, TASK-055 | checklist/runbooks | Región, límites, IdPs/SES, tabla separada y aprobación; sin deploy. | REQ-DATA-001/006, REQ-SEC-004 |
| TASK-057 | Desplegar development solo con autorización y smoke test real. | TASK-056 + autorización | stacks/workflow | Todos los patrones, consistencia GSI, IAM, alarmas y rollback verificados. | Todos |

## Fase 20. Documentación final

| ID | Objetivo | Dependencias | Archivos/módulos | Finalización y pruebas | Requisitos |
|---|---|---|---|---|---|
| TASK-058 | Actualizar arquitectura, catálogo de claves y runbooks. | TASK-057 | README/docs | Enlaces, comandos y ejemplos validados por colaborador nuevo. | Todos |
| TASK-059 | Cerrar trazabilidad MVP y readiness production. | TASK-058 | matriz/release notes | Cada REQ tiene evidencia/excepción; riesgos production abiertos. | Todos |

## Criterio global

Ninguna fase de despliegue comienza con decisiones críticas pendientes de región, privacidad, identidad, correo, presupuesto o recuperación. Completar una tarea no autoriza la siguiente ni un despliegue. Las operaciones normales nunca dependen de `Scan`.
