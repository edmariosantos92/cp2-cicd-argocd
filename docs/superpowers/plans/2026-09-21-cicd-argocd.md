# CP2: CI/CD com GitHub Actions e Argo CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a working GitOps pipeline (GitHub Actions → GHCR → Argo CD → Minikube) for a small demo app, prove it end-to-end with a real code change, and produce the evidence + report the assignment requires.

**Architecture:** A Node/Express app is built into a Docker image by GitHub Actions on every push to `app/**`, pushed to GHCR tagged with the commit SHA, and the workflow commits the new tag back into `k8s/deployment.yaml`. Argo CD watches the `k8s/` path of the same repo and auto-syncs the cluster whenever that manifest changes — no manual `kubectl apply` in steady state.

**Tech Stack:** Node.js 20 + Express, Docker, GitHub Actions, GitHub Container Registry (ghcr.io), Minikube, Argo CD, kubectl.

**Spec:** `docs/superpowers/specs/2026-09-21-cicd-argocd-design.md`

## Global Constraints

- GitHub account: `edmariosantos92` (already authenticated in `gh`, token scopes `repo`,`workflow` — no `packages` scope, so GHCR visibility must be changed via the web UI, not `gh api`).
- Repo name: `cp2-cicd-argocd`, public, default branch `main`.
- Image name: `ghcr.io/edmariosantos92/cp2-app`.
- Namespace for the app in-cluster: `cp2-app`. Argo CD lives in `argocd`.
- Equipe para o relatório: Edmário Santos (RM565486), Kauê Lima (RM562071).
- Working directory: `C:\Users\edmar\Desktop\CP\DevOps` (already a git repo with one commit — the spec).
- All Kubernetes/Argo CD work targets Minikube with the `docker` driver — no cloud account needed.

---

### Task 1: Environment setup

**Files:** none (tooling only)

**Interfaces:**
- Produces: a working `docker`, `minikube`, `kubectl`, `argocd` CLI, and a running Docker Desktop engine, for every later task to use.

- [ ] **Step 1: Start Docker Desktop and wait for the engine**

```powershell
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Poll until ready (retry every ~10s, up to ~3 min):

```bash
until docker info >/dev/null 2>&1; do sleep 10; done; docker info --format '{{.ServerVersion}}'
```

Expected: prints a Docker server version (e.g. `27.x.x`), no connection error.

- [ ] **Step 2: Install Minikube and the Argo CD CLI via winget**

```powershell
winget install -e --id Kubernetes.minikube --accept-source-agreements --accept-package-agreements
winget install -e --id Argoproj.ArgoCD --accept-source-agreements --accept-package-agreements
```

- [ ] **Step 3: Verify tools**

```bash
minikube version
argocd version --client
kubectl version --client
gh auth status
```

Expected: each prints a version/status with no error. If `minikube`/`argocd` aren't on PATH yet in the current shell, open a new shell (winget updates PATH via a broadcast the current session may not have picked up).

- [ ] **Step 4: Commit nothing (tooling-only task) — proceed to Task 2**

---

### Task 2: Scaffold the demo app + Dockerfile

**Files:**
- Create: `app/package.json`
- Create: `app/server.js`
- Create: `app/Dockerfile`
- Create: `app/.dockerignore`

**Interfaces:**
- Produces: an HTTP server on port 3000, route `GET /` (HTML with title/version/color), route `GET /health` (200 "ok") — consumed by the Kubernetes probes in Task 3 and by manual verification in every later task.
- Env vars consumed by the app: `PORT` (default 3000), `APP_VERSION` (default from `package.json`), `APP_COLOR` (default `#1e293b`), `APP_TITLE` (default `CP2 - CI/CD com GitHub Actions e Argo CD`).

- [ ] **Step 1: Create `app/package.json`**

```json
{
  "name": "cp2-app",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
```

- [ ] **Step 2: Create `app/server.js`**

