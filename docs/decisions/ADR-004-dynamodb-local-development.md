# ADR-004: Desarrollo local con DynamoDB Local

- Estado: Aceptado
- Fecha: 2026-08-02

## Contexto

Se necesitan pruebas rápidas y sin costo que reproduzcan claves, GSIs, condiciones y transacciones, manteniendo tablas reales aisladas para validar diferencias del servicio administrado.

## Alternativas

1. DynamoDB Local ejecutado directamente con Java: válido, pero obliga a gestionar runtime/puertos manualmente.
2. DynamoDB Local mediante Docker: reproducible, aislado y fácil de integrar con CI.
3. Tabla AWS development para toda prueba: mayor fidelidad, pero agrega red, credenciales, costo, latencia y riesgo de datos compartidos.

## Decisión

Usar **DynamoDB Local mediante Docker** para desarrollo e integración cotidiana. Un script crea la tabla y los dos GSIs desde una definición compartida conceptualmente con CDK. Las suites aíslan datos por prefijo/run ID y limpian solo sus elementos/tablas efímeras.

Antes de liberar development, ejecutar una suite controlada contra una tabla AWS real separada para verificar IAM, propagación de GSI, transacciones, límites y configuración CDK.

## Justificación

Docker ofrece la mejor reproducibilidad y no exige costos/credenciales para la mayoría de pruebas. La tabla real complementa, no sustituye, la prueba local.

## Consecuencias

- El endpoint local se inyecta solo en ambiente `local`; production nunca acepta override de endpoint.
- Pruebas cubren creación de tabla/índices, expresiones condicionales, idempotencia, concurrencia, paginación y ausencia de Scan.
- CI inicia un contenedor efímero y espera health/readiness, sin persistir datos entre ejecuciones.

## Diferencias relevantes

DynamoDB Local no reproduce fielmente IAM, KMS, PITR, backups, deletion protection, CloudWatch, cobro, adaptive capacity, cuotas, latencia, throttling, TTL ni el retraso real de GSIs. Algunas validaciones de parámetros pueden variar. CDK assertions y pruebas contra development cubren esas brechas.

## Riesgos

- Falsa confianza por comportamiento local: suite real mínima obligatoria antes de release.
- Deriva entre definición local y CDK: una especificación/fixture compartido y test que compara nombres/tipos de claves/GSIs.
- Docker no disponible: documentar requisitos y permitir una tabla local efímera alternativa, sin usar recursos AWS por defecto.

