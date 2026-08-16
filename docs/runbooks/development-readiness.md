# Readiness de development

- Fecha de revisión: 2026-08-16
- Alcance: `TASK-056`
- Resultado: **NO AUTORIZADO PARA DESPLEGAR**

La infraestructura local está preparada para sintetizarse y compararse, pero este documento no autoriza `cdk bootstrap`, `cdk deploy` ni cambios remotos. Antes de `TASK-057`, todas las puertas manuales deben quedar resueltas y un responsable debe autorizar explícitamente el despliegue.

## Controles verificados localmente

| Control | Resultado | Evidencia |
|---|---|---|
| Ambiente aislado | Aprobado | Stack `gym-adr-platform-development` y tabla `gym-adr-platform-development`; no comparten nombres con local/production. |
| DynamoDB | Aprobado | `PAY_PER_REQUEST`, PK/SK, `GSI1-Operational`, `GSI2-Relationships`, cifrado KMS y TTL; máximo 500 RRU/WRU On-Demand. |
| Costos | Aprobado con límite | Budget development de USD 25/mes, alertas al 80 % previsto y 100 % real, tags obligatorios y sin NAT Gateway ni contenedor siempre activo. |
| Recuperación | Aprobado para development | Recursos development son efímeros; production conserva PITR, deletion protection y `RETAIN`. El runbook restaura siempre a tabla nueva. |
| Identidad | Aprobado en IaC | Cognito social-only, callbacks HTTPS de CloudFront y nombres separados para secretos Google/Facebook. |
| Correo | Aprobado en IaC | SES limita `SendEmail` a la identidad indicada por parámetro; scheduler y reintentos están definidos. |
| IAM | Aprobado en assertions | Operaciones DynamoDB/S3/SES exactas, sin `dynamodb:*`, `s3:*` ni `Scan`; recursos acotados a tabla, índices, buckets e identidad. |
| Planificación | Aprobado localmente | Workflow manual con OIDC, environment `development`, synth y `cdk diff`; no contiene bootstrap ni deploy. |

## Revisión cualitativa de costos

Para el tráfico bajo del MVP, DynamoDB On-Demand, Lambda, SES y transferencia deberían ser variables y reducidos. Los costos base más visibles provendrán de KMS, Secrets Manager, logs/alarms, almacenamiento y distribución CloudFront; el procesamiento de imágenes agrega Lambda/SQS/ECR bajo uso. El budget de USD 25 es el guardrail inicial, no una garantía. Antes de aprobar el diff se debe estimar el template en la región elegida y confirmar que el pronóstico queda dentro del presupuesto.

## Puertas manuales pendientes

- [ ] Aprobar la cuenta AWS exclusiva/no productiva y registrar su ID fuera del repositorio.
- [ ] Elegir y aprobar la región. `sa-east-1` es la candidata por proximidad a Paraguay; comparar costo/latencia antes de fijar `AWS_REGION`.
- [ ] Autorizar y ejecutar, si la cuenta aún no lo tiene, el bootstrap CDK mediante un procedimiento separado.
- [ ] Crear el proveedor GitHub OIDC y el rol de **planificación** con trust limitado al repositorio y environment exactos.
- [ ] Configurar en GitHub el environment `development`, revisores obligatorios, rama protegida, `AWS_REGION` y `AWS_DEVELOPMENT_PLAN_ROLE_ARN`.
- [ ] Crear aplicaciones Google/Facebook del ambiente y cargar sus valores directamente en Secrets Manager; nunca copiarlos al repositorio o logs.
- [ ] Verificar la identidad remitente SES en la región elegida y confirmar las restricciones de sandbox/destinatarios.
- [ ] Confirmar propietario del topic de alertas y recepción de las notificaciones del budget.
- [ ] Ejecutar el workflow de planificación, conservar el `cdk diff`, revisar reemplazos/destrucciones, IAM y costo, y obtener aprobación explícita de `TASK-057`.
- [ ] Preparar rollback: detener tráfico, restaurar a tabla nueva cuando corresponda y revertir CloudFormation; no borrar datos para “limpiar” un fallo.

## Criterio de salida

`TASK-057` solo puede comenzar cuando todas las casillas estén cerradas con evidencia externa, el diff no tenga reemplazos destructivos inesperados y el usuario autorice explícitamente el despliegue. La suite real debe verificar los 25 patrones, consistencia eventual de GSIs, permisos IAM, alarmas y rollback. DynamoDB Local y `cdk synth` no sustituyen esa comprobación.
