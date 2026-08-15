# Restauración point-in-time de DynamoDB

Este procedimiento es exclusivamente manual y requiere autorización explícita. Nunca restaura sobre la tabla original ni cambia producción automáticamente.

## Preparación

1. Confirmar incidente, ambiente, instante UTC y responsable aprobador.
2. Verificar que la tabla fuente sea `gym-adr-platform-development` o `gym-adr-platform-production` y que PITR esté disponible para el instante elegido.
3. Generar y revisar un plan local, sin ejecutarlo:
   `node scripts/dynamodb-restore-plan.mjs gym-adr-platform-production gym-adr-platform-production-restore-20260815T120000Z 2026-08-15T12:00:00Z`.
4. Registrar la ventana y el identificador del incidente fuera de los datos de aplicación; no copiar credenciales ni datos personales al ticket.

## Restauración autorizada

Un operador autorizado ejecuta el comando estructurado del plan contra una tabla nueva. Espera estado `ACTIVE` y verifica PK/SK, `GSI1-Operational`, `GSI2-Relationships`, cifrado KMS, TTL y lecturas fuertes de muestras no sensibles. Después habilita PITR y protección contra eliminación en la tabla restaurada antes de considerar cualquier cambio de tráfico.

## Validación y decisión

- Ejecutar consultas canónicas, índices, transacciones condicionales e idempotencia con datos de control.
- Comparar conteos mediante consultas acotadas conocidas; no usar `Scan` como validación ordinaria.
- La conmutación requiere un plan separado, aprobación explícita, respaldo del origen y actualización controlada de configuración.
- Si falla una verificación, conservar ambas tablas, bloquear la conmutación y registrar solo códigos sanitizados.

## Retorno

La tabla original se conserva. Una reversión de tráfico sigue el mismo proceso de aprobación. La eliminación posterior de cualquier tabla restaurada es una acción destructiva independiente y nunca forma parte de este runbook automático.
