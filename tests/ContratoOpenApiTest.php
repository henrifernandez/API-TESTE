<?php

declare(strict_types=1);

namespace ApiTeste\Tests;

use ApiTeste\Request;
use ApiTeste\Response;
use ApiTeste\Router;
use DateTimeImmutable;
use DateTimeZone;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Symfony\Component\Yaml\Yaml;

/**
 * Garante que o openapi.yaml descreve a API real: rotas existentes e exemplos idênticos às respostas.
 */
final class ContratoOpenApiTest extends TestCase
{
    /** @var array<string, mixed> */
    private array $spec;

    protected function setUp(): void
    {
        $spec = Yaml::parseFile(__DIR__ . '/../openapi.yaml');
        self::assertIsArray($spec);
        $this->spec = $spec;
    }

    private function roteador(): Router
    {
        return new Router(
            relogio: static fn(): DateTimeImmutable => new DateTimeImmutable('2026-10-24T18:00:00', new DateTimeZone('UTC')),
        );
    }

    private function roteadorQuebrado(): Router
    {
        return new Router(
            relogio: static function (): DateTimeImmutable {
                throw new RuntimeException('falha simulada');
            },
            registrar: static function (string $texto): void {},
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function resolver(mixed $no): array
    {
        self::assertIsArray($no);
        while (isset($no['$ref'])) {
            self::assertIsString($no['$ref']);
            self::assertStringStartsWith('#/', $no['$ref']);
            $alvo = $this->spec;
            foreach (explode('/', substr($no['$ref'], 2)) as $parte) {
                self::assertIsArray($alvo);
                self::assertArrayHasKey($parte, $alvo, "referência quebrada: {$no['$ref']}");
                $alvo = $alvo[$parte];
            }
            self::assertIsArray($alvo);
            $no = $alvo;
        }

        return $no;
    }

    /**
     * @return list<array{path: string, status: string, resposta: array<string, mixed>}>
     */
    private function respostasDocumentadas(): array
    {
        $saida = [];
        $caminhos = $this->spec['paths'] ?? [];
        self::assertIsArray($caminhos);

        foreach ($caminhos as $caminho => $operacoes) {
            self::assertIsString($caminho);
            self::assertIsArray($operacoes);
            self::assertArrayHasKey('get', $operacoes, "{$caminho} deve documentar GET");
            self::assertSame(['get'], array_keys($operacoes), "{$caminho} documenta métodos que a API não aceita");
            foreach ($operacoes['get']['responses'] as $status => $resposta) {
                $saida[] = ['path' => $caminho, 'status' => (string) $status, 'resposta' => $this->resolver($resposta)];
            }
        }

        return $saida;
    }

    public function testEhOpenApi31(): void
    {
        self::assertIsString($this->spec['openapi']);
        self::assertStringStartsWith('3.1', $this->spec['openapi']);
    }

    public function testTodaRotaDocumentadaExisteETodaRotaRealEstaDocumentada(): void
    {
        $documentadas = array_keys($this->spec['paths']);
        sort($documentadas);

        $reais = ['/api/v1', '/api/v1/mensagens', '/api/v1/mensagens/{id}', '/api/v1/status'];
        sort($reais);
        self::assertSame($reais, $documentadas);

        foreach ($documentadas as $caminho) {
            $concreto = str_replace('{id}', '1', $caminho);
            $resposta = $this->roteador()->handle(new Request('GET', $concreto));
            self::assertSame(200, $resposta->status, "GET {$concreto} deveria existir");
        }
    }

    public function testListaDeRotasDaRaizBateComOsCaminhosDocumentados(): void
    {
        $dados = json_decode($this->roteador()->handle(new Request('GET', '/api/v1'))->body, true);
        $esperadas = [];
        foreach (array_keys($this->spec['paths']) as $caminho) {
            if ($caminho !== '/api/v1') {
                $esperadas[] = 'GET ' . $caminho;
            }
        }
        sort($esperadas);
        $reais = $dados['rotas'];
        sort($reais);

        self::assertSame($esperadas, $reais);
    }

    public function testExemplosDocumentadosSaoIdenticosAsRespostasReais(): void
    {
        $verificados = 0;

        foreach ($this->respostasDocumentadas() as ['path' => $caminho, 'status' => $status, 'resposta' => $resposta]) {
            self::assertArrayHasKey('content', $resposta, "{$caminho} {$status} sem content");
            foreach ($resposta['content'] as $tipo => $conteudo) {
                self::assertArrayHasKey('example', $conteudo, "{$caminho} {$status} sem exemplo");
                $exemplo = $conteudo['example'];

                [$metodo, $url, $roteador] = $this->cenario($caminho, (int) $status, $exemplo);
                $real = $roteador->handle(new Request($metodo, $url));

                self::assertSame((int) $status, $real->status, "{$metodo} {$url}");
                self::assertStringStartsWith($tipo, $real->headers['Content-Type'], "{$metodo} {$url}");
                self::assertSame($exemplo, json_decode($real->body, true), "exemplo de {$caminho} {$status}");
                $this->conferirCabecalhos($resposta, $real, "{$metodo} {$url}");
                ++$verificados;
            }
        }

        self::assertGreaterThanOrEqual(10, $verificados);
    }

    /**
     * Escolhe método, URL e roteador capazes de produzir a resposta documentada.
     *
     * @return array{string, string, Router}
     */
    private function cenario(string $caminho, int $status, mixed $exemplo): array
    {
        self::assertIsArray($exemplo);
        $instancia = is_string($exemplo['instance'] ?? null) ? $exemplo['instance'] : null;
        $url = $instancia ?? str_replace('{id}', (string) ($exemplo['id'] ?? 1), $caminho);

        return match ($status) {
            405 => ['POST', $url, $this->roteador()],
            500 => ['GET', $url, $this->roteadorQuebrado()],
            default => ['GET', $url, $this->roteador()],
        };
    }

    /**
     * @param array<string, mixed> $documentada
     */
    private function conferirCabecalhos(array $documentada, Response $real, string $rotulo): void
    {
        foreach ($documentada['headers'] ?? [] as $nome => $cabecalho) {
            $cabecalho = $this->resolver($cabecalho);
            $esperado = $cabecalho['schema']['const'] ?? null;
            self::assertNotNull($esperado, "{$rotulo}: cabeçalho {$nome} sem valor fixo");
            self::assertSame($esperado, $real->headers[$nome] ?? null, "{$rotulo}: cabeçalho {$nome}");
        }
    }

    public function testTodaRespostaDocumentadaTemSchemaDeSucessoOuProblemDetails(): void
    {
        foreach ($this->respostasDocumentadas() as ['path' => $caminho, 'status' => $status, 'resposta' => $resposta]) {
            foreach ($resposta['content'] as $tipo => $conteudo) {
                self::assertArrayHasKey('schema', $conteudo, "{$caminho} {$status}");
                self::assertSame(
                    $status === '200' ? 'application/json' : 'application/problem+json',
                    $tipo,
                    "{$caminho} {$status}",
                );
            }
        }

        $problem = $this->spec['components']['schemas']['ProblemDetails'];
        self::assertSame(
            ['type', 'title', 'status', 'detail', 'instance', 'codigo'],
            $problem['required'],
        );
    }
}
