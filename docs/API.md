# Cloudflare Solver API

HTTP proxy API que resolve challenges Cloudflare via browser e executa requests com fingerprint TLS de Chrome.

**Base URL:** `http://127.0.0.1:3000`

**Documentação markdown:** `GET /api/docs`

---

## Endpoints

### `GET /`

Status dos serviços.

**Resposta**

```json
{
  "path": "/",
  "status": 200,
  "proxyService": {
    "isRunning": true,
    "port": 8080
  },
  "browserService": {
    "isRunning": true
  },
  "api": {
    "docs": "/api/docs",
    "request": "/api/request"
  }
}
```

---

### `POST /api/request`

Executa uma requisição HTTP para a URL informada.

**Body (JSON)**

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `url` | `string` | sim | URL completa do destino |
| `method` | `string` | não | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` (padrão: `GET`) |
| `headers` | `object` | não | Headers enviados ao destino |
| `body` | `string \| object \| array` | não | Body da requisição. Objetos são serializados como JSON |
| `forceRefresh` | `boolean` | não | Força nova resolução Cloudflare para o domínio |

**Exemplo — GET**

```bash
curl -X POST http://127.0.0.1:3000/api/request \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://genztoons.org/series/the-lord-s-coins-aren-t-decreasing/",
    "method": "GET"
  }'
```

**Exemplo — POST com JSON**

```bash
curl -X POST http://127.0.0.1:3000/api/request \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/api/login",
    "method": "POST",
    "headers": {
      "Content-Type": "application/json"
    },
    "body": {
      "email": "user@example.com",
      "password": "secret"
    }
  }'
```

**Exemplo — PUT**

```bash
curl -X POST http://127.0.0.1:3000/api/request \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/api/user/1",
    "method": "PUT",
    "headers": {
      "Content-Type": "application/json"
    },
    "body": {
      "name": "Vinícius"
    }
  }'
```

**Exemplo — forçar nova sessão Cloudflare**

```bash
curl -X POST http://127.0.0.1:3000/api/request \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://genztoons.org/",
    "method": "GET",
    "forceRefresh": true
  }'
```

**Resposta de sucesso**

```json
{
  "path": "/api/request",
  "status": 200,
  "upstream": {
    "status": 200,
    "headers": {
      "content-type": "text/html; charset=utf-8"
    },
    "body": "<!DOCTYPE html>..."
  },
  "durationMs": 842
}
```

---

### `GET /api/request`

Atalho para requests `GET`. Útil para testes rápidos.

**Query params**

| Param | Obrigatório | Descrição |
|---|---|---|
| `url` | sim | URL de destino |
| `forceRefresh` | não | `true` para refazer sessão Cloudflare |

**Headers opcionais**

Envie headers para o destino prefixando com `x-forward-`:

```bash
curl "http://127.0.0.1:3000/api/request?url=https://genztoons.org/" \
  -H "x-forward-accept: text/html"
```

---

## Comportamento Cloudflare

- A **primeira request** de um domínio abre o browser, resolve o Turnstile e cacheia cookies + sessão TLS.
- Requests seguintes do **mesmo domínio** usam cache e podem rodar **em paralelo**.
- Apenas **1 domínio** é resolvido por vez no browser quando não há cache.
- Se a resposta for `403` com página `Just a moment...`, a sessão é refeita automaticamente.

---

## Erros

| HTTP | Situação |
|---|---|
| `400` | URL inválida, body malformado ou method não suportado |
| `503` | Browser ainda não conectou |
| `500` | Erro interno na execução da request |

**Exemplo**

```json
{
  "path": "/api/request",
  "status": 400,
  "message": "Field 'url' is required"
}
```

---

## Iniciar o servidor

```bash
yarn build
yarn start:prod
# ou em dev:
yarn start
```

**Variáveis de ambiente**

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta da API Express |

---

## Docker

Imagem com **Node 20**, **Google Chrome**, **Xvfb** e dependências do Puppeteer.

```bash
yarn build
docker build --platform linux/amd64 -t cloudflare-solver .
docker run --platform linux/amd64 -p 3000:3000 --shm-size=1g cloudflare-solver
```

Ou com Compose:

```bash
docker compose up --build
```

O `puppeteer-real-browser` inicia o Xvfb automaticamente no Linux. A imagem inclui `xvfb`, Chrome e libs gráficas necessárias.

---

## Limitações

- Respostas são retornadas como **texto** (`body` string).
- Body da API aceita até **10 MB**.
- Métodos suportados: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
