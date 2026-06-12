SHELL := /bin/bash
BACKEND := backend

# ─────────────────────────────────────────────────────────────────────────────
# Setup
# ─────────────────────────────────────────────────────────────────────────────

install:           ## Install all dev tools into the venv
	cd $(BACKEND) && pip install -r requirements-dev.txt

pre-commit-install: ## Install git pre-commit hooks
	pre-commit install

# ─────────────────────────────────────────────────────────────────────────────
# Linting & Formatting
# ─────────────────────────────────────────────────────────────────────────────

lint:              ## Ruff: detect bugs and style issues
	cd $(BACKEND) && ruff check . --exclude venv

format:            ## Black: auto-format all Python files
	cd $(BACKEND) && black . --exclude venv

format-check:      ## Black: check only (no writes — use in CI)
	cd $(BACKEND) && black . --check --exclude venv

# ─────────────────────────────────────────────────────────────────────────────
# Type Checking
# ─────────────────────────────────────────────────────────────────────────────

typecheck:         ## Mypy: static type analysis
	cd $(BACKEND) && mypy . --exclude venv

# ─────────────────────────────────────────────────────────────────────────────
# Testing
# ─────────────────────────────────────────────────────────────────────────────

test:              ## Pytest: run all tests
	cd $(BACKEND) && pytest

coverage:          ## Coverage.py: run tests + generate HTML report
	cd $(BACKEND) && pytest --cov=. --cov-report=html --cov-report=term-missing
	@echo "Open backend/htmlcov/index.html to view the report"

# ─────────────────────────────────────────────────────────────────────────────
# Security
# ─────────────────────────────────────────────────────────────────────────────

security:          ## Bandit: scan for insecure code patterns
	cd $(BACKEND) && bandit -r . --exclude ./venv -c pyproject.toml

audit:             ## pip-audit: scan dependencies for CVEs
	cd $(BACKEND) && pip-audit

safety:            ## Safety: alternative CVE checker
	cd $(BACKEND) && safety check -r requirements.txt

secrets-scan:      ## detect-secrets: scan for accidentally committed secrets
	detect-secrets scan --baseline .secrets.baseline

# ─────────────────────────────────────────────────────────────────────────────
# Profiling
# ─────────────────────────────────────────────────────────────────────────────

profile-cpu:       ## cProfile: profile the backend startup (quick smoke)
	cd $(BACKEND) && python -m cProfile -s cumulative main.py 2>&1 | head -40

profile-memory:    ## memory-profiler: show memory usage of init_db
	cd $(BACKEND) && python -m memory_profiler init_db.py

profile-live:      ## py-spy: live CPU profiler — attach to a running process
	@echo "Usage: py-spy top --pid <PID>"
	@echo "Or:    py-spy record -o profile.svg -- python -m uvicorn main:app"

gc-stats:          ## gc module: show live garbage-collection stats
	cd $(BACKEND) && python -c "import gc; gc.set_debug(gc.DEBUG_STATS); gc.collect(); print('GC counts:', gc.get_count())"

heap:              ## guppy3: heap snapshot (run interactively)
	cd $(BACKEND) && python -c "from guppy import hpy; h = hpy(); print(h.heap())"

# ─────────────────────────────────────────────────────────────────────────────
# Docker
# ─────────────────────────────────────────────────────────────────────────────

docker-build:      ## Build all Docker images
	docker compose build

docker-up:         ## Start all services (detached)
	docker compose up -d

docker-down:       ## Stop all services
	docker compose down

docker-logs:       ## Tail logs from all services
	docker compose logs -f

docker-clean:      ## Remove containers + volumes (WARNING: deletes all data)
	docker compose down -v

# ─────────────────────────────────────────────────────────────────────────────
# Combined
# ─────────────────────────────────────────────────────────────────────────────

check: format lint typecheck test security audit  ## Run all quality checks

.PHONY: install pre-commit-install lint format format-check typecheck \
        test coverage security audit safety secrets-scan \
        profile-cpu profile-memory profile-live gc-stats heap \
        docker-build docker-up docker-down docker-logs docker-clean check

help:              ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
