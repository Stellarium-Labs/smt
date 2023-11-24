FROM genesem/nginx-lua-alpine:latest
RUN apk update --allow-untrusted && apk upgrade
RUN apk add --no-cache ca-certificates
RUN update-ca-certificates
COPY nginx.conf /etc/nginx/nginx.conf
COPY ./dist /usr/share/nginx/html
COPY default.conf /etc/nginx/conf.d/
COPY gzip.conf /etc/nginx/conf.d/
COPY ./lua /etc/nginx/lua/
EXPOSE 8100
