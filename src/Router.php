<?php

declare(strict_types=1);

namespace ApiTeste;

use Closure;
use DateTimeImmutable;
use DateTimeZone;
use Throwable;

/**
 * Roteador da API. A lógica toda vive em handle(): uma função pura de Request para Response,
 * que pode ser testada sem servidor HTTP.
 */
final class Router
{
    public const string VERSAO = 'v1';
    public const string VERSAO_API = '1.0.0';
    private const string PREFIXO = '/api/v1';
    private const string METODOS = 'GET, HEAD, OPTIONS';
    private const string CACHE_PUBLICO = 'public, max-age=60';

    private readonly Closure $relogio;
    private readonly Closure $registrar;

    /**
     * @param Closure(): DateTimeImmutable|null $relogio  Fonte de horário (injetável nos testes).
     * @param Closure(string): void|null $registrar       Destino do log de erros internos.
     */
    public function __construct(
        private readonly Mensagens $mensagens = new Mensagens(),
        ?Closure $relogio = null,
        ?Closure $registrar = null,
    ) {
        $this->relogio = $relogio ?? static fn(): DateTimeImmutable => new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $this->registrar = $registrar ?? static function (string $texto): void {
            error_log($texto);
        };
    }

    public function handle(Request $request): Response
    {
        try {
            $resposta = $this->despachar($request);
        } catch (Throwable $erro) {
            // O detalhe fica só no log do servidor; o cliente recebe uma mensagem genérica.
            ($this->registrar)(sprintf(
                '[API-TESTE] %s: %s em %s:%d',
                $erro::class,
                $erro->getMessage(),
                $erro->getFile(),
                $erro->getLine(),
            ));
            $resposta = Problema::erroInterno($request->path)->paraResposta();
        }

        return $this->finalizar($request, $resposta);
    }

    private function despachar(Request $request): Response
    {
        $caminho = $this->normalizar($request->path);
        $rota = $this->resolver($caminho);

        if ($rota === null) {
            return Problema::rotaNaoEncontrada($request->path)->paraResposta();
        }

        if ($request->method === 'OPTIONS') {
            return Response::vazia(204, [
                'Allow' => self::METODOS,
                'Access-Control-Allow-Methods' => self::METODOS,
                'Cache-Control' => 'no-store',
            ]);
        }

        if ($request->method !== 'GET' && $request->method !== 'HEAD') {
            return Problema::metodoNaoPermitido($request->path)->paraResposta(['Allow' => self::METODOS]);
        }

        return match ($rota['nome']) {
            'raiz' => $this->raiz(),
            'status' => $this->status(),
            'mensagens' => $this->listarMensagens(),
            default => $this->mostrarMensagem($rota['id'], $request->path),
        };
    }

    /**
     * Remove uma única barra final, para que /api/v1/status/ funcione como /api/v1/status.
     */
    private function normalizar(string $caminho): string
    {
        return strlen($caminho) > 1 && str_ends_with($caminho, '/') ? substr($caminho, 0, -1) : $caminho;
    }

    /**
     * @return array{nome: string, id: string}|null
     */
    private function resolver(string $caminho): ?array
    {
        if ($caminho === self::PREFIXO) {
            return ['nome' => 'raiz', 'id' => ''];
        }

        if (!str_starts_with($caminho, self::PREFIXO . '/')) {
            return null;
        }

        $resto = substr($caminho, strlen(self::PREFIXO));

        return match (true) {
            $resto === '/status' => ['nome' => 'status', 'id' => ''],
            $resto === '/mensagens' => ['nome' => 'mensagens', 'id' => ''],
            (bool) preg_match('#^/mensagens/([^/]*)$#D', $resto, $achado) => ['nome' => 'mensagem', 'id' => $achado[1]],
            default => null,
        };
    }

    private function raiz(): Response
    {
        return Response::json(200, [
            'nome' => 'API-TESTE',
            'versao' => self::VERSAO_API,
            'descricao' => 'API de demonstração em PHP com respostas JSON e erros padronizados.',
            'rotas' => [
                'GET /api/v1/status',
                'GET /api/v1/mensagens',
                'GET /api/v1/mensagens/{id}',
            ],
        ], ['Cache-Control' => self::CACHE_PUBLICO]);
    }

    private function status(): Response
    {
        $agora = ($this->relogio)()->setTimezone(new DateTimeZone('UTC'));

        return Response::json(200, [
            'status' => 'ok',
            'mensagem' => 'A API está no ar.',
            'versao' => self::VERSAO_API,
            'horario' => $agora->format('Y-m-d\TH:i:s\Z'),
        ], ['Cache-Control' => 'no-store']);
    }

    private function listarMensagens(): Response
    {
        return Response::json(200, [
            'total' => $this->mensagens->total(),
            'mensagens' => $this->mensagens->todas(),
        ], ['Cache-Control' => self::CACHE_PUBLICO]);
    }

    private function mostrarMensagem(string $id, string $caminho): Response
    {
        // Somente inteiros positivos canônicos: rejeita 0, negativos, "abc", "1.5" e "01".
        if (preg_match('/^[1-9][0-9]*$/D', $id) !== 1) {
            return Problema::idInvalido($caminho)->paraResposta();
        }

        // Números enormes não cabem em int: não existem no catálogo.
        $mensagem = strlen($id) <= 9 ? $this->mensagens->buscar((int) $id) : null;

        if ($mensagem === null) {
            return Problema::mensagemNaoEncontrada($id, $this->mensagens->total(), $caminho)->paraResposta();
        }

        return Response::json(200, $mensagem, ['Cache-Control' => self::CACHE_PUBLICO]);
    }

    /**
     * Cabeçalhos comuns a todas as respostas; HEAD perde o corpo e mantém o resto.
     */
    private function finalizar(Request $request, Response $resposta): Response
    {
        $resposta = $resposta->comCabecalho('X-Content-Type-Options', 'nosniff');

        if (in_array($request->method, ['GET', 'HEAD', 'OPTIONS'], true)) {
            $resposta = $resposta->comCabecalho('Access-Control-Allow-Origin', '*');
        }

        return $request->method === 'HEAD' ? $resposta->semCorpo() : $resposta;
    }
}
