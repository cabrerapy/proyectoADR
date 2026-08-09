# ADR-003: Patrones de acceso DynamoDB

- Estado: Aceptado
- Fecha: 2026-08-02

## Contexto

En DynamoDB el esquema físico se deriva de consultas conocidas. El MVP exige búsquedas administrativas, historial por agregado, vencimientos, reservas concurrentes y notificaciones sin scans habituales.

## Alternativas

1. Crear un GSI por consulta: lectura directa, pero alto costo de escritura/almacenamiento y demasiados índices.
2. Dos GSIs sobrecargados más vistas materializadas: menos índices y costo controlable; exige transacciones y codecs rigurosos.
3. Scan con filtros: sencillo inicialmente, costo/latencia crecen con toda la tabla y no es aceptable para operaciones normales.

## Decisión

Usar elementos canónicos y vistas con estos caminos:

- Base `USER#{id}`: perfil, membresía activa/histórica y pagos.
- Base `CLASS#{id}`: metadata y reservas, donde `RESERVATION#{studentId}` impide duplicados.
- Base de lookups: Cognito directo y email/nombre mediante tokens HMAC.
- `GSI1-Operational`: estado de alumnos, vencimiento/estado de membresías, fecha/estado de pagos, fecha/disponibilidad de clases y notificaciones pendientes.
- `GSI2-Relationships`: sesiones por entrenador, reservas por alumno y auditoría por actor.
- Base por entidad/fecha para auditoría y base por mes/shard para galería pública.

El catálogo completo y vigente de patrones, claves, operación, índice, consistencia y costo está en la sección 6 de `design.md` y forma parte de esta decisión.

## Consistencia

- `GetItem` fuerte: perfil en autorización sensible, puntero de membresía, clase antes/durante mutaciones, duplicado y reconciliación.
- Query base: fuerte cuando el resultado gobierna una corrección; eventual cuando es historial visual tolerante a retraso.
- GSI: siempre eventual; listados administrativos y descubrimiento. Antes de mutar se relee/condiciona el canónico.
- `BatchGetItem`: reintenta `UnprocessedKeys`, limita 100 elementos y puede solicitar fuerte para la tabla base.

## Transacciones, idempotencia y sobrecupo

Una reserva usa `TransactWriteItems`: actualiza clase con condición `SCHEDULED` y `confirmedCount < capacity`; comprueba alumno `ACTIVE`; comprueba puntero de membresía `ACTIVE` y vigente; inserta reserva con no existencia; inserta idempotencia. Cualquier fallo revierte todo. La UI nunca aporta el contador autoritativo.

Cancelación condiciona reserva confirmada y contador positivo; cambia estado, decrementa y audita en una transacción. `ClientRequestToken` cubre el reintento inmediato y elementos `IDEMPOTENCY#...` conservan deduplicación duradera. La reconstrucción consulta solo la partición de una clase y repara con control de versión.

Pagos y membresías escriben canónico, puntero/vistas, idempotencia y auditoría en transacción. Pagos confirmados no se eliminan: anulación/compensación son elementos enlazados.

## Impacto en costos

- GSI sparse cobra solo elementos indexados, pero cada escritura indexada agrega WRU y almacenamiento.
- Vistas por fecha/estado multiplican escrituras; se aceptan para evitar GSIs separados y scans.
- Transacciones cuestan el doble de unidades estándar; una reserva de cinco elementos pequeños ronda 10 WRU antes de escrituras GSI.
- `KEYS_ONLY` reduce tamaño de índices a cambio de `BatchGetItem` adicional.
- On-Demand es adecuado para poco tráfico irregular; medir RRU/WRU/tamaño por operación y reconsiderar provisionado tras carga estable.

## Justificación

Dos índices reutilizables y vistas explícitas equilibran costo, mantenibilidad y cobertura. El sharding de cuatro vías evita concentrar estados/fechas sin introducir fan-out ilimitado.

## Consecuencias

- Repositorios deben escribir todas las representaciones en una sola transacción.
- CI prohíbe `ScanCommand` en flujos normales y prueba cada patrón/paginación.
- Claves GSI de baja cardinalidad incluyen `S00..S03`; servicios consultan/mezclan los cuatro shards.
- Cursores son opacos y contienen `LastEvaluatedKey` protegido/validado.

## Riesgos

- Consistencia eventual visible en listados: comunicar estado y revalidar al mutar.
- Conflictos sobre metadata de clase: reintentos con jitter e idempotencia; capacidad del gimnasio limita contención.
- Costos de vistas: métricas por comando, AWS Budgets y máximo On-Demand opcional.
- Búsqueda por nombre no es full-text: prefijos HMAC acotados; un motor de búsqueda requeriría decisión futura.
