# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
ENV NODE_ENV=production PORT=3000
EXPOSE 3000

# Make sure package.json has: "start": "node server.js" (or your entry file)
CMD ["npm","start"]
