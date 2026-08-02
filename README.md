# gym-adr-platform

Plataforma web responsive para un gimnasio de cross training en Limpio, Paraguay. El MVP comprende sitio público, portal del alumno, administración, membresías, pagos manuales, clases, reservas, galería con marca de agua y recordatorios por correo.

## Estado

Especificación DynamoDB auditada. Next.js ya fue inicializado en `apps/web` y sus dependencias quedaron instaladas en una ejecución anterior. AWS CDK todavía no fue inicializado y no existen recursos AWS desplegados.

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

`apps/web` ya existe. Los paquetes compartidos y `infrastructure/` se crearán únicamente al ejecutar sus tareas correspondientes.

## Próximo paso

Revisar y aprobar la especificación. Tras la aprobación, comenzar por `TASK-001` y avanzar una tarea por vez conforme a `AGENTS.md`.
