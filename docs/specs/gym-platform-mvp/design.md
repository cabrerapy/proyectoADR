# Diseño técnico — Gym Platform MVP

- Estado: Borrador para revisión
- Versión: 0.2
- Persistencia obligatoria: Amazon DynamoDB
- ADR relacionados: ADR-001, ADR-002, ADR-003, ADR-004

## 1. Resumen de arquitectura

Monorepo TypeScript con Next.js App Router, backend-for-frontend serverless y paquetes de dominio, validación y acceso a datos. Amazon DynamoDB On-Demand es la única base de datos principal; Cognito autentica; S3/CloudFront gestionan archivos; Lambdas independientes procesan imágenes y notificaciones. La autorización se comprueba siempre en backend.

```text
Navegador
   |
Route 53 / ACM / WAF (cuando el análisis lo justifique)
   |
CloudFront ---- S3 derivados públicos
   |
Next.js serverless (Lambda/S3; App Router)
   |          |                 |
Cognito    DynamoDB          S3 privados
Google/FB  tabla única       originales/comprobantes
              ^
EventBridge -> Lambda recordatorios -> SES
S3 -> SQS -> Lambda imágenes -> S3 derivados

CloudWatch: logs, métricas y alarmas; IAM/KMS/CloudTrail transversales
```

## 2. Componentes

- `apps/web`: UI, Route Handlers y Server Actions apropiadas; todas usan una capa de aplicación compartida.
- `packages/domain`: entidades, estados y políticas puras, independientes de DynamoDB.
- `packages/data-access`: repositorios, codecs de claves, expresiones, transacciones y mapeo de elementos con AWS SDK v3.
- `packages/validation`: contratos de entrada/salida y validación de elementos persistidos.
- `packages/shared`: IDs, reloj, moneda, errores e idempotencia.
- `infrastructure`: CDK por ambiente, tabla/índices, IAM, PITR, alarmas y retención.
- SDK: `@aws-sdk/client-dynamodb` y `@aws-sdk/lib-dynamodb`; los repositorios propios evitan dependencias de mapeo adicionales.

## 3. Decisiones de plataforma

### Hosting

Arquitectura serverless compatible con Next.js conforme a ADR-002. Amplify simplifica despliegues estándar pero ofrece menos control uniforme desde CDK; un contenedor administrado mantiene compatibilidad amplia a mayor costo ocioso. Las tareas de imágenes y recordatorios quedan fuera del runtime de Next.js.

### Persistencia

DynamoDB On-Demand es una decisión obligatoria. Se selecciona una tabla única por ambiente, comparada en ADR-001, porque los agregados comparten ciclo de vida y varias escrituras críticas necesitan atomicidad. La tabla usa elementos canónicos, punteros y vistas materializadas transaccionales. La integridad se implementa mediante condiciones, transacciones, validación, identificadores inmutables, auditoría y pruebas.

### Acceso a datos

Repositorios propios aíslan comandos y claves de DynamoDB. El dominio no importa AWS SDK. Los elementos incluyen `entityType`, `schemaVersion` y validación al leer; las evoluciones usan lectores compatibles, escrituras en versión nueva y backfills idempotentes solamente cuando sean necesarios.

## 4. Comparación y diseño físico

### Modelo de dominio independiente de persistencia

| Agregado/entidad | Referencias lógicas e invariantes |
|---|---|
| `User`, `Profile`, `Role` | Un usuario posee un perfil y uno o más roles; Cognito identifica, pero el estado/roles canónicos pertenecen a la aplicación. |
| `MembershipPlan`, `Membership` | Una membresía referencia alumno/plan inmutables y congela términos; el puntero activo es una optimización, no una entidad del dominio. |
| `Payment` | Referencia alumno/membresía; confirmado es histórico inmutable y las correcciones enlazan el original. |
| `Trainer`, `ClassType`, `ClassSession` | La sesión referencia entrenador/tipo y mantiene capacidad/contador/estado. IDs siguen válidos aunque la entidad referida quede inactiva. |
| `Reservation` | Referencia clase/alumno; solo una vigente por par y sus transiciones conservan historia. |
| `GalleryAsset`, `PhotoConsent` | El consentimiento otorga/revoca un alcance de publicación; el derivado público nunca sustituye el original privado. |
| `Notification` | Referencia destinatario y agregado origen; deduplicación e intentos forman parte del workflow. |
| `GymSettings` | Configuración versionada, no secretos; cambios administrativos auditados. |
| `AuditLog` | Evento append-only con actor, entidad, acción, tiempo, resultado y cambios sanitizados. |

