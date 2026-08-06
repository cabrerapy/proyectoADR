# gym-adr-platform

Plataforma web responsive para un gimnasio de cross training en Limpio, Paraguay. El MVP comprende sitio público, portal del alumno, administración, membresías, pagos manuales, clases, reservas, galería con marca de agua y recordatorios por correo.

## Estado

Especificación DynamoDB auditada. La fundación del monorepo, Next.js, la infraestructura base con AWS CDK, la tabla única DynamoDB On-Demand y el adaptador AWS SDK v3 están implementados hasta `TASK-012`, incluido el build serverless real de OpenNext. No existen recursos AWS desplegados.

## Decisiones base

- Interfaz en español, zona horaria `America/Asuncion`, moneda `PYG`.
- Monorepo TypeScript con Next.js App Router y AWS CDK.
- Hosting serverless compatible con Next.js en AWS; DynamoDB On-Demand con diseño de tabla única y acceso mediante AWS SDK v3. Véanse los ADR en `docs/decisions/`.
- Ambientes: `local`, `development` y `production`; inicialmente solo se trabaja en los dos primeros.

## Documentación

- Requisitos: `docs/specs/gym-platform-mvp/requirements.md`
- Diseño: `docs/specs/gym-platform-mvp/design.md`
- Plan: `docs/specs/gym-platform-mvp/tasks.md`
- Decisiones: `docs/decisions/`

## DynamoDB Local

Requisito: Docker Desktop o un motor compatible con Docker Compose. El contenedor solo escucha en `127.0.0.1`, usa memoria efímera y no requiere credenciales AWS reales.

```text
npm run dynamodb:local:up
npm run dynamodb:local:smoke
npm run dynamodb:local:down
```

`npm run dynamodb:local:test` ejecuta el ciclo completo de arranque, readiness, transacción y limpieza. El puerto predeterminado es `8000`; para una ejecución puntual puede cambiarse con `DYNAMODB_LOCAL_PORT`.

## Estructura prevista

```text
apps/web/                 Aplicación Next.js
packages/domain/          Modelo y reglas de negocio
packages/data-access/     Repositorios, claves y acceso a DynamoDB
packages/validation/      Contratos y validación compartida
packages/shared/          Utilidades y tipos transversales
infrastructure/           AWS CDK por ambiente
docs/                     Especificaciones, arquitectura y ADR
.github/workflows/        CI y despliegues protegidos
```

`apps/web`, los paquetes compartidos e `infrastructure/` ya existen conforme a las tareas completadas.

## Próximo paso

Implementar `TASK-013`, primitivas persistentes de idempotencia, siempre una tarea por vez conforme a `AGENTS.md`.
