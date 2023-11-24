FROM node:14-bullseye

EXPOSE 8080
EXPOSE 8888

WORKDIR /app

ENV LANG C.UTF-8
ENV LC_ALL C.UTF-8

USER root
RUN apt update
RUN apt upgrade -y
RUN apt install software-properties-common -y
RUN add-apt-repository ppa:deadsnakes/ppa
RUN apt install python3 -y

# Make python 3.7 the default
RUN echo "alias python=python3" >> ~/.bashrc
RUN export PATH=${PATH}:/usr/bin/python3.7
RUN /bin/bash -c "source ~/.bashrc"

# Install pip
RUN apt install python3-pip -y
RUN python3 -m pip install --upgrade pip

RUN deluser --remove-home node

# Configure default user environment
ARG USER_UID=1000
ARG USER_GID=1000
USER root
RUN groupadd --system app -g 1000 && useradd --system -u 1000 -g 1000 app

RUN chown app /app
USER app
RUN id app

RUN yarn

CMD yarn run dev
