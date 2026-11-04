FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY build.js ./
COPY src ./src
COPY public ./public
COPY data ./data
RUN node build.js

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
