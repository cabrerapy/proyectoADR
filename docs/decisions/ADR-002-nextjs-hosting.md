# ADR-002: Hosting de Next.js

- Estado: Aceptado
- Fecha: 2026-08-02

## Contexto

La aplicación usa Next.js App Router, páginas públicas, rutas autenticadas, operaciones de backend y procesamiento asíncrono. Se busca bajo costo inicial, IaC unificada, integración serverless con DynamoDB y soporte correcto de las capacidades de Next.js.

## Alternativas

1. **AWS Amplify Hosting**: experiencia de despliegue simple y buen soporte de Next.js, pero menor control uniforme desde CDK y posibles límites o diferencias de soporte según funciones del framework.
2. **Arquitectura serverless compatible con Next.js** (adaptador mantenido, por ejemplo OpenNext): CloudFront, S3 y Lambda; pago por uso, control mediante CDK y composición con VPC, Cognito y demás servicios. Introduce dependencia del adaptador y exige pruebas en cada actualización de Next.js.
3. **Contenedor administrado** (ECS Fargate/App Runner): runtime predecible y soporte amplio, pero costo base, red, escalado y operación mayores para poco tráfico.

## Decisión

Usar una **arquitectura serverless compatible con Next.js**, desplegada con CDK y fijando versiones compatibles de Next.js y del adaptador. Las tareas asíncronas (imágenes y recordatorios) serán Lambdas independientes.

## Justificación

Minimiza el costo ocioso y permite gobernar recursos, cabeceras, dominios, IAM y conectividad en una sola infraestructura. Es adecuada para el volumen esperado sin mantener contenedores activos.

## Consecuencias

- Debe existir una matriz de compatibilidad y pruebas de SSR, rutas, caché, assets y autenticación antes de cada upgrade.
- CloudFront sirve contenido y versiones públicas de imágenes; los originales permanecen privados.
- Se documentará un camino de migración a contenedor si aparecen incompatibilidades críticas.

## Riesgos

- El adaptador no es una capacidad nativa de Next.js y puede retrasarse respecto del framework.
- Cold starts y latencia regional pueden afectar la experiencia inicial.
- La topología serverless y la invalidación de caché requieren observabilidad específica.
