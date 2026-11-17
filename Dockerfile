# Railway shu Dockerfile orqali yig'adi (railway.json). Lokal: docker build -t footballcenter .
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# Railway Volume (yuklangan bannerlar/sovrinlar) root egaligida ulanadi, shuning uchun
# ilova root sifatida ishlaydi — aks holda volume'ga yozib bo'lmaydi.
RUN mkdir -p /app/uploads

CMD ["node", "src/index.js"]
