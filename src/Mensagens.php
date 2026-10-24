<?php

declare(strict_types=1);

namespace ApiTeste;

/**
 * Catálogo fixo de mensagens da API.
 */
class Mensagens
{
    /** @var list<array{id: int, titulo: string, texto: string}> */
    private const array ITENS = [
        [
            'id' => 1,
            'titulo' => 'Conexão estabelecida',
            'texto' => 'A API recebeu sua requisição e respondeu com sucesso.',
        ],
        [
            'id' => 2,
            'titulo' => 'Respostas em JSON',
            'texto' => 'Toda resposta usa JSON em UTF-8, com o código de status HTTP que corresponde ao resultado.',
        ],
        [
            'id' => 3,
            'titulo' => 'Erros padronizados',
            'texto' => 'Quando algo dá errado, a API explica o motivo no formato Problem Details (RFC 9457).',
        ],
    ];

    /**
     * @return list<array{id: int, titulo: string, texto: string}>
     */
    public function todas(): array
    {
        return self::ITENS;
    }

    public function total(): int
    {
        return count(self::ITENS);
    }

    /**
     * @return array{id: int, titulo: string, texto: string}|null
     */
    public function buscar(int $id): ?array
    {
        foreach (self::ITENS as $item) {
            if ($item['id'] === $id) {
                return $item;
            }
        }

        return null;
    }
}
