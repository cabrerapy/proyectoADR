# Requisitos — Gym Platform MVP

- Estado: Borrador para revisión
- Versión: 0.2
- Fecha: 2026-08-02

## 1. Contexto, objetivos y actores

Plataforma mobile-first para un gimnasio de cross training en Limpio, Paraguay. Centraliza presencia pública, alta controlada de alumnos, membresías, pagos manuales, clases, reservas, galería y comunicaciones básicas.

Objetivos: facilitar el descubrimiento y contacto; impedir acceso privado antes de aprobación; dar autoservicio seguro al alumno; reducir trabajo administrativo; evitar sobrecupos; mantener trazabilidad financiera y administrativa; operar con costo y complejidad acordes a poco tráfico.

Actores:

- **Visitante**: consume contenido público, solicita ingreso e inicia autenticación.
- **Solicitante/alumno (`STUDENT`)**: completa perfil y, si está `ACTIVE` con membresía vigente, usa funciones privadas.
- **Personal (`STAFF`)**: operación diaria limitada según matriz.
- **Administrador (`ADMIN`)**: gestión completa y auditada, excepto acciones de plataforma reservadas a infraestructura.
- **Procesos del sistema**: imágenes, vencimientos, notificaciones y auditoría.

## 2. Requisitos funcionales y criterios verificables

### Público y autenticación

- **REQ-PUBLIC-001**: publicar inicio, gimnasio, entrenadores, instalaciones, equipamiento, planes/precios, horarios, ubicación, contacto, WhatsApp, redes y acceso. **Aceptación:** navegación usable a 360 px, contenido configurable y enlaces externos seguros.
- **REQ-AUTH-001**: autenticar mediante Cognito con Google y Facebook. **Aceptación:** no se almacenan contraseñas sociales; callback/redirect está restringido por ambiente.
- **REQ-AUTH-002**: en el primer acceso crear `User` y `Profile` idempotentemente, exigir datos obligatorios y dejar estado `PENDING`. **Aceptación:** repetir el callback no duplica usuario; funciones activas permanecen denegadas.
- **REQ-AUTH-003**: permitir a `ADMIN` aprobar/rechazar y activar/suspender/desactivar; toda transición registra actor, instante, estado anterior/nuevo y motivo cuando corresponda.

### Alumno, planes, membresías y pagos

- **REQ-MEMBER-001**: el alumno consulta su propio perfil, ingreso, plan, estado/vencimiento de membresía y edita solo campos permitidos (contacto y preferencias; no rol, estado, ingreso ni datos financieros).
- **REQ-MEMBER-002**: administrar planes y membresías separadas del alumno. Cada membresía incluye plan, inicio, vencimiento, estado, importe esperado, `PYG`, frecuencia, creador y timestamps.
- **REQ-MEMBER-003**: identificar membresías próximas a vencer y alumnos atrasados mediante filtros reproducibles; la vigencia se determina por estado `ACTIVE` y rango temporal en `America/Asuncion`.
- **REQ-PAY-001**: `STAFF` autorizado o `ADMIN` registra pagos manuales con alumno, membresía, fecha, importe entero, moneda, método, periodo, comprobante opcional, estado, actor y observaciones.
- **REQ-PAY-002**: pagos `CONFIRMED` no se eliminan ni editan de forma destructiva. Correcciones se realizan por anulación auditada, ajuste o asiento compensatorio que referencia el original.
- **REQ-PAY-003**: el alumno solo consulta sus pagos; el comprobante privado se entrega mediante URL firmada breve y autorización previa.

### Clases y reservas

- **REQ-CLASS-001**: administrar tipos de clase y sesiones concretas con entrenador, fecha, inicio/fin, capacidad positiva, estado y conteo confirmado.
- **REQ-CLASS-002**: registrar quién crea/modifica/cancela una sesión; una sesión cancelada no acepta nuevas reservas y conserva historial.
- **REQ-BOOKING-001**: permitir reservar solo al alumno `ACTIVE`, con membresía `ACTIVE` vigente y sesión reservable; denegar duplicados y cupo agotado.
- **REQ-BOOKING-002**: garantizar atómicamente que reservas confirmadas nunca excedan capacidad bajo concurrencia. **Aceptación:** prueba concurrente demuestra como máximo N confirmaciones para N lugares.
- **REQ-BOOKING-005**: confirmar una reserva con una única operación `TransactWriteItems` que compruebe sesión activa/cupo, alumno activo, membresía vigente y ausencia de duplicado; cree la reserva e incremente el contador. **Aceptación:** cualquier condición fallida revierte todas las escrituras y un reintento con la misma clave idempotente no duplica efectos.
- **REQ-BOOKING-003**: permitir cancelación por alumno hasta el plazo configurable anterior al inicio; `STAFF`/`ADMIN` puede cancelar administrativamente con motivo y auditoría.
- **REQ-BOOKING-004**: mostrar clases/cupos, reservas futuras e historial propios; nunca datos privados de otros alumnos. El modelo admite futuro estado de lista de espera, sin exponerlo ni implementarlo en MVP.

