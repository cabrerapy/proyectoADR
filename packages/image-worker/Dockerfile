FROM node:24-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/domain ./packages/domain
COPY packages/shared ./packages/shared
COPY packages/data-access ./packages/data-access
COPY packages/image-worker ./packages/image-worker
RUN npm ci --workspace @gym-adr/image-worker
RUN npm run build --workspace @gym-adr/image-worker

FROM public.ecr.aws/lambda/nodejs:22
COPY --from=build /workspace/packages/image-worker/dist/handler.mjs ${LAMBDA_TASK_ROOT}/handler.mjs
COPY --from=build /workspace/node_modules/sharp ${LAMBDA_TASK_ROOT}/node_modules/sharp
COPY --from=build /workspace/node_modules/@img ${LAMBDA_TASK_ROOT}/node_modules/@img
COPY --from=build /workspace/node_modules/detect-libc ${LAMBDA_TASK_ROOT}/node_modules/detect-libc
CMD ["handler.handler"]
