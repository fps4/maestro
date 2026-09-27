# Development shortcuts. The stack itself is compose; this is the memory of how to drive it.

COMPOSE := docker compose -f infra/docker/compose.yml -p mstr-run

.PHONY: help up down logs reset dynamodb table api test lint typecheck fmt

# The local loop's store: DynamoDB Local on 8050, the table the api and the tests read.
LOCAL_DB := TABLE_NAME=runtime DYNAMODB_ENDPOINT=http://127.0.0.1:8050 AWS_REGION=local

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Build and start the stack (DynamoDB Local, api on :8051)
	$(COMPOSE) up -d --build
	@echo "api  http://127.0.0.1:8051/health"

down: ## Stop the stack, keeping data
	$(COMPOSE) down

reset: ## Stop the stack and DELETE its data
	$(COMPOSE) down -v --remove-orphans

logs: ## Follow the logs
	$(COMPOSE) logs -f --tail 100

dynamodb: ## Start just DynamoDB Local (the tests make their own tables on it)
	$(COMPOSE) up -d dynamodb

table: ## Create the local loop's table on DynamoDB Local, from api/src/db/table.ts
	cd api && $(LOCAL_DB) npm run table:create

api: ## Run the api on the host against the compose DynamoDB Local (after `make table`)
	cd api && $(LOCAL_DB) npm run dev

test: ## Run every test (needs `make dynamodb` first)
	cd api && DYNAMODB_ENDPOINT=http://127.0.0.1:8050 npm test

lint: ## Lint
	cd api && npm run lint

typecheck: ## Typecheck
	cd api && npm run typecheck

fmt: ## Format
	cd api && npm run format
