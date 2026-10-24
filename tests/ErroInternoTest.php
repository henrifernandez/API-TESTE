<?php

declare(strict_types=1);

namespace ApiTeste\Tests;

use ApiTeste\Mensagens;
use ApiTeste\Request;
use ApiTeste\Router;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use TypeError;

final class ErroInternoTest extends TestCase
{
    private const string SEGREDO = 'senha-do-banco-e-caminho-C:\\interno';

    /** @var list<string> */
    private array $registros = [];

    private function roteadorComRelogioQuebrado(\Throwable $erro): Router
    {
        return new Router(
            relogio: static function () use ($erro): DateTimeImmutable {
                throw $erro;
            },
            registrar: function (string $texto): void {
                $this->registros[] = $texto;
            },
        );
    }

    public function testExcecaoNaoTratadaViraErro500Padronizado(): void
    {
        $roteador = $this->roteadorComRelogioQuebrado(new RuntimeException(self::SEGREDO));

        $resposta = $roteador->handle(new Request('GET', '/api/v1/status'));

        self::assertSame(500, $resposta->status);
        self::assertSame('application/problem+json; charset=utf-8', $resposta->headers['Content-Type']);
        self::assertSame('no-store', $resposta->headers['Cache-Control']);
        self::assertSame('nosniff', $resposta->headers['X-Content-Type-Options']);
        self::assertSame([
            'type' => 'about:blank',
            'title' => 'Erro interno',
            'status' => 500,
            'detail' => 'Ocorreu um erro inesperado no servidor. Tente novamente em instantes.',
            'instance' => '/api/v1/status',
            'codigo' => 'ERRO_INTERNO',
        ], json_decode($resposta->body, true));
    }

    public function testNaoVazaMensagemNemStackParaOCliente(): void
    {
        $roteador = $this->roteadorComRelogioQuebrado(new RuntimeException(self::SEGREDO));

        $resposta = $roteador->handle(new Request('GET', '/api/v1/status'));

        foreach ([self::SEGREDO, 'RuntimeException', 'ErroInternoTest', '.php', 'Stack trace', '#0'] as $trecho) {
            self::assertStringNotContainsString($trecho, $resposta->body);
            self::assertStringNotContainsString($trecho, json_encode($resposta->headers, JSON_THROW_ON_ERROR));
        }
    }

    public function testRegistraOErroNoLogDoServidor(): void
    {
        $roteador = $this->roteadorComRelogioQuebrado(new RuntimeException(self::SEGREDO));

        $roteador->handle(new Request('GET', '/api/v1/status'));

        self::assertCount(1, $this->registros);
        self::assertStringContainsString(self::SEGREDO, $this->registros[0]);
        self::assertStringContainsString('RuntimeException', $this->registros[0]);
    }

    public function testCapturaErrorDoPhpAlemDeException(): void
    {
        $roteador = $this->roteadorComRelogioQuebrado(new TypeError(self::SEGREDO));

        $resposta = $roteador->handle(new Request('GET', '/api/v1/status'));

        self::assertSame(500, $resposta->status);
        self::assertStringNotContainsString(self::SEGREDO, $resposta->body);
        self::assertCount(1, $this->registros);
    }

    public function testFalhaNoCatalogoTambemViraErro500(): void
    {
        $catalogo = new class extends Mensagens {
            public function todas(): array
            {
                throw new RuntimeException(ErroInternoTest::class . ' segredo');
            }
        };
        $roteador = new Router($catalogo, registrar: function (string $texto): void {
            $this->registros[] = $texto;
        });

        $resposta = $roteador->handle(new Request('GET', '/api/v1/mensagens'));

        self::assertSame(500, $resposta->status);
        self::assertStringNotContainsString('segredo', $resposta->body);
        self::assertSame('ERRO_INTERNO', json_decode($resposta->body, true)['codigo']);
    }

    public function testErro500EmHeadNaoTemCorpoEMantemCabecalhos(): void
    {
        $roteador = $this->roteadorComRelogioQuebrado(new RuntimeException(self::SEGREDO));

        $resposta = $roteador->handle(new Request('HEAD', '/api/v1/status'));

        self::assertSame(500, $resposta->status);
        self::assertSame('', $resposta->body);
        self::assertSame('*', $resposta->headers['Access-Control-Allow-Origin']);
    }
}
