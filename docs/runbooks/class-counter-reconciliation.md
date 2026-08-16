# Reconciliación de contadores de clases

Este procedimiento repara `confirmedCount` a partir de una consulta fuertemente consistente de la partición `PK = CLASS#{classId}`. No descubre clases mediante `Scan`: el operador proporciona un manifiesto explícito, revisado y sin datos personales.

## Ejecución segura

1. Crear un `runId` único y un manifiesto inmutable de identificadores de clase.
2. Ejecutar `SegmentedClassCounterBackfill` con `limit` entre 1 y 25.
3. Persistir externamente el checkpoint devuelto (`runId`, digest y `nextOffset`).
4. Pausar si aumentan la latencia, conflictos condicionales o consumo.
5. Reanudar con el mismo manifiesto y checkpoint; cualquier alteración se rechaza.

Cada clase se procesa secuencialmente. La reparación compara versión y contador, actualiza y audita en una transacción; un reintento ya aplicado se convierte en verificación sin escritura. Un fallo devuelve el offset del elemento no confirmado. Nunca ejecutar desde una solicitud web.

## Límites y recuperación

- Máximo 25 clases por invocación y consultas paginadas de reservas.
- Detener ante conflictos repetidos y revisar actividad concurrente.
- Conservar manifiesto y checkpoints como evidencia, sin PII.
- Verificar sesión y auditoría. Si el conteo excede capacidad, investigar; no forzar la escritura.
