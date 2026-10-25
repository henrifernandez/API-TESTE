# API-TESTE

API de demonstração em PHP 8.4, sem dependências de produção, que responde em JSON e devolve erros padronizados no formato Problem Details (RFC 9457). Acompanha um console web para testar as rotas e ver o status HTTP, o tempo de resposta e o JSON devolvido.

Demonstração: https://apiteste-nine.vercel.app

## Rotas

Todas as rotas aceitam `GET`, `HEAD` e `OPTIONS`. A versão atual da API é `1.0.0`. A especificação completa está em [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1).

| Método | Rota | Descrição | Cache |
| --- | --- | --- | --- |
| GET | `/api/v1` | Descreve a API e lista as rotas | `public, max-age=60` |
| GET | `/api/v1/status` | Informa que a API está no ar, com o horário do servidor em UTC | `no-store` |
| GET | `/api/v1/mensagens` | Lista as mensagens | `public, max-age=60` |
| GET | `/api/v1/mensagens/{id}` | Busca uma mensagem pelo id (1 a 3) | `public, max-age=60` |

Uma barra final também funciona (`/api/v1/status/`).

### Exemplos

As respostas abaixo foram geradas rodando o servidor local deste repositório.

```bash
curl -s http://localhost:8080/api/v1/status
```

```json
{
    "status": "ok",
    "mensagem": "A API está no ar.",
    "versao": "1.0.0",
    "horario": "2026-10-24T23:55:32Z"
}
```

```bash
curl -s http://localhost:8080/api/v1
```

```json
{
    "nome": "API-TESTE",
    "versao": "1.0.0",
    "descricao": "API de demonstração em PHP com respostas JSON e erros padronizados.",
    "rotas": [
        "GET /api/v1/status",
        "GET /api/v1/mensagens",
        "GET /api/v1/mensagens/{id}"
    ]
}
```

```bash
curl -s http://localhost:8080/api/v1/mensagens/2
```

```json
{
    "id": 2,
    "titulo": "Respostas em JSON",
    "texto": "Toda resposta usa JSON em UTF-8, com o código de status HTTP que corresponde ao resultado."
}
```

`GET /api/v1/mensagens` devolve `{"total": 3, "mensagens": [...]}` com as três mensagens.

## Erros

Todo erro usa `application/problem+json`, com os campos `type`, `title`, `status`, `detail`, `instance` (o caminho da requisição) e o campo extra `codigo`, que é estável e pensado para ser lido por programas.

```bash
curl -s http://localhost:8080/api/v1/mensagens/99
```

```json
{
    "type": "about:blank",
    "title": "Mensagem não encontrada",
    "status": 404,
    "detail": "Não existe mensagem com id 99. Os ids válidos vão de 1 a 3.",
    "instance": "/api/v1/mensagens/99",
    "codigo": "MENSAGEM_NAO_ENCONTRADA"
}
```

| Status | `codigo` | Quando acontece |
| --- | --- | --- |
| 400 | `ID_INVALIDO` | O id não é um inteiro positivo (`0`, `-1`, `abc`, `1.5`, `01`) |
| 404 | `ROTA_NAO_ENCONTRADA` | A rota não existe |
| 404 | `MENSAGEM_NAO_ENCONTRADA` | O id é válido, mas não existe mensagem com ele |
| 405 | `METODO_NAO_PERMITIDO` | Método diferente de `GET`, `HEAD` e `OPTIONS` (cabeçalho `Allow: GET, HEAD, OPTIONS`) |
| 500 | `ERRO_INTERNO` | Exceção não tratada. O detalhe vai só para o log do servidor (`error_log`), nunca para o cliente |

### Cabeçalhos

- `X-Content-Type-Options: nosniff` em todas as respostas.
- `Cache-Control: public, max-age=60` na raiz da API e nas mensagens; `no-store` no status e em todos os erros.
- CORS: `Access-Control-Allow-Origin: *` apenas em `GET`, `HEAD` e `OPTIONS`. `OPTIONS` responde `204` com `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`.
- `HEAD` devolve os mesmos cabeçalhos do `GET`, sem corpo.
- O `Content-Type` inclui `charset=utf-8` (`application/json; charset=utf-8` e `application/problem+json; charset=utf-8`).

## Como rodar

Requisitos: PHP 8.4 (com `mbstring`) e Composer. O Composer só é necessário para desenvolvimento; a API em si não tem dependências.

```bash
composer install
php -S localhost:8080 router.php
```

Abra http://localhost:8080 para o console ou http://localhost:8080/api/v1 para a API. O `router.php` emula o roteamento do `vercel.json`: `/api/(.*)` vai para `api/index.php` e o resto é servido como arquivo estático.

Sem `vendor/`, a API continua funcionando: `api/index.php` usa um autoloader próprio de poucas linhas. É o que acontece no deploy, que não executa o Composer.