Estas referencias se validan por el servicio de dominio y, en escrituras críticas, mediante `ConditionCheck`/transacciones. No implican joins ni integridad automática del motor.

### Tabla única frente a varias tablas

| Criterio | Tabla única | Varias tablas |
|---|---|---|
| Simplicidad operativa | Un recurso, backups/alarma/IAM centralizados | Entidades más obvias, más recursos/políticas |
| Transacciones | Agregados y vistas en una transacción compacta | DynamoDB permite transacciones entre tablas, pero aumenta coordinación |
| Consultas administrativas | Requiere claves/GSIs/vistas diseñadas | Índices por tabla más fáciles de explicar, más consultas y fan-out |
| Costo On-Demand | Sin costo base; GSIs y vistas cobran por uso | Sin costo base por tabla; índices repetidos y operación mayor |
| Mantenibilidad | Exige codecs y catálogo de tipos rigurosos | Aislamiento conceptual más directo |
| Evolución | Nuevos tipos conviven; backfills selectivos | Cambios aislados, pero workflows cruzados más complejos |

**Selección:** tabla única. El dominio es acotado, el volumen inicial es bajo y las transacciones de reserva/pago/lookup se benefician de un límite de persistencia común. Se reconsideraría separar auditoría o notificaciones si su volumen/retención dominara la tabla, sin cambiar DynamoDB como tecnología principal.

### Tabla

- Nombre lógico: `GymPlatformTable`; nombre físico: `gym-adr-platform-{environment}`.
- Clave: `PK` (string) y `SK` (string).
- Facturación: `PAY_PER_REQUEST`/On-Demand.
- Cifrado: clave administrada por AWS inicialmente; KMS propia si cumplimiento lo exige.
- Point-in-Time Recovery (PITR): activado en production; development configurable con retención/backup de bajo costo.
- Protección: `RemovalPolicy.RETAIN` y deletion protection en production; `DESTROY` solo en local/test y development efímero aprobado.
- TTL: únicamente para idempotencia expirada, leases y datos efímeros; nunca para pagos, auditoría o consentimiento.

### Atributos comunes

`PK`, `SK`, `entityType`, `schemaVersion`, `createdAt`, `updatedAt`, `version`; opcionalmente `expiresAt`, `GSI1PK`, `GSI1SK`, `GSI2PK`, `GSI2SK`. IDs internos son UUID no enumerables. Fechas de orden se codifican en ISO-8601 UTC o `yyyy-mm-dd`; reglas comerciales usan `America/Asuncion`. Importes son enteros con moneda ISO 4217.

### Convenciones de elementos

| Tipo | PK | SK | Propósito |
|---|---|---|---|
| Perfil | `USER#{userId}` | `PROFILE` | Usuario, perfil, rol y estado canónicos |
| Mapeo Cognito | `AUTH#COGNITO#{cognitoSub}` | `USER` | Resolver principal a `userId` |
| Lookup email | `LOOKUP#EMAIL#v1#{token}` | `OWNER` | Unicidad/búsqueda exacta; token HMAC, no email |
| Lookup nombre | `LOOKUP#NAME#v1#{prefixToken}#S{00..03}` | `USER#{userId}` | Búsqueda exacta/prefijo normalizado con fan-out acotado |
| Membresía histórica | `USER#{userId}` | `MEMBERSHIP#{startDate}#{membershipId}` | Snapshot del plan y estado histórico |
| Puntero activo | `USER#{userId}` | `MEMBERSHIP#ACTIVE` | Elegibilidad fuerte sin consultar GSI |
| Pago | `USER#{userId}` | `PAYMENT#{paymentDateTime}#{paymentId}` | Registro financiero canónico e inmutable cuando confirmado |
| Clase | `CLASS#{classId}` | `METADATA` | Sesión, estado, capacidad y `confirmedCount` |
| Reserva | `CLASS#{classId}` | `RESERVATION#{studentId}` | Unicidad natural por clase/alumno |
| Galería publicada | `GALLERY#PUBLIC#{yyyy-mm}#S{shard}` | `PUBLISHED#{publishedAt}#{assetId}` | Feed público paginado |
| Notificación | `NOTIFICATION#{notificationId}` | `METADATA` | Intentos, estado, lease y resultado |
| Recordatorio/idempotencia | `IDEMPOTENCY#REMINDER#{membershipId}` | `REMINDER#{type}#{dueDate}` | Dedupe persistente solicitado |
| Auditoría | `AUDIT#ENTITY#{entityType}#{entityId}` | `AT#{timestamp}#{auditId}` | Historial append-only por entidad |
| Vista materializada | `VIEW#{entityType}#{entityId}` | `VIEW#{purpose}#{relatedId}` | Entrada mínima para un patrón adicional y GSI sparse |

