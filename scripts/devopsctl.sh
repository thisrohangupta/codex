#!/usr/bin/env bash
set -euo pipefail

cmd=${1:-help}
shift || true

case "$cmd" in
  init)
    echo "Scaffolded; customize templates under apps/ and ops/" ;;
  build)
    make build ;;
  test)
    make test ;;
  plan)
    make infra-plan ;;
  apply)
    make infra-apply ;;
  deploy)
    make deploy-k8s ;;
  *)
    echo "Usage: devopsctl.sh [init|build|test|plan|apply|deploy]" ;;
esac

