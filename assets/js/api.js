export const MENSAGEM_REDE = 'Não foi possível falar com a API. Verifique sua conexão e tente de novo.';

const TEXTOS_STATUS = {
    200: 'OK',
    204: 'No Content',
    400: 'Bad Request',
    404: 'Not Found',
    405: 'Method Not Allowed',
    500: 'Internal Server Error',
};

const TEMPO_LIMITE_MS = 15000;
const MAX_CARACTERES = 4000;

/**
 * Formata o corpo da resposta: JSON identado quando possível, texto cortado caso contrário.
 */
export function formatarCorpo(texto) {
    if (texto.trim() === '') {
        return '(resposta sem corpo)';
    }

    try {
        return JSON.stringify(JSON.parse(texto), null, 2);
    } catch {
        return texto.length > MAX_CARACTERES ? `${texto.slice(0, MAX_CARACTERES)}…` : texto;
    }
}

/**
 * Envia um GET para a API e devolve um objeto simples, sem nunca lançar exceção.
 *
 * Resultado com resposta: { tipo: 'resposta', metodo, url, status, textoStatus, ms, corpo }
 * Falha de rede ou tempo esgotado: { tipo: 'rede', metodo, url, ms, mensagem }
 */
export async function requisitar(caminho, { fetchImpl = fetch } = {}) {
    const metodo = 'GET';
    const url = new URL(caminho, window.location.href).href;
    const controle = new AbortController();
    const temporizador = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
    const inicio = performance.now();

    try {
        const resposta = await fetchImpl(url, {
            method: metodo,
            headers: { Accept: 'application/json, application/problem+json' },
            signal: controle.signal,
        });
        const texto = await resposta.text();

        return {
            tipo: 'resposta',
            metodo,
            url,
            status: resposta.status,
            textoStatus: resposta.statusText || TEXTOS_STATUS[resposta.status] || '',
            ms: Math.round(performance.now() - inicio),
            corpo: formatarCorpo(texto),
        };
    } catch {
        return {
            tipo: 'rede',
            metodo,
            url,
            ms: Math.round(performance.now() - inicio),
            mensagem: MENSAGEM_REDE,
        };
    } finally {
        clearTimeout(temporizador);
    }
}
