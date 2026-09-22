# CP2: CI/CD com GitHub Actions e Argo CD — Design

## Contexto

Atividade acadêmica (CP2, 2º semestre) que exige demonstrar um pipeline
GitOps completo: build/push de imagem via GitHub Actions e deploy
automático via Argo CD num cluster Kubernetes local (Minikube).

Equipe: Edmário Santos (RM565486), Kauê Lima (RM562071).

## Objetivo

Ter um fluxo reproduzível onde um `git push` para a branch principal:
1. dispara o GitHub Actions,
2. builda e publica uma imagem Docker no GHCR,
3. atualiza a tag da imagem no manifesto Kubernetes (commit de volta ao repo),
4. o Argo CD detecta a mudança no repo e sincroniza o cluster automaticamente.

## Componentes

### 1. Aplicação (`app/`)
- Node.js + Express, uma única rota `GET /` que renderiza HTML inline
  mostrando título, versão (`process.env.APP_VERSION`, default lida de
  `package.json`) e uma cor de fundo configurável.
- `Dockerfile` multi-stage baseado em `node:20-alpine`, non-root user,
  `EXPOSE 3000`.
- Sem testes automatizados (fora de escopo do enunciado) — validação é
  manual via `curl`/browser.

### 2. Repositório GitHub
- Público, criado via `gh repo create cp2-cicd-argocd --public --source=. `.
- Branch principal: `main`.

### 3. Pipeline CI (`.github/workflows/ci.yml`)
- Trigger: `push` em `main` com paths filtrando `app/**` e `k8s/**` (evita
  loop infinito quando o próprio job commita a nova tag).
- Steps: checkout → `docker/setup-buildx-action` → login no `ghcr.io`
  com `GITHUB_TOKEN` (`permissions: packages: write`) →
  build+push da imagem taggeada `ghcr.io/<owner>/cp2-app:<short-sha>` e
  `:latest` → `sed`/`yq` substitui a tag em `k8s/deployment.yaml` →
  commit e push de volta ao repo (`git-auto-commit-action` ou `git`
  manual com `GITHUB_TOKEN`), usando `[skip ci]` implícito via path
  filter para não recursar.

### 4. Manifests Kubernetes (`k8s/`)
- `deployment.yaml`: 1 réplica, imagem `ghcr.io/<owner>/cp2-app:<tag>`,
  `imagePullPolicy: IfNotPresent`, `livenessProbe`/`readinessProbe` em `/`.
- `service.yaml`: tipo `NodePort`, porta 80 → targetPort 3000.
- Namespace dedicado `cp2-app` (evita colidir com `argocd`/`default`).

### 5. Cluster (Minikube)
- `minikube start --driver=docker`.
- Exposição via `minikube service cp2-app -n cp2-app` (NodePort/túnel
  automático) conforme observação do enunciado.

### 6. Argo CD
- Instalado no namespace `argocd` via manifests oficiais
  (`install.yaml` do release estável).
- Acesso à UI via `kubectl port-forward svc/argocd-server -n argocd
  8080:443`.
- `Application` (`argocd/application.yaml`) apontando para o repo
  GitHub, path `k8s/`, `targetRevision: main`, `syncPolicy.automated`
  com `selfHeal: true` e `prune: true` — sincronização 100% automática,
  sem intervenção manual após o setup inicial.

## Fluxo de dados

```
push (app change) → GitHub Actions (build+push image, bump tag in k8s/)
   → push (bot commit) → Argo CD detecta diff no repo (poll ~3min ou
   webhook) → Argo CD aplica k8s/ no cluster → novo Pod sobe →
   Service expõe → app atualizada acessível
```

## Tratamento de erros / pontos de atenção

- Job de CI usa `permissions: contents: write, packages: write`
  explícitos (necessário pro commit de volta e push da imagem).
- Path filter no trigger evita loop CI→commit→CI infinito.
- `imagePullPolicy: IfNotPresent` + tag por SHA (não só `latest`) garante
  que o Argo CD só reaplica quando a tag realmente muda.
- Se o Docker Desktop não estiver rodando, `minikube start` falha cedo
  com erro claro — validar `docker info` antes.

## Evidências e relatório

- Screenshots organizados em `evidencias/` (numeradas na ordem do
  enunciado).
- Relatório final em `relatorio/relatorio-cp2.docx` (ou `.pdf`) com
  respostas às 8 perguntas do enunciado, nomes/RM da equipe, link do
  repo, e conclusão — gerado ao final, depois que o fluxo estiver
  validado ponta a ponta.

## Testing / validação end-to-end

1. Deploy inicial funcionando (app acessível via `minikube service`).
2. Alteração visível (ex.: mudar `APP_VERSION` e cor) → commit → push.
3. Acompanhar Actions run completo (sucesso).
4. Confirmar nova imagem no pacote GHCR do repo.
5. Confirmar Argo CD sincronizou (`Synced`/`Healthy`, revisão nova).
6. Acessar app novamente e confirmar mudança visível.