Los tokens de email/nombre se generan con HMAC-SHA256 normalizado, secreto versionado por ambiente y almacenado fuera de DynamoDB. Para nombre se crean prefijos de 3 a 24 caracteres en un único shard determinístico por usuario; la búsqueda consulta cuatro shards y deduplica IDs. Incluso una actualización que elimine y recree todos los prefijos permanece por debajo del límite de 100 acciones de `TransactWriteItems`. La rotación admite versiones `v1`, `v2` durante transición.

### Ejemplos abreviados

```json
{
  "PK": "USER#01J...",
  "SK": "PROFILE",
  "entityType": "UserProfile",
  "status": "ACTIVE",
  "roles": ["STUDENT"],
  "GSI1PK": "USER_STATUS#ACTIVE#S02",
  "GSI1SK": "CREATED#2026-08-01T12:00:00Z#USER#01J...",
  "version": 3
}
```

```json
{
  "PK": "CLASS#01K...",
  "SK": "METADATA",
  "entityType": "ClassSession",
  "status": "SCHEDULED",
  "capacity": 16,
  "confirmedCount": 9,
  "GSI1PK": "CLASS_DATE#2026-08-10#S01",
  "GSI1SK": "AVAILABLE#18:00:00#CLASS#01K...",
  "GSI2PK": "TRAINER#01T...",
  "GSI2SK": "START#2026-08-10T22:00:00Z#CLASS#01K..."
}
```

```json
{
  "PK": "CLASS#01K...",
  "SK": "RESERVATION#01U...",
  "entityType": "Reservation",
  "status": "CONFIRMED",
  "GSI2PK": "USER#01U...",
  "GSI2SK": "RESERVATION#2026-08-10T22:00:00Z#CLASS#01K..."
}
```

## 5. Índices secundarios globales

Solo se crean dos GSIs sparse; un elemento ausente de sus claves no consume almacenamiento/escritura de ese índice.

| Índice | Claves y proyección | Patrones | Costo/riesgo/mitigación |
|---|---|---|---|
| `GSI1-Operational` | `GSI1PK`, `GSI1SK`; `KEYS_ONLY` | usuarios por estado, membresías por vencimiento/estado, pagos por fecha/estado, clases por fecha/disponibilidad, notificaciones pendientes | Cada elemento indexado agrega almacenamiento y una escritura de índice. Claves fecha/estado se dividen en 4 shards determinísticos; Query hace fan-out acotado y merge. |
| `GSI2-Relationships` | `GSI2PK`, `GSI2SK`; `KEYS_ONLY` | clases por entrenador, reservas por alumno, auditoría por actor/fecha | Una escritura de índice por relación. IDs distribuyen carga; un entrenador/actor excepcionalmente activo podría concentrarla, improbable en MVP; alarmar throttles. |

`KEYS_ONLY` minimiza costo y duplicación de PII. Los resultados se resuelven con `BatchGetItem` a elementos canónicos (máximo 100 claves por lote) y autorización previa. Las GSIs solo ofrecen consistencia eventual; ninguna decisión crítica usa su resultado sin revalidar el elemento base.

Las vistas para pago por fecha y estado, y membresía por vencimiento y estado, se escriben junto con el elemento canónico mediante `TransactWriteItems`. Esto permite reutilizar GSI1 aunque una entidad participe en más de un patrón.

### Prevención de particiones calientes

