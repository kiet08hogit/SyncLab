# 03 - Security & Isolation

Given this system interacts with untrusted third-party code and executes user test suites, security is the top priority.

## Docker Sandbox Isolation
- **Ephemeral Environments:** Every migration job runs in a pristine, short-lived Docker container spawned programmatically via the Docker Engine API.
- **Unprivileged Execution:** Containers are run as a non-root user.
- **Resource Limits:** Strict memory (e.g., 2GB) and CPU limits are enforced to prevent Fork Bombs or infinite loop tests from freezing the worker nodes.
- **No Host Mounting:** The container does not mount any sensitive host volumes.

## GitHub App Authentication
- **Short-Lived Tokens:** We authenticate as a GitHub App rather than using a static Personal Access Token (PAT).
- **Installation Scopes:** The GitHub App requests minimal permissions (e.g., Read/Write code, Read/Write Pull Requests) restricted strictly to the repositories the user has opted-in to.
- **Token Passing:** When a sandbox container is spawned, a temporary installation token is injected into the container as an environment variable to authorize git operations and PR creation.
