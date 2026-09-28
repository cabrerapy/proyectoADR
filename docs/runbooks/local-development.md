# Entorno integral local

## Alcance

Este entorno conserva la arquitectura productiva y sustituye únicamente los límites externos: DynamoDB usa la imagen oficial local, Cognito usa identidades ficticias de lista cerrada y S3 usa los firmantes locales ya existentes para comprobantes y galería. SES y los jobs programados no bloquean la aplicación web; sus puertos falsos se validan en las pruebas de workers. Ningún comando de esta guía accede a AWS.

## Arranque y limpieza

Requisitos: Node.js 24, npm, Docker Desktop y dependencias instaladas con `npm install`.

```text
npm run dev:local
```

El comando prepara automáticamente la tabla `gym-adr-platform-local`, `GSI1-Operational`, `GSI2-Relationships`, datos ficticios y Next.js en `http://localhost:3000`. Al terminar con `Ctrl+C`, elimina el contenedor y los datos efímeros.

Reset reproducible e idempotente:

```text
npm run local:reset
```

El reset recrea y resiembra la tabla sin iniciar AWS. DynamoDB Local queda activo para el siguiente `npm run dev:local`; puede detenerse con `npm run dynamodb:local:down`.

## Perfiles ficticios

Abra `http://localhost:3000/local-login`. No existen contraseñas ni secretos.

| Alias | Rol/estado | Datos principales |
|---|---|---|
| `student` | `STUDENT / ACTIVE` | Membresía vigente, pago confirmado y clase reservable |
| `staff` | `STAFF / ACTIVE` | Panel operativo; configuración y auditoría exclusivas bloqueadas |
| `admin` | `ADMIN / ACTIVE` | Administración completa implementada |
| `pending` | `STUDENT / PENDING` | Flujo de solicitud pendiente |
| `suspended` | `STUDENT / SUSPENDED` | Reserva bloqueada |
| `inactive` | `STUDENT / INACTIVE` | Funciones activas bloqueadas |

La cookie contiene solo un alias local; el backend lo convierte a un subject ficticio y vuelve a resolver rol y estado desde DynamoDB. El adaptador local solo se activa cuando `APP_ENVIRONMENT=local` y `LOCAL_AUTH_ENABLED=1`.

## Matriz mínima

Ejecute `npm run local:verify` desde cero. La prueba crea el entorno, realiza los flujos y lo limpia.

| Perfil | Flujo | Esperado | Obtenido |
|---|---|---|---|
| VISITOR | Inicio y `/gimnasio` | HTTP 200 | Verificado automáticamente |
| VISITOR | Perfil privado sin sesión | HTTP 401 | Verificado automáticamente |
| STUDENT | Login, perfil, membresía y clases | HTTP 200 | Verificado automáticamente |
| STUDENT | Reserva y cancelación | HTTP 201 / 200 | Verificado automáticamente |
| STUDENT suspendido | Reserva | HTTP 403 | Verificado automáticamente |
| STAFF | Dashboard operativo | HTTP 200 | Verificado automáticamente |
| STAFF | Configuración exclusiva ADMIN | HTTP 403 | Verificado automáticamente |
| ADMIN | Dashboard, alumnos y configuración | HTTP 200 | Verificado automáticamente |

Para una revisión visual, repita los mismos flujos desde `/local-login` en 360 px y escritorio. Los comprobantes y originales cargados localmente usan URLs de un solo uso y memoria del proceso; se reinician al detener la aplicación.

## Límites locales

- DynamoDB Local no reproduce IAM, cifrado, PITR, Streams ni todas las diferencias de consistencia del servicio administrado.
- La autenticación ficticia no prueba OAuth, Google, Facebook ni validación JWKS; esas rutas conservan el adaptador Cognito fuera de local.
- El correo se prueba con proveedor fake en la suite del worker y no se entrega a direcciones reales.
- Los datos y archivos locales son efímeros y exclusivamente ficticios.