```javascript
const express = require('express');
const { version: pkgVersion } = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = process.env.APP_VERSION || pkgVersion;
const APP_COLOR = process.env.APP_COLOR || '#1e293b';
const APP_TITLE = process.env.APP_TITLE || 'CP2 - CI/CD com GitHub Actions e Argo CD';

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-br">
<head><meta charset="UTF-8"><title>${APP_TITLE}</title></head>
<body style="background-color:${APP_COLOR}; color:#fff; font-family: sans-serif; text-align:center; padding-top: 15vh;">
  <h1>${APP_TITLE}</h1>
  <h2>Versao: ${APP_VERSION}</h2>
  <p>Deploy automatizado via GitHub Actions + Argo CD</p>
</body>
</html>`);
});

app.get('/health', (req, res) => res.status(200).send('ok'));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
```

- [ ] **Step 3: Create `app/Dockerfile`**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 4: Create `app/.dockerignore`**

```
node_modules
npm-debug.log
```

- [ ] **Step 5: Build and run the image locally to verify**

```bash
cd app
docker build -t cp2-app:local .
docker run -d --rm --name cp2-app-test -p 3000:3000 cp2-app:local
sleep 2
curl -s http://localhost:3000/ | grep -o '<h2>.*</h2>'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/health
docker stop cp2-app-test
cd ..
```

Expected: first curl prints `<h2>Versao: 1.0.0</h2>`, second prints `200`.

- [ ] **Step 6: Commit**

```bash
git add app/
git commit -m "Add demo Express app and Dockerfile"
```

---

### Task 3: Kubernetes manifests

**Files:**
- Create: `k8s/namespace.yaml`
- Create: `k8s/deployment.yaml`
- Create: `k8s/service.yaml`

**Interfaces:**
- Consumes: image `ghcr.io/edmariosantos92/cp2-app` (Task 5 publishes real tags here), app port 3000 and `/health` route (Task 2).
- Produces: namespace `cp2-app`, Deployment `cp2-app`, Service `cp2-app` (NodePort 80→3000) — consumed by Argo CD's `Application` in Task 7 and by `minikube service` in Task 8.

- [ ] **Step 1: Create `k8s/namespace.yaml`**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: cp2-app
```

- [ ] **Step 2: Create `k8s/deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cp2-app
  namespace: cp2-app
  labels:
    app: cp2-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cp2-app
  template:
    metadata:
      labels:
        app: cp2-app
    spec:
      containers:
        - name: cp2-app
          image: ghcr.io/edmariosantos92/cp2-app:latest
          ports:
            - containerPort: 3000
          env:
            - name: APP_VERSION
              value: "1.0.0"
            - name: APP_COLOR
              value: "#1e293b"
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
```

- [ ] **Step 3: Create `k8s/service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: cp2-app
  namespace: cp2-app
spec:
  type: NodePort
  selector:
    app: cp2-app
  ports:
    - port: 80
      targetPort: 3000
```

- [ ] **Step 4: Validate the manifests parse (dry-run against local kubeconfig, no cluster needed yet)**

```bash
kubectl apply --dry-run=client -f k8s/namespace.yaml -f k8s/deployment.yaml -f k8s/service.yaml
```

Expected: three lines `namespace/cp2-app created (dry run)`, `deployment.apps/cp2-app created (dry run)`, `service/cp2-app created (dry run)` — no YAML errors. (It's fine if there's no reachable cluster yet; a dry-run client-side check only validates syntax/schema.)

- [ ] **Step 5: Commit**

```bash
git add k8s/
git commit -m "Add Kubernetes manifests for cp2-app"
```

---

### Task 4: GitHub repository + CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.gitignore`

**Interfaces:**
- Consumes: `app/Dockerfile` (Task 2), `k8s/deployment.yaml` (Task 3).
- Produces: on every push touching `app/**`, a new image `ghcr.io/edmariosantos92/cp2-app:<short-sha>` and `:latest` in GHCR, and an updated `image:` line in `k8s/deployment.yaml` committed back to `main` — consumed by Argo CD (Task 7).

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
*.log
```

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

```yaml
name: CI - Build, Push, Update Manifest