- Particiones base usan IDs de alta cardinalidad (`USER#`, `CLASS#`, `NOTIFICATION#`) y distribuyen naturalmente la carga.
- Claves GSI de baja cardinalidad (estado o fecha) incluyen cuatro shards `S00..S03`, calculados como hash estable del ID; las lecturas consultan solo esos cuatro y combinan páginas.
- Galería se distribuye por mes y shard; auditoría se particiona por entidad. Los tamaños/límites se miden antes de aumentar shards.
- La metadata de una clase concentra el contador por necesidad de exactitud. Con capacidades pequeñas del gimnasio es aceptable; métricas de conflicto/throttling disparan revisión hacia slots de cupo o un protocolo alternativo, nunca contadores sharded sin garantía.
- No se usan claves crecientes globales ni un único `STATUS#ACTIVE`, `DATE#...` o `GALLERY` sin bucket/shard.

## 6. Patrones de acceso

Leyenda de costo: `O(1)` Get/Put por clave; `O(k)` Query/BatchGet proporcional a resultados/páginas; `O(4+k)` fan-out a cuatro shards. Get fuerte de hasta 4 KB consume 1 RRU; eventual consume 0,5 RRU. Escritura de hasta 1 KB consume 1 WRU; transaccional consume el doble. GSI se factura adicionalmente y siempre es eventual.

| # | Patrón | Operación | PK / SK o condición | Índice | Consistencia | Complejidad/costo |
|---:|---|---|---|---|---|---|
| 1 | Usuario por Cognito | `GetItem` | `AUTH#COGNITO#{sub}` / `USER` | Base | Fuerte | O(1), 1 RRU ≤4 KB |
| 2 | Perfil de alumno | `GetItem` | `USER#{id}` / `PROFILE` | Base | Fuerte para autorización | O(1) |
| 3 | Alumnos por estado | 4×`Query` + `BatchGet` | `USER_STATUS#{status}#Sx`, rango por fecha | GSI1 | Eventual; detalle base opcional fuerte | O(4+k) |
| 4 | Alumno por correo | `GetItem` lookup + `GetItem` perfil | `LOOKUP#EMAIL#v1#{hmac}` / `OWNER` | Base | Fuerte | O(1), 2 lecturas |
| 5 | Alumno por nombre normalizado | 4×`Query` lookup + `BatchGet` | `LOOKUP#NAME#v1#{prefixHmac}#Sx`, `begins_with USER#` | Base | Fuerte disponible | O(4+k); prefijos acotados |
| 6 | Solicitudes pendientes | Igual patrón 3 con `PENDING` | `USER_STATUS#PENDING#Sx` | GSI1 | Eventual | O(4+k) |
| 7 | Membresía activa | `GetItem` | `USER#{id}` / `MEMBERSHIP#ACTIVE` | Base | Fuerte | O(1) |
| 8 | Historial de membresías | `Query begins_with` | `USER#{id}` / `MEMBERSHIP#` excluyendo puntero por rango específico | Base | Fuerte opcional | O(k), paginado |
| 9 | Membresías que vencen en fecha | 4×`Query` + `BatchGet` | `MEMBERSHIP_DUE#{date}#Sx` | GSI1 | Eventual; revalidación fuerte | O(4+k) |
| 10 | Alumnos con membresía vencida | 4×`Query` + `BatchGet` | `MEMBERSHIP_STATUS#EXPIRED#Sx`, orden por fin | GSI1 | Eventual | O(4+k) |
| 11 | Pagos de alumno | `Query begins_with` | `USER#{id}` / `PAYMENT#{from..to}` | Base | Fuerte opcional | O(k), paginado |
| 12 | Pagos por fecha | 4×`Query` + `BatchGet` | `PAYMENT_DATE#{date}#Sx` | GSI1 | Eventual | O(4+k) |
| 13 | Pagos por estado | 4×`Query` + `BatchGet` | `PAYMENT_STATUS#{status}#Sx`, rango fecha | GSI1 | Eventual | O(4+k) |
| 14 | Clase por ID | `GetItem` | `CLASS#{id}` / `METADATA` | Base | Fuerte para mutar | O(1) |
| 15 | Clases por fecha | 4×`Query` + `BatchGet` | `CLASS_DATE#{date}#Sx`, SK por disponibilidad/hora | GSI1 | Eventual | O(4+k) |
| 16 | Clases por entrenador | `Query` | `TRAINER#{id}`, SK `START#{from..to}` | GSI2 | Eventual | O(k) |
| 17 | Clases disponibles en periodo | Query por cada fecha/shard con SK `AVAILABLE#` | `CLASS_DATE#{date}#Sx` | GSI1 | Eventual; reserva revalida fuerte | O(días×4+k) |
| 18 | Reservas de clase | `Query begins_with` | `CLASS#{id}` / `RESERVATION#` | Base | Fuerte para reconciliar | O(k) |
| 19 | Reservas de alumno | `Query` | `USER#{id}`, SK `RESERVATION#{from..to}` | GSI2 | Eventual | O(k) |
| 20 | Confirmar duplicado | `GetItem` | `CLASS#{classId}` / `RESERVATION#{studentId}` | Base | Fuerte/condición de escritura | O(1) |
| 21 | Imágenes públicas | `Query` por mes/shard | `GALLERY#PUBLIC#{yyyy-mm}#Sx`, `PUBLISHED#...` | Base | Eventual o fuerte | O(meses×shards+k) |
| 22 | Notificaciones pendientes | 4×`Query` | `NOTIFICATION#PENDING#{yyyy-mm-dd}#Sx`, hasta `scheduledAt` | GSI1 | Eventual; lease condicional fuerte | O(4+k) |
| 23 | Recordatorio enviado | `GetItem`/`PutItem` condicional | `IDEMPOTENCY#REMINDER#{membershipId}` / `REMINDER#{type}#{dueDate}` | Base | Fuerte | O(1) |
| 24 | Auditoría por entidad/fecha | `Query` rango | `AUDIT#ENTITY#{type}#{id}` / `AT#{from..to}` | Base | Fuerte opcional | O(k) |
| 25 | Auditoría por actor/fecha | `Query` rango | `AUDIT_ACTOR#{userId}` / `AT#{from..to}` | GSI2 | Eventual | O(k) |
| 26 | Planes por estado | 4×`Query` + `BatchGet` (8× para todos) | `PLAN_STATUS#{status}#Sx`, orden `NAME#{normalizado}#PLAN#{id}` | GSI1 | Eventual; detalle base fuerte | O(4+k) u O(8+k), catálogo pequeño |

