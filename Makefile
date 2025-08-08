.PHONY: help setup build test lint fmt docker-build infra-plan infra-apply deploy-k8s

ROOT_DIR := $(shell pwd)

help:
	@echo "Common targets: setup build test lint fmt docker-build infra-plan infra-apply deploy-k8s"

setup:
	@echo "Run stack-specific setup in each app (e.g., npm ci, pip install)."

build:
	@$(MAKE) -C apps/web build || true
	@$(MAKE) -C apps/console build || true
	@$(MAKE) -C apps/api-python build || true
	@$(MAKE) -C apps/api-go build || true
	@$(MAKE) -C apps/api-java build || true

test:
	@$(MAKE) -C apps/web test || true
	@$(MAKE) -C apps/api-python test || true
	@$(MAKE) -C apps/api-go test || true
	@$(MAKE) -C apps/api-java test || true

lint:
	@$(MAKE) -C apps/web lint || true
	@echo "Add linters for other stacks as needed."

fmt:
	@$(MAKE) -C apps/web fmt || true
	@echo "Add formatters for other stacks as needed."

docker-build:
	@docker build -t example/web:local apps/web || true
	@docker build -t example/console:local apps/console || true
	@docker build -t example/api-python:local apps/api-python || true
	@docker build -t example/api-go:local apps/api-go || true
	@docker build -t example/api-java:local apps/api-java || true

infra-plan:
	@cd ops/terraform/envs/example && terraform init -input=false && terraform plan

infra-apply:
	@cd ops/terraform/envs/example && terraform apply -auto-approve

deploy-k8s:
	@helm upgrade --install demo ops/helm/app \
	  --namespace demo --create-namespace \
	  --set image.repository=example/web --set image.tag=local
