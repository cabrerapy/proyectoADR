# Excepción temporal de dependencias — 2026-08-07

## Estado y alcance

- Estado: aprobada explícitamente por el propietario del proyecto el 2026-08-07.
- Alcance: herramientas locales de desarrollo y síntesis; no autoriza despliegues ni exposición de servidores Vite a la red.
- Excluye: runtime productivo, datos reales, credenciales y recursos AWS.
- Vencimiento: 2026-09-07 o antes si se publica una corrección compatible.

## Riesgos aceptados

| Componente | Versión/ruta | Severidad reportada | Motivo temporal |
|---|---|---|---|
| Vite | `7.3.3` | Alta | La corrección indicada, `7.3.6`, aún no está publicada; se usa indirectamente por Vitest. |
| esbuild | `0.27.7` bajo Vite | Baja | La corrección publicada `0.28.1` queda fuera del rango `^0.27.0` de Vite 7.3.3. |
| brace-expansion | `5.0.8` dentro de `aws-cdk-lib@2.263.0` | Alta | Es dependencia empaquetada de la última versión publicada de `aws-cdk-lib` y no admite corrección independiente. |

## Mitigaciones obligatorias

- No iniciar ni exponer un servidor Vite; Vitest se ejecuta con `vitest run` sobre código confiable del repositorio.
- No procesar rutas, patrones o proyectos no confiables con Vite, esbuild o CDK.
- Mantener Next.js como servidor de desarrollo de la aplicación y limitarlo a loopback durante trabajo local.
- No usar `--force`, `--legacy-peer-deps`, overrides incompatibles ni modificaciones manuales de `node_modules`.
- Mantener `npm audit --audit-level=high` visible; la excepción no convierte el resultado en éxito.
- Repetir pruebas, build y `cdk synth` después de cualquier actualización de estas dependencias.

## Cierre y revisión

Revisar semanalmente y cerrar la excepción cuando estén disponibles versiones compatibles. La excepción queda revocada si una dependencia afectada entra en el runtime productivo, si se expone un servidor de desarrollo a otra interfaz de red o si cambia la evaluación de impacto. La actualización debe ser explícita, sin salto mayor automático, y debe actualizar `tasks.md` con la nueva evidencia.
