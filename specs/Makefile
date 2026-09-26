# Development shortcuts. The stack itself is compose; this is the memory of how to drive it.

COMPOSE := docker compose -f infra/docker/compose.yml -p mstr-specs

.PHONY: help up down logs ps reset api web test lint typecheck fmt apply validate dynamodb table

# The local loop's store: DynamoDB Local on 8030, the table the api and the tests read.
LOCAL_DB := TABLE_NAME=specs DYNAMODB_ENDPOINT=http://127.0.0.1:8030 AWS_REGION=local

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

up: ## Build and start the whole stack (DynamoDB Local, minio, api, web)
	$(COMPOSE) up -d --build
	@echo "api  http://127.0.0.1:8020/health"
	@echo "web  http://127.0.0.1:8021"

down: ## Stop the stack, keeping data
	$(COMPOSE) down

reset: ## Stop the stack and DELETE its data
	$(COMPOSE) down -v --remove-orphans

logs: ## Follow the logs
	$(COMPOSE) logs -f --tail 100

ps: ## Show container status
	$(COMPOSE) ps -a

# The store only. Everything else runs on the host during development, which is faster to
# iterate against than a rebuilt image.
dynamodb: ## Start just DynamoDB Local (the tests make their own tables on it)
	$(COMPOSE) up -d dynamodb

table: ## Create the local loop's table on DynamoDB Local, from api/src/db/table.ts
	cd api && $(LOCAL_DB) npm run table:create

api: ## Run the api on the host against the compose DynamoDB Local (after `make table`)
	cd api && $(LOCAL_DB) npm run dev

web: ## Run the console on the host
	cd web && npm run dev

test: ## Run every test (needs `make dynamodb` first)
	cd api && DYNAMODB_ENDPOINT=http://127.0.0.1:8030 npm test
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

apply: ## Apply the catalogue and the demo tenant to the local loop's table
	cd api && $(LOCAL_DB) npm run workspace:apply -- ../config/workspaces/catalogue.yaml
	cd api && $(LOCAL_DB) npm run workspace:apply -- ../config/workspaces/aannemer-x.yaml
