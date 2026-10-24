<?php

declare(strict_types=1);

namespace ApiTeste\Tests;

use ApiTeste\Request;
use ApiTeste\Response;
use ApiTeste\Router;
use DateTimeImmutable;
use DateTimeZone;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class RotasTest extends TestCase
{
    private const string MSG_1 = '{"id":1,"titulo":"Conexão estabelecida","texto":"A API recebeu sua requisição e respondeu com sucesso."}';
    private const string MSG_2 = '{"id":2,"titulo":"Respostas em JSON","texto":"Toda resposta usa JSON em UTF-8, com o código de status HTTP que corresponde ao resultado."}';
    private const string MSG_3 = '{"id":3,"titulo":"Erros padronizados","texto":"Quando algo dá errado, a API explica o motivo no formato Problem Details (RFC 9457)."}';

    private function roteador(): Router
    {
        return new Router(
            relogio: static fn(): DateTimeImmutable => new DateTimeImmutable('2026-10-24T18:00:00', new DateTimeZone('UTC')),
        );
    }

    private function chamar(string $metodo, string $caminho): Response
    {
        return $this->roteador()->handle(new Request($metodo, $caminho));
    }

    /**
     * @return array<mixed>
     */
    private function json(Response $resposta): array
    {
        $dados = json_decode($resposta->body, true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($dados);

        return $dados;
    }

    private function assertCabecalhosComuns(Response $resposta): void
    {
        self::assertSame('nosniff', $resposta->headers['X-Content-Type-Options'] ?? null);
    }

    // ---------- Sucesso ----------

    public function testRaizDescreveAApi(): void
    {
        $resposta = $this->chamar('GET', '/api/v1');

        self::assertSame(200, $resposta->status);
        self::assertSame([
            'nome' => 'API-TESTE',
            'versao' => '1.0.0',
            'descricao' => 'API de demonstração em PHP com respostas JSON e erros padronizados.',
            'rotas' => [
                'GET /api/v1/status',
                'GET /api/v1/mensagens',
                'GET /api/v1/mensagens/{id}',
            ],
        ], $this->json($resposta));
        self::assertSame('application/json; charset=utf-8', $resposta->headers['Content-Type']);
        self::assertSame('public, max-age=60', $resposta->headers['Cache-Control']);
        self::assertSame('*', $resposta->headers['Access-Control-Allow-Origin']);
        $this->assertCabecalhosComuns($resposta);
    }

    public function testJsonNaoEscapaUnicodeNemBarras(): void
    {
        $resposta = $this->chamar('GET', '/api/v1');

        self::assertStringContainsString('demonstração', $resposta->body);
        self::assertStringContainsString('GET /api/v1/status', $resposta->body);
        self::assertStringNotContainsString('\u', $resposta->body);
        self::assertStringNotContainsString('\/', $resposta->body);
        self::assertStringContainsString("\n    \"nome\": \"API-TESTE\"", $resposta->body, 'JSON deve estar indentado');
        self::assertSame((string) strlen($resposta->body), $resposta->headers['Content-Length']);
    }

    public function testStatusRetornaHorarioUtcSemCache(): void
    {
        $resposta = $this->chamar('GET', '/api/v1/status');

        self::assertSame(200, $resposta->status);
        self::assertSame([
            'status' => 'ok',
            'mensagem' => 'A API está no ar.',
            'versao' => '1.0.0',
            'horario' => '2026-10-24T18:00:00Z',
        ], $this->json($resposta));
        self::assertSame('no-store', $resposta->headers['Cache-Control']);
        self::assertSame('application/json; charset=utf-8', $resposta->headers['Content-Type']);
        $this->assertCabecalhosComuns($resposta);
    }

    public function testStatusConverteQualquerFusoParaUtc(): void
    {
        $roteador = new Router(
            relogio: static fn(): DateTimeImmutable => new DateTimeImmutable('2026-10-24T15:00:00', new DateTimeZone('America/Sao_Paulo')),
        );

        $dados = $this->json($roteador->handle(new Request('GET', '/api/v1/status')));

        self::assertSame('2026-10-24T18:00:00Z', $dados['horario']);
    }

    public function testStatusComRelogioRealTemFormatoIso8601Utc(): void
    {
        $resposta = new Router()->handle(new Request('GET', '/api/v1/status'));

        self::assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $this->json($resposta)['horario']);
    }

    public function testListaDeMensagens(): void
    {
        $resposta = $this->chamar('GET', '/api/v1/mensagens');

        self::assertSame(200, $resposta->status);
        self::assertSame(
            ['total' => 3, 'mensagens' => [
                json_decode(self::MSG_1, true),
                json_decode(self::MSG_2, true),
                json_decode(self::MSG_3, true),
            ]],
            $this->json($resposta),
        );
        self::assertSame('public, max-age=60', $resposta->headers['Cache-Control']);
        self::assertSame('*', $resposta->headers['Access-Control-Allow-Origin']);
        $this->assertCabecalhosComuns($resposta);
    }

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function mensagensIndividuais(): iterable
    {
        yield 'mensagem 1' => ['/api/v1/mensagens/1', self::MSG_1];
        yield 'mensagem 2' => ['/api/v1/mensagens/2', self::MSG_2];
        yield 'mensagem 3' => ['/api/v1/mensagens/3', self::MSG_3];
    }

    #[DataProvider('mensagensIndividuais')]
    public function testMensagemPorId(string $caminho, string $esperado): void
    {
        $resposta = $this->chamar('GET', $caminho);

        self::assertSame(200, $resposta->status);
        self::assertSame(json_decode($esperado, true), $this->json($resposta));
        self::assertSame('public, max-age=60', $resposta->headers['Cache-Control']);
        $this->assertCabecalhosComuns($resposta);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function rotasValidas(): iterable
    {
        yield 'raiz' => ['/api/v1'];
        yield 'status' => ['/api/v1/status'];
        yield 'mensagens' => ['/api/v1/mensagens'];
        yield 'mensagem' => ['/api/v1/mensagens/2'];
    }

    #[DataProvider('rotasValidas')]
    public function testBarraFinalFuncionaComoSemBarra(string $caminho): void
    {
        $sem = $this->chamar('GET', $caminho);
        $com = $this->chamar('GET', $caminho . '/');

        self::assertSame(200, $com->status);
        self::assertSame($sem->body, $com->body);
        self::assertSame($sem->headers, $com->headers);
    }

    #[DataProvider('rotasValidas')]
    public function testQueryStringNaoAfetaARota(string $caminho): void
    {
        $requisicao = Request::fromGlobals(['REQUEST_METHOD' => 'GET', 'REQUEST_URI' => $caminho . '?x=1#y']);

        self::assertSame($caminho, $requisicao->path);
        self::assertSame(200, $this->roteador()->handle($requisicao)->status);
    }

    // ---------- HEAD ----------

    #[DataProvider('rotasValidas')]
    public function testHeadDevolveOsMesmosCabecalhosSemCorpo(string $caminho): void
    {
        $get = $this->chamar('GET', $caminho);
        $head = $this->chamar('HEAD', $caminho);

        self::assertSame(200, $head->status);
        self::assertSame('', $head->body);
        self::assertSame($get->headers, $head->headers);
        self::assertGreaterThan(0, (int) $head->headers['Content-Length']);
    }

    public function testHeadEmErroTambemNaoTemCorpo(): void
    {
        $get = $this->chamar('GET', '/api/v1/mensagens/99');
        $head = $this->chamar('HEAD', '/api/v1/mensagens/99');

        self::assertSame(404, $head->status);
        self::assertSame('', $head->body);
        self::assertSame($get->headers, $head->headers);
    }

    // ---------- OPTIONS e CORS ----------

    #[DataProvider('rotasValidas')]
    public function testOptionsResponde204(string $caminho): void
    {
        $resposta = $this->chamar('OPTIONS', $caminho);

        self::assertSame(204, $resposta->status);
        self::assertSame('', $resposta->body);
        self::assertSame('GET, HEAD, OPTIONS', $resposta->headers['Access-Control-Allow-Methods']);
        self::assertSame('GET, HEAD, OPTIONS', $resposta->headers['Allow']);
        self::assertSame('*', $resposta->headers['Access-Control-Allow-Origin']);
        self::assertArrayNotHasKey('Content-Type', $resposta->headers);
        $this->assertCabecalhosComuns($resposta);
    }

    public function testOptionsEmRotaInexistenteEh404(): void
    {
        self::assertSame(404, $this->chamar('OPTIONS', '/api/v1/nada')->status);
    }

    public function testCorsSoParaGetHeadEOptions(): void
    {
        foreach (['GET', 'HEAD', 'OPTIONS'] as $metodo) {
            self::assertSame('*', $this->chamar($metodo, '/api/v1/status')->headers['Access-Control-Allow-Origin'] ?? null, $metodo);
        }

        foreach (['POST', 'PUT', 'PATCH', 'DELETE'] as $metodo) {
            self::assertArrayNotHasKey('Access-Control-Allow-Origin', $this->chamar($metodo, '/api/v1/status')->headers, $metodo);
        }
    }

    public function testErrosDeLeituraTambemTemCors(): void
    {
        self::assertSame('*', $this->chamar('GET', '/api/v1/mensagens/99')->headers['Access-Control-Allow-Origin']);
        self::assertSame('*', $this->chamar('GET', '/nada')->headers['Access-Control-Allow-Origin']);
    }

    // ---------- Erros ----------

    /**
     * @param array<string, mixed> $esperado
     */
    private function assertProblema(Response $resposta, int $status, array $esperado): void
    {
        self::assertSame($status, $resposta->status);
        self::assertSame('application/problem+json; charset=utf-8', $resposta->headers['Content-Type']);
        self::assertSame('no-store', $resposta->headers['Cache-Control']);
        self::assertSame($esperado, $this->json($resposta));
        self::assertSame(
            ['type', 'title', 'status', 'detail', 'instance', 'codigo'],
            array_keys($this->json($resposta)),
            'ordem dos campos',
        );
        $this->assertCabecalhosComuns($resposta);
    }

    public function testMensagemNaoEncontrada(): void
    {
        $this->assertProblema($this->chamar('GET', '/api/v1/mensagens/99'), 404, [
            'type' => 'about:blank',
            'title' => 'Mensagem não encontrada',
            'status' => 404,
            'detail' => 'Não existe mensagem com id 99. Os ids válidos vão de 1 a 3.',
            'instance' => '/api/v1/mensagens/99',
            'codigo' => 'MENSAGEM_NAO_ENCONTRADA',
        ]);
    }

    public function testMensagemNaoEncontradaComNumeroGigante(): void
    {
        $id = '99999999999999999999999999';
        $dados = $this->json($this->chamar('GET', '/api/v1/mensagens/' . $id));

        self::assertSame('MENSAGEM_NAO_ENCONTRADA', $dados['codigo']);
        self::assertSame("Não existe mensagem com id {$id}. Os ids válidos vão de 1 a 3.", $dados['detail']);
    }

    public function testMensagemQuatroNaoExiste(): void
    {
        self::assertSame(404, $this->chamar('GET', '/api/v1/mensagens/4')->status);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function idsInvalidos(): iterable
    {
        yield 'zero' => ['0'];
        yield 'negativo' => ['-1'];
        yield 'letras' => ['abc'];
        yield 'decimal' => ['1.5'];
        yield 'zero a esquerda' => ['01'];
        yield 'sinal de mais' => ['+1'];
        yield 'notacao cientifica' => ['1e3'];
        yield 'hexadecimal' => ['0x1'];
        yield 'misto' => ['1abc'];
        yield 'percentual' => ['%31'];
        yield 'espaco codificado' => ['1%20'];
        yield 'algarismo arabe' => ["\u{0661}"];
        yield 'ponto e virgula' => ['1;2'];
        yield 'id vazio' => [''];
    }

    #[DataProvider('idsInvalidos')]
    public function testIdInvalido(string $id): void
    {
        $caminho = '/api/v1/mensagens/' . $id;
        // Com id vazio a barra dupla evita que a barra final seja removida e vire a listagem.
        $caminhoEnviado = $id === '' ? $caminho . '/' : $caminho;
        $resposta = $this->chamar('GET', $caminhoEnviado);

        self::assertSame(400, $resposta->status);
        $dados = $this->json($resposta);
        self::assertSame('ID_INVALIDO', $dados['codigo']);
        self::assertSame('Identificador inválido', $dados['title']);
        self::assertSame('O id deve ser um número inteiro positivo, por exemplo /api/v1/mensagens/1.', $dados['detail']);
        self::assertSame('about:blank', $dados['type']);
        self::assertSame(400, $dados['status']);
        self::assertSame('no-store', $resposta->headers['Cache-Control']);
        self::assertSame('application/problem+json; charset=utf-8', $resposta->headers['Content-Type']);
    }

    public function testIdInvalidoCompleto(): void
    {
        $this->assertProblema($this->chamar('GET', '/api/v1/mensagens/abc'), 400, [
            'type' => 'about:blank',
            'title' => 'Identificador inválido',
            'status' => 400,
            'detail' => 'O id deve ser um número inteiro positivo, por exemplo /api/v1/mensagens/1.',
            'instance' => '/api/v1/mensagens/abc',
            'codigo' => 'ID_INVALIDO',
        ]);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function rotasInexistentes(): iterable
    {
        yield 'raiz do site' => ['/'];
        yield 'api sem versao' => ['/api'];
        yield 'api com barra' => ['/api/'];
        yield 'versao inexistente' => ['/api/v2/status'];
        yield 'rota desconhecida' => ['/api/v1/nada'];
        yield 'subrota extra' => ['/api/v1/status/extra'];
        yield 'mensagens com subrota' => ['/api/v1/mensagens/1/extra'];
        yield 'prefixo parecido' => ['/api/v1status'];
        yield 'caixa diferente' => ['/API/V1/status'];
        yield 'barra dupla' => ['//api/v1/status'];
        yield 'traversal' => ['/api/v1/../../etc/passwd'];
    }

    #[DataProvider('rotasInexistentes')]
    public function testRotaNaoEncontrada(string $caminho): void
    {
        $this->assertProblema($this->chamar('GET', $caminho), 404, [
            'type' => 'about:blank',
            'title' => 'Rota não encontrada',
            'status' => 404,
            'detail' => "A rota {$caminho} não existe. Consulte GET /api/v1 para ver as rotas disponíveis.",
            'instance' => $caminho,
            'codigo' => 'ROTA_NAO_ENCONTRADA',
        ]);
    }

    public function testCaminhoComBytesDeControleNaoQuebraENaoVaza(): void
    {
        $caminho = "/api/v1/\x00\x01\x1b[31m\x7f\r\nX-Injetado: 1";
        $resposta = $this->chamar('GET', $caminho);

        self::assertSame(404, $resposta->status);
        self::assertDoesNotMatchRegularExpression('/[\x00-\x09\x0b-\x1f\x7f]/', $resposta->body);
        $dados = $this->json($resposta);
        self::assertSame('ROTA_NAO_ENCONTRADA', $dados['codigo']);
        self::assertStringNotContainsString("\x00", $dados['instance']);
        self::assertStringNotContainsString("\n", $dados['instance']);
        self::assertStringNotContainsString("\r", $dados['detail']);
        self::assertArrayNotHasKey('X-Injetado', $resposta->headers);
    }

    public function testCaminhoComUtf8InvalidoGeraJsonValido(): void
    {
        $resposta = $this->chamar('GET', "/api/v1/\xff\xfe");

        self::assertSame(404, $resposta->status);
        self::assertSame('ROTA_NAO_ENCONTRADA', $this->json($resposta)['codigo']);
    }

    public function testCaminhoGiganteEhTruncadoNaMensagem(): void
    {
        $caminho = '/api/v1/' . str_repeat('a', 5000);
        $dados = $this->json($this->chamar('GET', $caminho));

        self::assertLessThan(400, strlen($dados['detail']));
        self::assertLessThan(300, strlen($dados['instance']));
    }

    // ---------- 405 ----------

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function metodosNaoPermitidos(): iterable
    {
        foreach (['/api/v1', '/api/v1/status', '/api/v1/mensagens', '/api/v1/mensagens/1', '/api/v1/mensagens/abc'] as $caminho) {
            foreach (['POST', 'PUT', 'PATCH', 'DELETE'] as $metodo) {
                yield "{$metodo} {$caminho}" => [$metodo, $caminho];
            }
        }
    }

    #[DataProvider('metodosNaoPermitidos')]
    public function testMetodoNaoPermitido(string $metodo, string $caminho): void
    {
        $resposta = $this->chamar($metodo, $caminho);

        $this->assertProblema($resposta, 405, [
            'type' => 'about:blank',
            'title' => 'Método não permitido',
            'status' => 405,
            'detail' => "A rota {$caminho} aceita apenas GET e HEAD.",
            'instance' => $caminho,
            'codigo' => 'METODO_NAO_PERMITIDO',
        ]);
        self::assertSame('GET, HEAD, OPTIONS', $resposta->headers['Allow']);
    }

    public function testMetodoEmMinusculasEhNormalizado(): void
    {
        self::assertSame(200, $this->chamar('get', '/api/v1/status')->status);
        self::assertSame(405, $this->chamar('post', '/api/v1/status')->status);
    }

    public function testPostEmRotaInexistenteEh404(): void
    {
        self::assertSame(404, $this->chamar('POST', '/api/v1/nada')->status);
    }

    // ---------- Request ----------

    public function testRequestUsaPadroesSeguros(): void
    {
        $requisicao = Request::fromGlobals(['REQUEST_METHOD' => 123]);

        self::assertSame('GET', $requisicao->method);
        self::assertSame('/', $requisicao->path);
    }

    public function testRequestSoComQueryStringViraRaiz(): void
    {
        $requisicao = Request::fromGlobals(['REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '?x=1']);

        self::assertSame('/', $requisicao->path);
    }

    public function testRequestNaoDecodificaOCaminho(): void
    {
        $requisicao = Request::fromGlobals(['REQUEST_METHOD' => 'get', 'REQUEST_URI' => '/api/v1/mensagens/%31?a=b']);

        self::assertSame('GET', $requisicao->method);
        self::assertSame('/api/v1/mensagens/%31', $requisicao->path);
    }
}