### Galería, notificaciones y administración

- **REQ-GALLERY-001**: `STAFF` autorizado/`ADMIN` sube imágenes; el original queda privado y un proceso genera versión optimizada pública con marca de agua.
- **REQ-GALLERY-002**: publicar/ocultar el derivado, guardar metadatos y consentimiento asociado, y ofrecer URL pública compartible. Sin consentimiento publicable válido, la publicación se deniega.
- **REQ-GALLERY-003**: fallos de procesamiento no publican el original ni un derivado incompleto; son reintentables e inspeccionables sin datos sensibles.
- **REQ-NOTIFY-001**: proceso diario detecta membresías que vencen dentro de cinco días y envía correo una vez por combinación alumno/membresía/tipo/fecha objetivo.
- **REQ-NOTIFY-002**: registrar cada intento, éxito/error sanitizado y reintentos limitados; preparar tipos futuros para mora, reserva y cancelación de clase.
- **REQ-ADMIN-001**: panel con búsqueda/filtros de alumnos, solicitudes, membresías, pagos/mora, clases/reservas, entrenadores, galería, configuración y auditoría según permisos.
- **REQ-ADMIN-002**: cambios administrativos sensibles exigen autorización backend y producen `AuditLog` inmutable con actor, acción, entidad, identificador, resultado, timestamp, correlación y cambios sanitizados.

### Seguridad

- **REQ-SEC-001**: aplicar autorización backend por rol, estado y propiedad del recurso; negar por defecto. Cada consulta de alumno incluye su `userId` derivado de sesión, nunca aceptado como autoridad desde el cliente.
- **REQ-SEC-002**: validar entradas, construir expresiones DynamoDB con nombres/valores separados, proteger CSRF donde aplique, usar cookies `Secure`, `HttpOnly`, `SameSite`, cabeceras seguras y rate limiting en login/callback, solicitudes, reservas, cargas y mutaciones administrativas.
- **REQ-SEC-003**: cifrar tránsito y reposo; buckets y base privados; secretos fuera de Git; IAM mínimo; logs sin tokens, credenciales, contenido de comprobantes ni PII innecesaria.
- **REQ-SEC-004**: separar ambientes y datos; backups cifrados y restauración comprobable; retención documentada; dependencias y configuración se revisan en CI.

### Persistencia DynamoDB

- **REQ-DATA-001**: DynamoDB es la única base de datos principal del MVP en modo On-Demand, con tablas separadas por ambiente y cifrado habilitado. Production usa Point-in-Time Recovery y protección contra eliminación.
- **REQ-DATA-002**: todos los patrones de acceso normales enumerados en el ADR-003 se resuelven mediante claves, `GetItem`, `Query`, índices sparse o elementos de vista; no dependen de `Scan`. **Aceptación:** pruebas de repositorio fallan si un flujo normal invoca `ScanCommand`.
- **REQ-DATA-003**: escrituras que mantienen varias representaciones usan `TransactWriteItems`, condiciones e identificadores inmutables. **Aceptación:** fallos inyectados no dejan perfil/lookup, pago/vistas, reserva/contador ni recordatorio/idempotencia parcialmente escritos.
- **REQ-DATA-004**: mutaciones con efectos repetibles en reservas, pagos, imágenes y notificaciones aceptan clave idempotente persistida. **Aceptación:** dos solicitudes con la misma clave y carga producen el mismo resultado; carga distinta se rechaza.
- **REQ-DATA-005**: ningún dato personal sensible aparece directamente en PK, SK o claves de índices. Búsquedas de correo/nombre usan tokens HMAC normalizados y versionados; sus secretos permanecen fuera de la tabla y del repositorio.
- **REQ-DATA-006**: GSIs tienen patrón, claves, proyección, consistencia, costo y riesgo de distribución documentados. Las claves de baja cardinalidad se particionan en shards determinísticos y las consultas hacen fan-out acotado.
- **REQ-DATA-007**: la integridad entre agregados se mantiene en la aplicación mediante validación de dominio, condiciones, transacciones, auditoría y pruebas; no se presupone integridad automática ni eliminación en cascada.