on:
  push:
    branches: [main]
    paths:
      - 'app/**'
      - '.github/workflows/ci.yml'

permissions:
  contents: write
  packages: write

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository_owner }}/cp2-app

jobs:
  build-push-update:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Set image tag
        id: vars
        run: echo "tag=$(echo $GITHUB_SHA | cut -c1-7)" >> "$GITHUB_OUTPUT"

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: ./app
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ steps.vars.outputs.tag }}
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest

      - name: Update image tag in deployment manifest
        run: |
          sed -i "s#image: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:.*#image: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ steps.vars.outputs.tag }}#" k8s/deployment.yaml

      - name: Commit and push updated manifest
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add k8s/deployment.yaml
          git diff --cached --quiet && echo "No changes to commit" || (git commit -m "ci: update image tag to ${{ steps.vars.outputs.tag }}" && git push)
```

- [ ] **Step 3: Create the GitHub repo and push**

```bash
gh repo create cp2-cicd-argocd --public --source=. --remote=origin
git branch -M main
git add .gitignore .github/
git commit -m "Add CI workflow: build, push to GHCR, update manifest"
git push -u origin main
```

- [ ] **Step 4: Watch the pipeline run to completion**

```bash
gh run watch --exit-status
```

Expected: exits 0. If it fails, run `gh run view --log-failed` and fix (common causes: missing `permissions:` block, YAML indentation).

- [ ] **Step 5: Verify the image was published**

```bash
gh api /user/packages/container/cp2-app/versions --jq '.[0].metadata.container.tags'
```

Expected: a JSON array containing a 7-char SHA tag and `"latest"`.

- [ ] **Step 6: Make the GHCR package public (token lacks `packages` scope, so use the web UI)**

Use browser automation (claude-in-chrome) to:
1. Navigate to `https://github.com/users/edmariosantos92/packages/container/cp2-app/settings`
2. Scroll to "Danger Zone" → click "Change visibility" → select "Public" → type the package name to confirm → confirm.

Expected: package settings page shows "Public".

- [ ] **Step 7: Pull the latest manifest update the CI bot pushed**

```bash
git pull origin main
```

Expected: `k8s/deployment.yaml` now has `image: ghcr.io/edmariosantos92/cp2-app:<short-sha>` instead of `:latest`.

---

### Task 5: Start Minikube

**Files:** none

**Interfaces:**
- Produces: a running single-node Kubernetes cluster reachable via `kubectl`, consumed by Task 6 (Argo CD install) and Task 7 (Argo CD Application).

- [ ] **Step 1: Start the cluster**

```bash
minikube start --driver=docker
```

Expected: ends with "Done! kubectl is now configured to use \"minikube\" cluster".

- [ ] **Step 2: Verify**

```bash
kubectl get nodes
kubectl cluster-info
```

Expected: one node in `Ready` status; cluster-info prints the control plane URL.

---

### Task 6: Install Argo CD

**Files:** none (installs upstream manifests directly into the cluster)

**Interfaces:**
- Produces: namespace `argocd` with `argocd-server`, `argocd-repo-server`, `argocd-application-controller` pods Running — consumed by Task 7 (creating the `Application`).

- [ ] **Step 1: Install**

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

- [ ] **Step 2: Wait for pods to be ready**

```bash
kubectl wait --for=condition=Available deployment --all -n argocd --timeout=300s
kubectl get pods -n argocd
```

Expected: all pods `Running`/`1/1` or `2/2` Ready.

- [ ] **Step 3: Get the initial admin password**

```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
```

Save this value — needed for Step 5 login.

- [ ] **Step 4: Port-forward the UI (background)**

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

Run this in the background (it must stay up for the rest of the session — use a background shell).

- [ ] **Step 5: Log in with the CLI and verify**

```bash
argocd login localhost:8080 --username admin --password '<password-from-step-3>' --insecure
argocd version
```

