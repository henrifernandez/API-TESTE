<?php

declare(strict_types=1);

namespace ApiTeste;

/**
 * Representação mínima de uma requisição HTTP, independente de servidor.
 */
final readonly class Request
{
    public string $method;

    public function __construct(string $method, public string $path)
    {
        $this->method = strtoupper($method);
    }

    /**
     * Monta a requisição a partir das superglobais do PHP.
     *
     * @param array<string, mixed>|null $server
     */
    public static function fromGlobals(?array $server = null): self
    {
        $server ??= $_SERVER;

        $method = is_string($server['REQUEST_METHOD'] ?? null) ? $server['REQUEST_METHOD'] : 'GET';
        $uri = is_string($server['REQUEST_URI'] ?? null) ? $server['REQUEST_URI'] : '/';

        // Remove query string e fragmento sem decodificar o caminho.
        $path = strtok($uri, '?#');

        return new self($method, $path === false || $path === '' ? '/' : $path);
    }
}