## 3. Historias de usuario y aceptación

| ID | Historia | Criterios verificables |
|---|---|---|
| US-001 | Como visitante quiero conocer el gimnasio y contactarlo. | Contenido esencial carga en móvil; WhatsApp, mapa y redes funcionan; no requiere sesión. |
| US-002 | Como solicitante quiero ingresar con una cuenta social. | Perfil único queda `PENDING`; se solicitan campos faltantes; no accede a reservas. |
| US-003 | Como administrador quiero aprobar una solicitud. | Solo `ADMIN`; transición válida; notificación y auditoría registradas. |
| US-004 | Como alumno activo quiero reservar una clase. | Se validan estado, membresía, duplicado y cupo en una transacción; respuesta refleja resultado único. |
| US-005 | Como alumno quiero cancelar a tiempo. | Antes del límite cambia a cancelada y libera cupo; después se rechaza con código claro. |
| US-006 | Como personal quiero registrar un pago. | Campos válidos, permiso correspondiente, vínculo a membresía y auditoría. |
| US-007 | Como administrador quiero corregir un pago. | Original persiste; corrección enlazada; motivo obligatorio; ambos visibles en historial. |
| US-008 | Como encargado quiero publicar una foto consentida. | Original no es público; derivado con marca de agua sí; sin consentimiento se bloquea. |
| US-009 | Como alumno quiero recibir aviso de vencimiento. | Un correo dentro de ventana de cinco días; reejecución no duplica; resultado registrado. |

## 4. Matriz precisa de permisos

`Propio` significa recurso perteneciente al usuario autenticado. Todo permiso requiere además estado y reglas de negocio aplicables.

| Capacidad | STUDENT | STAFF | ADMIN |
|---|---:|---:|---:|
| Ver/editar contenido público | Ver / No | Ver / No | Ver / Sí |
| Ver/editar perfil propio permitido | Sí | Sí | Sí |
| Ver perfiles de alumnos | No | Sí, campos operativos | Sí |
| Aprobar/rechazar solicitudes | No | No | Sí |
| Cambiar rol o estado de alumno | No | No | Sí |
| Administrar planes | No | Solo ver | CRUD lógico |
| Administrar membresías | Ver propia | Crear/editar operativo, no anular | CRUD lógico y estados |
| Ver pagos | Propios | Todos, operativos | Todos |
| Registrar pago | No | Sí | Sí |
| Anular/ajustar pago | No | No | Sí, con motivo |
| Ver clases/cupos | Sí | Sí | Sí |
| Crear/editar/cancelar sesiones | No | Sí | Sí |
| Reservar/cancelar | Propias, según reglas | Propias; cancelar ajenas administrativamente | Propias; cancelar ajenas administrativamente |
| Administrar entrenadores/tipos | No | Ver | Sí |
| Subir/ocultar galería | No | Sí | Sí |
| Publicar imagen/gestionar consentimiento | No | No | Sí |
| Configuración general | No | No | Sí |
| Auditoría | No | No | Sí, solo lectura |
| Asignar roles/permisos | No | No | Sí, sin elevarse fuera de roles definidos |

## 5. Reglas de negocio y casos negativos

- Estados de usuario: `PENDING`, `ACTIVE`, `SUSPENDED`, `REJECTED`, `INACTIVE`; transiciones se validan mediante máquina de estados. Rechazado/inactivo no se elimina automáticamente.
- Membresías: `PENDING`, `ACTIVE`, `EXPIRED`, `SUSPENDED`, `CANCELLED`; pagos: `PENDING`, `CONFIRMED`, `VOIDED`; reservas: `CONFIRMED`, `CANCELLED_BY_STUDENT`, `CANCELLED_BY_STAFF`, `CANCELLED_BY_CLASS`.
- Fechas se guardan en UTC; reglas de día comercial se calculan explícitamente en `America/Asuncion`. `PYG` se representa sin decimales; otras monedas requieren configuración futura.
- Rechazar: alumno pendiente reservando; membresía vencida a mitad de transacción; misma persona reservando dos veces; N+1 reservas simultáneas; sesión cancelada; cancelación tardía; capacidad reducida bajo confirmados; pago negativo/cero; anulación sin motivo; publicación sin consentimiento; acceso por ID ajeno; callback social no permitido.
- Disminuir capacidad por debajo de reservas confirmadas se deniega mediante condición sobre el elemento canónico de clase. Cancelar clase impide reservas inmediatamente y cancela reservas vigentes de forma idempotente, con proceso reanudable cuando no quepan en una sola transacción.
- Configuración sensible usa control de concurrencia/versión; operaciones repetibles aceptan clave de idempotencia cuando generen efectos financieros, reservas o correos.
- Las relaciones del dominio se expresan mediante identificadores inmutables y elementos relacionados; la aplicación comprueba existencia/estado en escrituras críticas y nunca supone integridad automática de almacenamiento.