Expected: prints client and server version, no auth error.

---

### Task 7: Register the app in Argo CD (GitOps sync)

**Files:**
- Create: `argocd/application.yaml` (kept in the repo for documentation/evidence; applied directly with `kubectl`, not watched by Argo CD itself — only `k8s/` is watched)

**Interfaces:**
- Consumes: repo `https://github.com/edmariosantos92/cp2-cicd-argocd.git`, path `k8s/` (Task 3/4).
- Produces: a synced, healthy `cp2-app` Application whose live state always mirrors `k8s/deployment.yaml` on `main` — this is what Task 8's end-to-end change relies on.

- [ ] **Step 1: Create `argocd/application.yaml`**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: cp2-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/edmariosantos92/cp2-cicd-argocd.git
    targetRevision: main
    path: k8s
  destination:
    server: https://kubernetes.default.svc
    namespace: cp2-app
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

- [ ] **Step 2: Apply it**

```bash
kubectl apply -f argocd/application.yaml
```

- [ ] **Step 3: Wait for sync and verify health**

```bash
argocd app wait cp2-app --sync --health --timeout 180
argocd app get cp2-app
```

Expected: `Sync Status: Synced`, `Health Status: Healthy`.

- [ ] **Step 4: Verify the pod and service exist**

```bash
kubectl get pods -n cp2-app
kubectl get svc -n cp2-app
```

Expected: one `cp2-app-*` pod `Running` `1/1`; one `cp2-app` Service of type `NodePort`.

- [ ] **Step 5: Access the app and confirm the "before" version**

```bash
minikube service cp2-app -n cp2-app --url
curl -s $(minikube service cp2-app -n cp2-app --url) | grep -o '<h2>.*</h2>'
```

Expected: `<h2>Versao: 1.0.0</h2>`.

- [ ] **Step 6: Commit**

```bash
git add argocd/
git commit -m "Add Argo CD Application manifest"
git push
```

