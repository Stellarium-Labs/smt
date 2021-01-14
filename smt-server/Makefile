# Stellarium Web - Copyright (c) 2020 - Noctua Software Ltd
#
# This program is licensed under the terms of the GNU AGPL v3, or
# alternatively under a commercial licence.
#
# The terms of the AGPL v3 license can be found in the main directory of this
# repository.

.PHONY: setup dev run update-frontend update-frontend-prod deploy-prod check_access_keys

USER_UID := $(shell id -u)
USER_GID := $(shell id -g)

DEPLOY_SERVER := ubuntu@smt.stellarium-web.org

# Setup the build env for the backend server
setup: Dockerfile
	# Build docker image for node development
	docker build -t smt-server --build-arg USER_UID=${USER_UID} --build-arg USER_GID=${USER_GID} .
	docker run -it -v "$(PWD):/app" smt-server npm install

# Run the backend server on localhost:8100
dev: check_access_keys
	docker run -it -v "$(PWD):/app" -p 8100:8100 smt-server npm start

# Build and run a server locally serving backend and frontend on localhost:8100
# This is the single command to run if you want to try/deploy the server locally.
run: setup update-frontend check_access_keys
	docker-compose build && docker-compose up --remove-orphans

# Check that the git access keys are present
check_access_keys:
	@test -s $(PWD)/access_key && test -s $(PWD)/access_key.pub || echo "Data git server access key files are missing!" && exit

# Deploys the full server (frontend + backend) on the production server
deploy-prod: update-frontend-prod
	bash -c "git log | head -n 1 | sed 's/commit //g' > extraVersionHash.txt"
	ssh -t $(DEPLOY_SERVER) "mkdir -p smt-server && cd smt-server && docker-compose down || true"
	ssh -t $(DEPLOY_SERVER) "rm -rf smt-server/frontend && rm -rf smt-server/node_modules && rm -f smt-server/* 2> /dev/null || true"
	rsync -avz -e ssh --exclude='/data' --exclude='/node_modules' . $(DEPLOY_SERVER):/home/ubuntu/smt-server/
	ssh -t $(DEPLOY_SERVER) "cd smt-server && docker-compose build && docker-compose up -d --remove-orphans"
	rm extraVersionHash.txt

# Generate a static version of the website frontend (GUI) and stores it in the
# frontend/dist directory. It is setup to use the backend on prod server.
update-frontend-prod:
	cp frontend/prodbuild.env.local ../web-frontend/.env.local
	$(MAKE) update-frontend
	rm ../web-frontend/.env.local

# Generate a static version of the website frontend (GUI) and stores it in the
# frontend/dist directory. It is setup to use the backend on localhost:8100
update-frontend:
	rm -rf frontend/dist
	cd ../web-frontend && make setup
	cd ../web-frontend && make build
	mv ../web-frontend/dist frontend/dist
