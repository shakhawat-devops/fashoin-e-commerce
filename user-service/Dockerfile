FROM node:16

WORKDIR /usr/src/app

COPY package*.json ./
COPY .env ./

RUN npm install

COPY . .

EXPOSE 3001

CMD ["npm", "start"]
