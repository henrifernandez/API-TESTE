<?php

declare(strict_types=1);

namespace ApiTeste;

/**
 * Resposta HTTP imutável: status, cabeçalhos e corpo.
 */
final readonly class Response
{
    private const int FLAGS_JSON = JSON_UNESCAPED_UNICODE
        | JSON_UNESCAPED_SLASHES
        | JSON_PRETTY_PRINT
        | JSON_INVALID_UTF8_SUBSTITUTE
        | JSON_PARTIAL_OUTPUT_ON_ERROR;

    /**
     * @param array<string, string> $headers
     */
    public function __construct(
        public int $status,
        public array $headers = [],
        public string $body = '',
    ) {
    }

    /**
     * @param array<mixed> $data
     * @param array<string, string> $headers
     */
    public static function json(
        int $status,
        array $data,
        array $headers = [],
        string $contentType = 'application/json; charset=utf-8',
    ): self {
        $body = (json_encode($data, self::FLAGS_JSON) ?: '{}') . "\n";

        return new self($status, [
            'Content-Type' => $contentType,
            'Content-Length' => (string) strlen($body),
        ] + $headers, $body);
    }

    /**
     * @param array<string, string> $headers
     */
    public static function vazia(int $status, array $headers = []): self
    {
        return new self($status, $headers);
    }

    public function comCabecalho(string $nome, string $valor): self
    {
        return new self($this->status, [$nome => $valor] + $this->headers, $this->body);
    }

    /**
     * Mantém status e cabeçalhos (inclusive Content-Length), mas remove o corpo, como exige o HEAD.
     */
    public function semCorpo(): self
    {
        return new self($this->status, $this->headers, '');
    }

    /**
     * Envia a resposta ao cliente usando as funções nativas do PHP.
     */
    public function enviar(): void
    {
        if (!headers_sent()) {
            header_remove('X-Powered-By');
            http_response_code($this->status);
            foreach ($this->headers as $nome => $valor) {
                header($nome . ': ' . $valor);
            }
        }

        echo $this->body;
    }
}