(This push does not touch `app/**`, so CI will not re-trigger — expected, by design per the spec's path filter.)

---

### Task 8: End-to-end change: edit, push, watch the full pipeline

**Files:**
- Modify: `app/server.js` (bump displayed version/color via env defaults) — simplest visible change: edit `k8s/deployment.yaml`'s env values would NOT go through CI, so the change must be an **app** change to exercise the whole pipeline.
- Modify: `app/package.json:3` (`"version"` field, e.g. `1.0.0` → `1.1.0`)

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces: proof the automation works — new image built, `k8s/deployment.yaml` auto-updated, Argo CD auto-synced, new version visible in-browser.

- [ ] **Step 1: Make a visible change**

Edit `app/package.json`, change `"version": "1.0.0"` to `"version": "1.1.0"`.

Edit `app/server.js`, change the default color:
```javascript
const APP_COLOR = process.env.APP_COLOR || '#0f766e';
```

- [ ] **Step 2: Commit and push**

```bash
git add app/
git commit -m "Bump app version to 1.1.0 and change background color"
git push
```

- [ ] **Step 3: Watch the new pipeline run**

```bash
gh run watch --exit-status
```

Expected: exits 0 (new run, new SHA tag).

- [ ] **Step 4: Verify the new image tag landed back in the manifest**

```bash
git pull
grep 'image:' k8s/deployment.yaml
```

Expected: shows a new short-SHA tag, different from Task 4 Step 7's.

- [ ] **Step 5: Watch Argo CD pick it up and sync**

```bash
argocd app get cp2-app --refresh
argocd app wait cp2-app --sync --health --timeout 180
```

Expected: `Sync Status: Synced` at the new revision (`argocd app get cp2-app` shows the new commit SHA under `Repo`/`Revision`).

- [ ] **Step 6: Confirm the new pod is running the new image and the app shows the change**

```bash
kubectl get pods -n cp2-app -o jsonpath='{.items[0].spec.containers[0].image}{"\n"}'
curl -s $(minikube service cp2-app -n cp2-app --url) | grep -o '<h2>.*</h2>'
```

Expected: image ends with the new SHA tag; response shows `<h2>Versao: 1.1.0</h2>` and (visually, in a browser) the teal background.

---

### Task 9: Capture evidence

**Files:**
- Create: `evidencias/` (screenshots, numbered per the assignment's required-evidence list)

**Interfaces:**
- Consumes: live state from Tasks 5–8 (cluster, repo, Actions runs, GHCR package, Argo CD UI).
- Produces: the 12 screenshots the assignment lists as mandatory.

- [ ] **Step 1: Create the folder**

```bash
mkdir -p evidencias
```

- [ ] **Step 2: Capture CLI-based evidence as text+screenshot pairs**

Run each and screenshot the terminal output:
```bash
kubectl get nodes                    # 01-cluster-k8s-funcionando
kubectl get pods -n cp2-app -o wide  # 08-pods-servicos-k8s
kubectl get svc -n cp2-app
```

- [ ] **Step 3: Capture browser-based evidence using claude-in-chrome**

Navigate to and screenshot each:
1. `https://github.com/edmariosantos92/cp2-cicd-argocd` → **02-repositorio-github**
2. `https://github.com/edmariosantos92/cp2-cicd-argocd/actions` (workflow list) → **03-pipeline-github-actions**
3. The successful run from Task 4 Step 4 → **04-pipeline-executada-com-sucesso**
4. `https://github.com/edmariosantos92/cp2-cicd-argocd/pkgs/container/cp2-app` → **05-imagem-publicada-registry**
5. `https://localhost:8080` (Argo CD UI, logged in) → **06-argocd-instalado-funcionando**
6. The `cp2-app` Application detail/sync-tree view → **07-app-cadastrada-sincronizada-argocd**
7. The app URL from Task 7 Step 5 (before change, teal-less/dark version) → **09-app-funcionando-antes**
8. The new Actions run from Task 8 Step 3 → **10-nova-execucao-pipeline**
9. Argo CD Application view showing the new synced revision → **11-atualizacao-argocd**
10. The app URL from Task 8 Step 6 (after change, new color/version) → **12-app-funcionando-nova-versao**

Save each screenshot into `evidencias/` with the numbered filename above.

---

### Task 10: Write the report

**Files:**
- Create: `relatorio/relatorio-cp2.docx`

**Interfaces:**
- Consumes: `evidencias/*` (Task 9), repo URL, environment facts from Tasks 1–8.
- Produces: the final PDF-ready deliverable for Teams submission.

- [ ] **Step 1: Draft content answering the assignment's 8 questions**

Cover, in order: ambiente utilizado (Minikube local via Docker driver, Windows); função do GitHub Actions (CI: build+push da imagem, atualização do manifesto); Container Registry utilizado (GitHub Container Registry); função do Argo CD (CD: sincroniza o cluster com o estado declarado no Git); o que é GitOps (Git como fonte única de verdade do estado desejado, com reconciliação automática); diferença entre CI e CD nesta atividade (CI = GitHub Actions builda/publica a imagem e atualiza o manifesto; CD = Argo CD detecta a mudança no Git e aplica no cluster); o que aconteceu depois do push (pipeline disparou, nova imagem publicada, manifesto atualizado via commit automático, Argo CD sincronizou, pod recriado com a nova imagem); dificuldades encontradas e soluções (preencher com o que realmente ocorreu durante a execução das Tasks 1–8 — ex.: visibilidade do pacote GHCR, tempo de start do Minikube, etc.).

- [ ] **Step 2: Assemble the .docx** with team names/RM (Edmário Santos RM565486, Kauê Lima RM562071), repo link (`https://github.com/edmariosantos92/cp2-cicd-argocd`), the answers from Step 1, all 12 images from `evidencias/` in order, and a short conclusion.

- [ ] **Step 3: Export/verify as PDF-ready** and confirm all 12 images are legible at normal zoom before marking this task done.