Para actor + entidad + fecha se consulta GSI2 por actor/rango y se filtra `entityType/entityId` dentro del conjunto paginado y acotado; si la entidad es más selectiva se consulta el patrón 24 y se filtra actor. Ambas rutas son `Query`, nunca `Scan`, y aplican límites máximos de periodo/página.

No se usa `Scan` en flujos normales. Herramientas excepcionales de backfill/diagnóstico deben ejecutarse fuera de request web, con segmentación, límite de consumo, checkpoint, métricas, aprobación y costo estimado.

## 7. Autenticación y autorización

1. Cognito Hosted UI usa OAuth/OIDC, Google/Facebook y PKCE.
2. Callback valida issuer, audience, state y nonce.
3. `AUTH#COGNITO#{sub}` resuelve el usuario; alta transaccional crea perfil `PENDING`, mapping Cognito, lookup email y auditoría con condiciones de no existencia.
4. El servidor carga el perfil canónico con lectura fuerte para acciones sensibles.
5. Flujo uniforme: autenticar → principal vigente → permiso → propiedad/estado → validar comando → transacción → auditoría.

La UI nunca es autoridad. Repositorios de alumno reciben el actor desde sesión y construyen las claves; no aceptan un `userId` del cliente como autorización.

## 8. Contratos iniciales de API

JSON bajo `/api/v1`, paginación por cursor opaco y error `{ code, message, correlationId, fieldErrors? }`. Mutaciones críticas requieren `Idempotency-Key`; la carga se hashea y se almacena con el resultado para detectar reutilización incompatible.

