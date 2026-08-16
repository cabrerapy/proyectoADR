# Línea base no funcional del MVP

## Objetivos

- Web móvil: LCP p75 menor o igual a 2,5 s en un Android de gama media y red 4G representativa.
- API: latencia p95 menor o igual a 1 s, excluyendo arranques en frío documentados.
- Accesibilidad: navegación por teclado, estructura semántica, contraste WCAG 2.1 AA y ausencia de desbordamiento a 360 px.
- Reservas: ante N solicitudes simultáneas mayores que la capacidad, nunca confirmar más cupos que la capacidad ni duplicar un alumno.

## Evidencia local y límites

`task-053.spec.ts` valida una respuesta local menor a 5 s como alarma de regresión, no como sustituto de Web Vitals reales. Las pruebas de integración de reservas ejecutan contención concurrente contra DynamoDB Local y comprueban contador, duplicados y rollback. La matriz `access-pattern-catalog.test.mjs` enlaza los 25 patrones aprobados con métodos que usan claves o índices.

DynamoDB Local no reproduce latencia, throttling, particiones ni consistencia de GSIs del servicio. Antes de producción se medirán p75/p95 en `development`, con CloudWatch y datos sintéticos sin PII. Una desviación no se corrige aumentando permisos o incorporando `Scan`; se revisan claves, paginación, concurrencia y capacidad.
