# AGENTS.md

## Producto y alcance

`gym-adr-platform` es una plataforma web en español para un gimnasio de cross training de Limpio, Paraguay. Incluye sitio público, portal del alumno y administración. Trabajar una tarea identificada de `docs/specs/gym-platform-mvp/tasks.md` por vez; no ampliar el alcance silenciosamente y registrar cambios de alcance o arquitectura.

## Tecnologías aprobadas

- Monorepo con npm workspaces, Next.js estable (App Router), React, TypeScript estricto y Tailwind CSS.
- Amazon DynamoDB On-Demand como única base de datos principal; AWS SDK for JavaScript v3 (`@aws-sdk/client-dynamodb` y `@aws-sdk/lib-dynamodb`); AWS CDK con TypeScript.
- AWS: Cognito, S3, CloudFront, Lambda, API Gateway cuando corresponda, SES, EventBridge Scheduler, SSM Parameter Store o Secrets Manager, CloudWatch y WAF cuando se justifique.
- Vitest para pruebas unitarias/integración y Playwright para E2E; GitHub Actions para CI/CD controlado.

## Estructura

- `apps/web`: aplicación Next.js.
- `packages/domain`, `packages/data-access`, `packages/validation`, `packages/shared`: lógica reutilizable sin dependencias circulares.
- `infrastructure`: CDK y configuración por ambiente.
- `docs/specs`, `docs/decisions`, `docs/architecture`: especificación y decisiones vigentes.

## Convenciones

- TypeScript en modo `strict`; evitar `any`, conversiones inseguras y aserciones no justificadas.
- Validar toda entrada en límites de confianza. La autorización se verifica en backend y nunca depende solo de la UI.
- Nombres y código en inglés; textos de interfaz y documentación funcional en español. Fechas persistidas en UTC y presentadas en `America/Asuncion`; importes monetarios en enteros de unidad mínima y moneda ISO 4217.
- Favorecer módulos pequeños, dependencias explícitas, operaciones idempotentes y errores tipados. Mantener documentación, requisitos y ADR actualizados.
- Diseñar primero los patrones de acceso de DynamoDB. Las operaciones normales deben usar `GetItem`, `Query`, `BatchGetItem` o transacciones; todo `Scan` requiere justificación, límite, métrica y revisión explícita.
- No introducir otra base de datos principal ni una biblioteca de mapeo de persistencia sin una nueva decisión explícita del usuario.

## Seguridad

- Mínimo privilegio en IAM y roles de aplicación; impedir acceso horizontal entre alumnos.
- Nunca guardar secretos, credenciales, tokens ni datos reales sensibles en código, documentación, pruebas, ejemplos, `AGENTS.md` o Git.
- Usar cifrado en tránsito/reposo, URLs firmadas para archivos privados, logs sanitizados, auditoría inmutable de acciones administrativas y eliminación lógica cuando corresponda.
- Separar `local`, `development` y `production`; recursos, secretos y configuración no se comparten entre ambientes.
- Proteger invariantes de DynamoDB mediante claves estables, expresiones condicionales, `TransactWriteItems`, idempotencia y pruebas concurrentes; nunca confiar en datos calculados por la interfaz.

## Calidad y pruebas

- Antes de completar una tarea, ejecutar los comandos disponibles de formato/lint, `typecheck` y pruebas afectadas; ejecutar E2E cuando el cambio lo requiera.
- No omitir, desactivar, relajar ni borrar pruebas para obtener un resultado exitoso. Añadir pruebas para reglas de negocio, autorización y concurrencia.
- Resumir resultados exitosos y mostrar detalle completo solo ante fallos.

## Comandos y despliegues

- Permitidos: inspección, Git no destructivo, instalación declarada por una tarea aprobada, lint, typecheck, pruebas, build, tablas efímeras de DynamoDB Local, `cdk synth` y análisis estático.
- `cdk diff` solo con configuración AWS válida y dentro del ambiente autorizado.
- Requieren autorización explícita: `cdk deploy`, escrituras o cambios de tablas remotas, backups/restauraciones remotas, publicación de artefactos, cambios en DNS/identidad/secretos y cualquier operación destructiva o de producción.
- No desplegar automáticamente ni ejecutar acciones en producción. CI puede validar; un despliegue de `development` debe tener aprobación y protecciones de ambiente.