| Ruta | Actor | Resultado principal |
|---|---|---|
| `GET/PATCH /me/profile` | autenticado | Perfil propio/lista blanca |
| `GET /me/membership` | STUDENT | Puntero activo e historial |
| `GET /me/payments` | STUDENT | Historial propio paginado |
| `GET /class-sessions` | autenticado | Sesiones por periodo/cupo estimado |
| `POST /class-sessions/{id}/reservations` | STUDENT activo | `201`, `409 FULL/DUPLICATE`, `403 INELIGIBLE` |
| `DELETE /reservations/{id}` | propietario | Cancelación idempotente dentro de plazo |
| `GET/PATCH /admin/students/{id}` | rol autorizado | Consulta/transición auditada |
| `GET/POST /admin/plans`, `GET/PATCH /admin/plans/{id}` | STAFF lectura; ADMIN mutación | Catálogo por estado y CRUD lógico auditado |
| `GET/POST /admin/memberships`, `PATCH /admin/memberships/{id}` | STAFF operativo; ADMIN estados | Historial por alumno y mutación transaccional auditada |
| `POST /admin/payments` | STAFF/ADMIN | Pago y vistas materializadas transaccionales |
| `POST /admin/payments/{id}/void` | ADMIN | Elemento de anulación/compensación, no borrado |
| `POST/PATCH /admin/class-sessions` | STAFF/ADMIN | Sesión y claves de índices actualizadas |
| `POST /admin/gallery/{id}/publish` | ADMIN | Vista pública tras consentimiento |
| `GET /admin/audit-logs` | ADMIN | Query por actor o entidad/fecha |

## 9. Reservas concurrentes y consistencia

`TransactWriteItems` realiza, en una sola transacción:

1. `Update` de `CLASS#{classId}/METADATA` con condición `attribute_exists(PK) AND status = SCHEDULED AND confirmedCount < capacity`; incrementa `confirmedCount`, `version` y cambia la clave GSI1 a `FULL` si alcanza capacidad (si la expresión no puede derivarlo de forma simple, el servicio calcula el valor esperado desde una lectura fuerte y condiciona `version`).
2. `ConditionCheck` de `USER#{studentId}/PROFILE`: `status = ACTIVE`.
3. `ConditionCheck` de `USER#{studentId}/MEMBERSHIP#ACTIVE`: `status = ACTIVE AND startEpochDay <= :today AND endEpochDay >= :today`.
4. `Put` de `CLASS#{classId}/RESERVATION#{studentId}` con `attribute_not_exists(PK)` y claves GSI2 para el alumno.
5. `Put` de idempotencia `IDEMPOTENCY#BOOKING#{studentId}/CLASS#{classId}#REQUEST#{key}` con condición de no existencia.

La condición del `Update` comprueba existencia, estado y cupo; DynamoDB no permite comprobar y actualizar el mismo elemento dos veces en una transacción. Si cualquier condición falla, no se aplica ningún efecto. `ClientRequestToken` cubre reintentos inmediatos de la API y el elemento persistente cubre reintentos posteriores.

Cancelación: transacción condiciona reserva `CONFIRMED`, la cambia a cancelada, decrementa contador con `confirmedCount > 0`, actualiza disponibilidad, guarda idempotencia y auditoría. Una clase cancelada cambia primero su elemento canónico con condición/versionado, bloqueando nuevas reservas; la propagación a reservas usa lotes idempotentes reanudables.

Reconstrucción: `Query` fuerte sobre `PK=CLASS#{id}` y `begins_with(SK,'RESERVATION#')`, cuenta estados confirmados, compara con metadata y repara con condición de `version`; cada ajuste queda auditado. Es O(R) para una clase, nunca un Scan global. Se ejecuta bajo alarma o job de reconciliación, no en cada reserva.

## 10. Membresías y pagos

Planes son plantillas canónicas en `PLAN#{id}/METADATA`. Cada plan activo o inactivo proyecta `GSI1PK=PLAN_STATUS#{status}#Sx` y `GSI1SK=NAME#{nombreNormalizado}#PLAN#{id}`; el listado consulta cuatro shards por estado y relee canónicos con `BatchGetItem` fuerte. Crear o editar reemplaza condicionalmente el canónico por versión y agrega auditoría en un único `TransactWriteItems`; la baja es el estado `INACTIVE`, nunca una eliminación física. El nombre del plan no es PII y solo se normaliza para ordenar el catálogo; un volumen bajo y cuatro shards limitan el riesgo de partición caliente.

La membresía histórica congela plan, importe, moneda y frecuencia. Se crea en `PENDING`; las transiciones permitidas son `PENDING → ACTIVE/CANCELLED`, `ACTIVE → SUSPENDED/EXPIRED/CANCELLED` y `SUSPENDED → ACTIVE/EXPIRED/CANCELLED`. `EXPIRED` y `CANCELLED` son terminales. `STAFF` solo puede crear y editar datos operativos mientras está pendiente; `ADMIN` controla estados y los cambios sensibles exigen motivo.

