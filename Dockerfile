FROM node:24-alpine

WORKDIR /app

# Instala dependências completas (server.ts usa tsx + build Vite)
COPY package.json .npmrc ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

# Copia restante do projeto e gera build de produção do frontend + PWA
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
