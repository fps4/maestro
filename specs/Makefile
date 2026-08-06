# Development shortcuts. The stack itself is compose; this is the memory of how to drive it.

COMPOSE := docker compose -f infra/docker/compose.yml -p mstr-specs

.PHONY: help up down logs ps reset api web test lint typecheck fmt apply validate mongo-shell

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

up: ## Build and start the whole stack (mongo replica set, minio, api, web)
	$(COMPOSE) up -d --build
	@echo "api  http://127.0.0.1:8020/health"
	@echo "web  http://127.0.0.1:8021"

down: ## Stop the stack, keeping data
	$(COMPOSE) down

reset: ## Stop the stack and DELETE its data, including the replica-set keyfile
	$(COMPOSE) down -v --remove-orphans

logs: ## Follow the logs
	$(COMPOSE) logs -f --tail 100

ps: ## Show container status
	$(COMPOSE) ps -a

# The database only. Everything else runs on the host during development, which is faster to
# iterate against than a rebuilt image.
mongo: ## Start just the MongoDB replica set
	$(COMPOSE) up -d mongo mongo-init

api: ## Run the api on the host against the compose MongoDB
	cd api && MONGO_URI='mongodb://127.0.0.1:27019/?directConnection=true' \
		MONGO_USER=specs MONGO_PASSWORD=specs npm run dev

web: ## Run the console on the host
	cd web && npm run dev

# `directConnection=true` matters from the host: without it the driver discovers the replica set
# member by its in-network hostname (`mstr-specs-mongo`), which the host cannot resolve.
test: ## Run every test (needs `make mongo` first)
	cd api && MONGO_URI='mongodb://127.0.0.1:27019/?directConnection=true' \
		MONGO_USER=specs MONGO_PASSWORD=specs npm test
	cd web && npm test

lint: ## Lint both packages
	cd api && npm run lint
	cd web && npm run lint

typecheck: ## Typecheck both packages
	cd api && npm run typecheck
	cd web && npm run typecheck

fmt: ## Format both packages
	cd api && npm run format
	cd web && npm run format

validate: ## Validate every committed workspace definition (no database needed)
	cd api && npm run workspace:validate

apply: ## Apply both workspace definitions to the running MongoDB
	cd api && MONGO_URI='mongodb://127.0.0.1:27019/?directConnection=true' \
		MONGO_USER=specs MONGO_PASSWORD=specs \
		npm run workspace:apply -- ../config/workspaces/catalogue.yaml
	cd api && MONGO_URI='mongodb://127.0.0.1:27019/?directConnection=true' \
		MONGO_USER=specs MONGO_PASSWORD=specs \
		npm run workspace:apply -- ../config/workspaces/maestro-platform.yaml

mongo-shell: ## Open a mongosh against the running replica set
	$(COMPOSE) exec mongo mongosh -u specs -p specs --authenticationDatabase admin