Activar/cambiar membresía actualiza transaccionalmente elemento histórico, puntero `MEMBERSHIP#ACTIVE`, vistas de vencimiento/estado e auditoría, condicionando versión, estado previo, alumno `ACTIVE/STUDENT` y unicidad del puntero. El puntero guarda `status`, fechas y días epoch para condiciones futuras de reserva. La vigencia se calcula con el día calendario de `America/Asuncion`: una membresía es vigente únicamente con estado `ACTIVE` y fecha local dentro del intervalo inclusivo; antes del inicio es próxima y después del vencimiento está en mora. La elegibilidad usa el puntero canónico con lectura/condición fuerte, no GSI.

Registrar pago crea en una transacción: elemento canónico, vista por fecha, vista por estado, idempotencia y auditoría, tras `ConditionCheck` de membresía/alumno. Un pago `CONFIRMED` no se sobreescribe ni elimina. Anulación crea elemento `PAYMENT_CORRECTION#{timestamp}#{id}` que referencia al original y actualiza solo el estado permitido con condición; ajustes compensatorios son pagos separados enlazados. Toda vista se actualiza en la misma transacción.

## 11. Galería e imágenes

La carga autorizada crea asset `UPLOADING` y URL firmada. S3→SQS→Lambda valida firma mágica, tamaño/dimensiones, elimina EXIF, corrige orientación, genera formatos responsive y aplica marca de agua. Publicar crea transaccionalmente la representación pública por mes/shard, actualiza asset y registra auditoría, solo con derivado `READY` y consentimiento válido. Originales/comprobantes permanecen privados; ocultar elimina la vista pública y versiona/invalida caché de forma idempotente.

## 12. Recordatorios y notificaciones

EventBridge ejecuta diariamente según `America/Asuncion`:

1. Query GSI1 `MEMBERSHIP_DUE#{targetDate}#S00..S03`; nunca Scan.
2. Relee membresía/puntero canónico con consistencia fuerte y verifica estado/fecha.
3. Transacción crea `IDEMPOTENCY#REMINDER#{membershipId}/REMINDER#{type}#{dueDate}` y `Notification=PENDING` con condición de no existencia.
4. Worker consulta notificaciones pendientes, adquiere lease condicional, envía SES y registra `SENT`/`FAILED`, provider message ID, intento y próximo reintento.

La deduplicación evita ejecuciones repetidas del scheduler. Como SES es un efecto externo, la garantía práctica es al menos una vez con lease y registro persistente; una caída después del envío y antes de confirmar puede requerir reconciliación por provider ID. Reintentos son limitados y errores/logs están sanitizados.

## 13. Auditoría, errores y observabilidad

AuditLog es append-only por entidad y se proyecta sparse en GSI2 por actor. Transacciones críticas incluyen auditoría; workflows externos usan outbox/estado reanudable. Errores de condición se mapean a códigos estables sin revelar recursos ajenos; cancelación de transacción se interpreta por razón y correlation ID, no se expone completa al cliente.

Logs JSON excluyen tokens, cookies, valores HMAC, PII y cuerpos completos. Métricas/alertas: `ConsumedReadCapacityUnits`, `ConsumedWriteCapacityUnits`, `ThrottledRequests`, `SystemErrors`, `UserErrors`, latencia, `TransactionConflict`, fallos condicionales anómalos, DLQ, SES y reconciliaciones. Configurar AWS Budgets y, en development, máximo throughput On-Demand opcional contra gastos accidentales.

## 14. Seguridad e IAM

- TLS, cifrado en reposo, S3 privado, secretos en Secrets Manager/SSM y GitHub OIDC.
- IAM por función con acciones exactas (`GetItem`, `Query`, `PutItem`, `UpdateItem`, `TransactWriteItems`, etc.) y ARN de tabla/índices concretos; nunca `dynamodb:*`, todas las tablas o `Resource: "*"`.
- Repositorios separan expresiones mediante `ExpressionAttributeNames/Values`, validan tamaños y limitan páginas.
- CSP, HSTS production, cabeceras, cookies seguras, CSRF/origin checks y rate limiting.
- Development y production usan tablas, claves, roles y datos separados.

