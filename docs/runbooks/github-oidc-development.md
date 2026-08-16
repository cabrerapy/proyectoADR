# OIDC y aprobación para development

El workflow `development-plan.yml` es manual y de solo lectura: valida contratos CDK, sintetiza y ejecuta `cdk diff`. No contiene un paso de despliegue. El ambiente de GitHub `development` debe exigir revisores antes de entregar el token OIDC.

## Configuración manual previa

1. En GitHub, crear el ambiente `development`, agregar revisores obligatorios y restringirlo a la rama principal protegida.
2. Definir las variables del ambiente `AWS_REGION` y `AWS_DEVELOPMENT_PLAN_ROLE_ARN`. No usar secretos con access keys.
3. En AWS, crear una vez el proveedor OIDC `token.actions.githubusercontent.com` y un rol separado de planificación.
4. Limitar la confianza del rol a `repo:OWNER/REPOSITORY:environment:development`, audiencia `sts.amazonaws.com` y al repositorio exacto.
5. Dar al rol solo lectura necesaria para CloudFormation/CDK diff y lectura de artefactos de bootstrap. Acotar recursos al stack `GymPlatformStack`, tabla `gym-adr-platform-development`, sus dos índices, roles del proyecto y buckets del ambiente. Las acciones AWS que solo admiten `Resource: "*"` deben enumerarse y justificarse en revisión de seguridad.
6. Ejecutar el workflow con un motivo trazable y revisar el diff como artefacto del run.

## Puerta de despliegue

Un futuro workflow de despliegue deberá usar otro rol, otra aprobación del ambiente y un evento manual. No debe reutilizar el rol de planificación. Hasta una autorización explícita, no se añade ni ejecuta `cdk deploy`.

La prueba del workflow bloquea credenciales estáticas, disparadores automáticos y comandos de bootstrap o despliegue. Las pruebas CDK verifican localmente la tabla On-Demand, PK/SK, `GSI1-Operational`, `GSI2-Relationships` y políticas IAM del runtime antes del diff remoto.