## Testes e qualidade

```bash
composer test    # PHPUnit: rotas, erros, cabeçalhos, HEAD, OPTIONS, 405, ids inválidos, erro interno e contrato OpenAPI
composer lint    # php-cs-fixer em modo dry-run
composer stan    # PHPStan, nível 6
composer check   # lint + stan + test
```

O teste de contrato lê o `openapi.yaml` e confere que toda rota documentada existe e que cada exemplo é idêntico à resposta real.

A verificação de acessibilidade usa axe-core com Playwright (tags `wcag2a`, `wcag2aa`, `wcag21aa` e `wcag22aa`) e roda no GitHub Actions (`.github/workflows/ci.yml`). Para rodar localmente, com o servidor no ar:

```bash
cd tests/a11y
npm ci
npx playwright install chromium
BASE_URL=http://localhost:8080 npm run axe
```

## Arquitetura

```
api/index.php        entrada única; carrega o autoloader e envia a resposta
src/Request.php      método e caminho da requisição
src/Response.php     status, cabeçalhos e corpo (JSON sem escapar Unicode)
src/Router.php       handle(Request): Response, uma função pura testável sem servidor
src/Problema.php     erros no formato Problem Details
src/Mensagens.php    catálogo fixo das 3 mensagens
router.php           roteador para desenvolvimento local
index.html + assets  console web (sem CSS ou JS inline, sem CDN)
```

O `Router::handle()` recebe um `Request` e devolve um `Response`, sem tocar em superglobais, o que permite testar tudo sem subir servidor. O horário e o destino do log de erros são injetáveis.

## Console web e acessibilidade

O console (`index.html`, `assets/css/app.css`, `assets/js/*.js`) chama as rotas com `fetch` e mostra método, URL, status HTTP, tempo em ms e o JSON formatado. O resultado é anunciado por uma única região `role="status"`, de uma vez só.

O visualizador é uma cena em Three.js 0.186.1, guardada localmente em `assets/vendor/three/` (licença MIT, veja `VERSION.txt`). O servidor é um núcleo em wireframe ciano com duas órbitas, o cliente é um octaedro âmbar, e há um campo de estrelas ao fundo. Uma curva liga os dois: enquanto a requisição está em trânsito, um pacote âmbar viaja por ela. Quando a resposta chega, o pacote entra no núcleo, que brilha em ciano em respostas 2xx ou pisca em vermelho com um tremor de cerca de 600 ms em 4xx, 5xx e falhas de rede, e depois volta ao repouso. A câmera acompanha o mouse com um parallax suave (desligado em movimento reduzido e com a animação pausada). A cena fica em `assets/js/cena.js`, e `assets/js/visual.js` decide entre ela e o quadro estático.

Cuidados de acessibilidade (meta: WCAG 2.2 AA):

- Com `prefers-reduced-motion: reduce` ou sem WebGL, o console mostra um SVG estático do núcleo wireframe com órbitas (cor e forma mudam, nada se move) e o Three.js nem é baixado.
- O botão "Pausar animação" / "Retomar animação" é operável por teclado, e a animação também pausa quando a aba fica oculta.
- Os botões ficam desabilitados com `aria-busy` durante a requisição, e o foco volta ao botão usado.
- O `<canvas>` é `aria-hidden`, a página tem `lang="pt-BR"`, um único `h1`, landmark `main`, foco visível e alvos de pelo menos 24 px.

Se a requisição falhar por rede, a tela mostra: "Não foi possível falar com a API. Verifique sua conexão e tente de novo."

## Deploy

O projeto é publicado na Vercel. Como a Vercel não executa PHP por conta própria, o `vercel.json` usa o runtime comunitário [`vercel-php`](https://github.com/vercel-community/php) na versão `0.8.0` (PHP 8.4). Ele não é mantido pela Vercel.

```json
{
  "functions": { "api/index.php": { "runtime": "vercel-php@0.8.0" } },
  "routes": [{ "src": "/api/(.*)", "dest": "/api/index.php" }]
}
```

Pontos de atenção:

- Nas configurações do projeto na Vercel, a versão do Node.js precisa ser **22.x**, que é a versão que o runtime documenta.
- O `.vercelignore` exclui `vendor/`, `tests/`, `.github/` e `node_modules/` do envio. Por isso o deploy usa o autoloader próprio de `api/index.php`.
- Arquivos do repositório fora de `api/` são servidos como estáticos pela Vercel, inclusive o código em `src/`. Este projeto não guarda segredos, mas lembre disso antes de colocar qualquer coisa sensível nele.

## Licença

MIT, veja [`LICENSE`](LICENSE). O Three.js, em `assets/vendor/three/`, tem licença MIT própria (`assets/vendor/three/LICENSE`).