## 6. Requisitos no funcionales

- **Usabilidad/accesibilidad:** mobile-first desde 360 px, navegación por teclado, foco visible, contraste y semántica compatibles con WCAG 2.2 AA como objetivo.
- **Rendimiento:** páginas públicas con imágenes optimizadas y caché; objetivo p75 LCP ≤ 2,5 s en móvil razonable y API p95 ≤ 1 s excluyendo cold start/procesos externos, medido en development antes del lanzamiento.
- **Disponibilidad/recuperación:** degradación segura; DynamoDB Point-in-Time Recovery en production; RPO objetivo 5 min (ventana PITR del servicio) y RTO operativo objetivo 8 h, ambos a validar mediante simulacro antes de production.
- **Privacidad:** minimización de PII, consentimiento de fotografía trazable, retención y derechos de acceso/corrección definidos antes de production conforme a normativa paraguaya aplicable.
- **Calidad:** TypeScript estricto; lint/typecheck/pruebas en CI; cobertura focalizada en reglas críticas, no una cifra global engañosa.
- **Observabilidad:** logs estructurados con correlación, métricas de errores/latencia/cupos/procesamiento/correos, alarmas accionables y trazas donde aporten valor.
- **Compatibilidad:** últimas dos versiones estables de Chrome/Edge/Firefox/Safari; Android de gama media y tablets mediante diseño responsive.

## 7. Casos límite

- Cambio de horario de verano/reglas IANA, medianoche local, año bisiesto y sesión que cruza día.
- Identidades Google/Facebook con mismo correo: no vincular automáticamente sin verificación segura; resolver con flujo explícito.
- Cuenta social sin correo verificado, correo cambiado o retirado: exigir canal verificado.
- Reserva y cancelación de clase simultáneas; doble clic/reintento de red; timeout después de commit.
- Procesamiento de imagen duplicado, archivo corrupto, tipo MIME falso, imagen enorme o orientación EXIF.
- Recordatorio ejecutado dos veces, SES temporalmente indisponible o correo rebotado.
- Plan desactivado con membresías históricas; entrenador inactivo con sesiones futuras; eliminación lógica referenciada.

## 8. Suposiciones

- Un único gimnasio/sucursal; volumen bajo; responsables internos confiables pero sujetos a mínimo privilegio.
- La región AWS, dominio, direcciones de correo SES, marca de agua y límites de retención se decidirán antes de development remoto.
- El precio público de planes puede diferir del importe congelado en una membresía; cambios de plan no alteran historial.
- El MVP no calcula impuestos ni emite factura fiscal; un pago es registro administrativo, no comprobante tributario.
- `STAFF` puede operar clases, membresías y registrar pagos, pero no aprobar cuentas, anular pagos, publicar fotos ni administrar seguridad.

## 9. Riesgos y preguntas críticas

- **Privacidad/legal:** base jurídica, texto y duración del consentimiento fotográfico, datos de menores y política de retención requieren validación legal local antes de captar datos reales.
- **Costo/operación:** región AWS, volumen de escrituras transaccionales, vistas/GSIs, backups y disponibilidad de SES/social IdPs condicionan precio; verificar con AWS Pricing Calculator antes de provisionar.
- **Identidad:** Facebook exige configuración y revisión externas; la vinculación de identidades debe diseñarse contra toma de cuenta.
- **Modelo DynamoDB:** cambios de patrones de acceso pueden exigir nuevas vistas o GSIs; mitigar con repositorios, versionado de elementos, backfills idempotentes y pruebas de consulta.
- **Staff financiero:** confirmar si `STAFF` debe registrar pagos y crear membresías; esta versión lo permite pero reserva anulaciones a `ADMIN`.

## 10. Fuera del MVP

Aplicación nativa, pagos electrónicos, WhatsApp automático, rutinas, seguimiento corporal, lista de espera, QR, control físico, múltiples sucursales, publicación automática en redes, IA y analítica avanzada.
