# gym-adr-platform

Plataforma web responsive para un gimnasio de cross training en Limpio, Paraguay. El MVP comprende sitio público, portal del alumno, administración, membresías, pagos manuales, clases, reservas, galería con marca de agua y recordatorios por correo.

## Estado

El MVP está implementado y dispone de un entorno integral local con DynamoDB Local, fixtures y autenticación ficticia. La preparación de AWS development permanece separada y no existen recursos AWS desplegados.

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

## Entorno integral local

Requisitos: Node.js 24, npm y Docker Desktop iniciado. No se necesitan credenciales AWS ni archivos `.env`.

```text
npm run dev:local
```

El comando levanta DynamoDB Local, crea la tabla única y sus dos GSIs, aplica fixtures idempotentes e inicia Next.js en `http://localhost:3000`. Abra `http://localhost:3000/local-login` para seleccionar un perfil ficticio.

Para descartar todos los datos y volver a sembrar:

```text
npm run local:reset
```

La verificación vertical automatizada se ejecuta con `npm run local:verify`. Detalles, perfiles y matriz manual: `docs/runbooks/local-development.md`.

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

Completar las puertas manuales de AWS development descritas en el runbook de readiness antes de autorizar cualquier despliegue.
