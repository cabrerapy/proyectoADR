# ADR-001: Modelo de datos DynamoDB

- Estado: Aceptado
- Fecha: 2026-08-02

## Contexto

DynamoDB es la única base de datos principal obligatoria del MVP. El sistema necesita acceso por usuario, estado, fechas, entrenador y relaciones inversas; además requiere reservas sin sobrecupo, pagos inmutables, recordatorios idempotentes y auditoría.

## Alternativas

### Tabla única

Elementos heterogéneos comparten `PK/SK`, dos GSIs sparse y convenciones tipadas. Elementos canónicos, punteros y vistas materializadas se mantienen con transacciones.

- Ventajas: una unidad operativa, transacciones compactas, costo On-Demand sin base por entidad, consultas de agregados eficientes y IAM/backups centralizados.
- Desventajas: claves menos intuitivas, duplicación controlada, disciplina estricta de patrones y backfills al añadir consultas.

### Varias tablas

Una tabla por agregado principal (usuarios, membresías, pagos, clases, notificaciones, auditoría).

- Ventajas: límites fáciles de explicar, índices específicos y aislamiento de volumen/retención.
- Desventajas: más recursos/políticas/monitoreo, workflows cruzados más complejos y consultas administrativas con mayor coordinación.

## Decisión

Usar **una tabla DynamoDB por ambiente**, On-Demand, con clave compuesta `PK/SK`, `GSI1-Operational` y `GSI2-Relationships`. Los patrones adicionales se resuelven mediante vistas mínimas transaccionales, no mediante Scan.

Tipos principales: `UserProfile`, `AuthMapping`, `Lookup`, `Membership`, `ActiveMembershipPointer`, `Payment`, `PaymentCorrection`, `Trainer`, `ClassType`, `ClassSession`, `Reservation`, `GalleryAsset`, `PhotoConsent`, `Notification`, `GymSettings`, `AuditLog`, `Idempotency` y `View`.

Convenciones y matriz completa están en `docs/specs/gym-platform-mvp/design.md`. Ninguna PII sensible se coloca directamente en claves; correo/nombre usan tokens HMAC versionados.

## Justificación

El dominio es acotado y de bajo tráfico. La tabla única equilibra operación, costo y atomicidad, mientras dos GSIs y vistas explícitas cubren consultas administrativas. Mantener repositorios/codec de claves evita que el modelo físico contamine el dominio.

## Consecuencias

- Todo patrón nuevo se diseña antes de codificar y puede exigir una vista/backfill.
- La integridad es responsabilidad del dominio, condiciones, transacciones, idempotencia, auditoría y pruebas.
- GSIs son eventuales; decisiones críticas releen elementos canónicos con consistencia fuerte.
- Production habilita PITR, retención y protección contra eliminación; ambientes usan tablas separadas.
- Se prohíbe `Scan` en operaciones normales mediante tests del cliente.

## Riesgos

- Divergencia de vistas si una escritura evita el repositorio: restringir acceso y usar transacciones/reconciliación.
- Particiones calientes en estados/fechas: cuatro shards determinísticos y fan-out acotado.
- Modelo difícil de comprender: catálogo de elementos, ejemplos y pruebas por patrón.
- Crecimiento de auditoría/notificaciones: medir; separar a otra tabla DynamoDB solo mediante nuevo ADR si volumen/retención lo justifican.