## 15. Backups, recuperación y retención

Production habilita PITR, deletion protection y `RETAIN`. Antes de cambios de modelo/backfill se considera backup bajo demanda. El runbook restaura a una tabla nueva, valida conteos/invariantes/índices y conmuta configuración con aprobación; no se restaura sobre la tabla original. TTL no elimina historial financiero/auditoría. Lifecycle de S3 y retención legal se definen por tipo de dato.

Reconciliación posterior a recuperación verifica: punteros de membresía, vistas/GSIs, contador de reservas, idempotencia/notificaciones y hash/referencias financieras. Backfills son idempotentes, segmentados, con checkpoint y capacidad máxima.

## 16. Desarrollo local

Se selecciona **DynamoDB Local mediante Docker** (ADR-004), iniciado por script/compose y con tabla/GSIs creados desde una definición compartida con CDK. Cada suite crea datos aislados y los elimina; pruebas concurrentes usan el cliente real de AWS SDK apuntando al endpoint local.

DynamoDB Local no reproduce exactamente IAM, KMS, PITR, CloudWatch, facturación, adaptive capacity, latencia, throttling, propagación eventual de GSI, TTL ni todas las diferencias del servicio. Por ello CI valida contratos localmente, `cdk synth` valida infraestructura y una suite controlada se ejecutará contra una tabla development real antes de liberar.

## 17. CI/CD y despliegue

PR: instalación reproducible, lint, typecheck, unitarias, integración con DynamoDB Local, pruebas concurrentes/idempotencia, build, `cdk synth`, assertions IAM/tabla/GSIs/PITR, escaneo y E2E selectivo. Un test instrumenta el cliente y prohíbe `ScanCommand` en repositorios normales.

Deployment de development requiere aprobación; crea tabla separada y smoke tests de todos los patrones. Production queda fuera de la fase inicial y exige diff, backup/runbook, revisión de costos, rollback y aprobación. Nunca se ejecuta `cdk deploy` automáticamente.

## 18. Capacidad y costo cualitativo

Supuesto ilustrativo mensual: 300 alumnos, 100 sesiones, 3.000 reservas/cancelaciones, 1.000 operaciones administrativas y menos de 1 GB. Se estiman 100.000–300.000 lecturas lógicas y 50.000–150.000 escrituras físicas, porque transacciones, vistas y dos GSIs multiplican unidades. Una reserva de cinco elementos ≤1 KB consume aproximadamente 10 WRU transaccionales, más escrituras de GSI aplicables; lecturas fuertes duplican el costo de eventuales.

Con On-Demand y este volumen, el costo de tabla/índices debería permanecer en centavos a pocos USD mensuales, antes de PITR, backups, transferencia y CloudWatch; São Paulo suele diferir de us-east-1 y debe cotizarse con la región/medidas reales. El almacenamiento canónico, vistas e índices se espera <1 GB al inicio. PITR y backups agregan costo por GB almacenado. Alarmas y etiquetas `Project`, `Environment`, `CostCenter`, `Owner` son obligatorias.

Reevaluar capacidad provisionada solo tras 2–3 meses de carga estable y predecible, cuando el ahorro calculado supere la operación añadida. On-Demand sigue siendo preferido para tráfico bajo o irregular. Se medirán tamaños medios, RRU/WRU por comando, GSI y transacciones antes de ajustar.

## 19. Riesgos técnicos

- Patrones nuevos pueden requerir vista/GSI: catálogo versionado, revisión de diseño y backfill idempotente.
- GSIs son eventuales: revalidar canónicos fuertemente para reservas, pagos y autorización.
- Vistas duplicadas pueden divergir: transacciones, auditoría y reconciliación.
- Contador de clase es un único punto de escritura: suficiente para cupos pequeños; alarmar conflictos y evaluar slots si escala mucho.
- Sharding agrega fan-out: limitar a cuatro shards, paginar y medir; ajustar solo con evidencia.
- Tokens de búsqueda requieren secreto/rotación: versionar y nunca loguear valores.
- DynamoDB Local no prueba el servicio completo: suite de development real y assertions CDK.
- Costos pueden crecer por escrituras/vistas mal diseñadas: métricas por operación, presupuestos y límites On-Demand opcionales.
