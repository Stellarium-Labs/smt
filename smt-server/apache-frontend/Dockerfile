FROM php:7.2-apache
RUN curl -sS https://getcomposer.org/installer | php -- \
--install-dir=/usr/bin --filename=composer
RUN apt-get update && apt-get install -y zip unzip
RUN composer require jasig/phpcas:1.3.8

COPY src/ /var/www/html/
EXPOSE 80
