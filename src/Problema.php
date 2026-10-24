<?php

declare(strict_types=1);

namespace ApiTeste;

/**
 * Erro no formato Problem Details (RFC 9457), com o campo extra "codigo".
 */
final readonly class Problema
{
    public const string TIPO_MIDIA = 'application/problem+json; charset=utf-8';

    private function __construct(
        public int $status,
        public string $codigo,
        public string $titulo,
        public string $detalhe,
        public string $instancia,
    ) {
    }

    public static function rotaNaoEncontrada(string $caminho): self
    {
        $caminho = self::limpar($caminho);

        return new self(
            404,
            'ROTA_NAO_ENCONTRADA',
            'Rota não encontrada',
            "A rota {$caminho} não existe. Consulte GET /api/v1 para ver as rotas disponíveis.",
            $caminho,
        );
    }

    public static function mensagemNaoEncontrada(string $id, int $total, string $caminho): self
    {
        return new self(
            404,
            'MENSAGEM_NAO_ENCONTRADA',
            'Mensagem não encontrada',
            "Não existe mensagem com id {$id}. Os ids válidos vão de 1 a {$total}.",
            self::limpar($caminho),
        );
    }

    public static function idInvalido(string $caminho): self
    {
        return new self(
            400,
            'ID_INVALIDO',
            'Identificador inválido',
            'O id deve ser um número inteiro positivo, por exemplo /api/v1/mensagens/1.',
            self::limpar($caminho),
        );
    }

    public static function metodoNaoPermitido(string $caminho): self
    {
        $caminho = self::limpar($caminho);

        return new self(
            405,
            'METODO_NAO_PERMITIDO',
            'Método não permitido',
            "A rota {$caminho} aceita apenas GET e HEAD.",
            $caminho,
        );
    }

    public static function erroInterno(string $caminho): self
    {
        return new self(
            500,
            'ERRO_INTERNO',
            'Erro interno',
            'Ocorreu um erro inesperado no servidor. Tente novamente em instantes.',
            self::limpar($caminho),
        );
    }

    /**
     * @param array<string, string> $cabecalhos
     */
    public function paraResposta(array $cabecalhos = []): Response
    {
        return Response::json($this->status, [
            'type' => 'about:blank',
            'title' => $this->titulo,
            'status' => $this->status,
            'detail' => $this->detalhe,
            'instance' => $this->instancia,
            'codigo' => $this->codigo,
        ], ['Cache-Control' => 'no-store'] + $cabecalhos, self::TIPO_MIDIA);
    }

    /**
     * Torna o caminho seguro para exibir: UTF-8 válido, sem bytes de controle e com tamanho limitado.
     */
    private static function limpar(string $caminho): string
    {
        $caminho = mb_scrub($caminho, 'UTF-8');
        $caminho = (string) preg_replace('/[\x00-\x1F\x7F]+/u', '', $caminho);

        if (mb_strlen($caminho) > 200) {
            $caminho = mb_substr($caminho, 0, 200) . '…';
        }

        return $caminho === '' ? '/' : $caminho;
    }
}
