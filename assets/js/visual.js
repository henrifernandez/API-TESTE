const ROTULO_PAUSAR = 'Pausar animação';
const ROTULO_RETOMAR = 'Retomar animação';

function temWebGL() {
    try {
        const teste = document.createElement('canvas');
        const contexto = teste.getContext('webgl2') || teste.getContext('webgl');
        if (!contexto) {
            return false;
        }
        contexto.getExtension('WEBGL_lose_context')?.loseContext();

        return true;
    } catch {
        return false;
    }
}

/**
 * Controla o visualizador: cena em WebGL quando possível; SVG estático caso contrário
 * (sem WebGL ou com prefers-reduced-motion). O three.js só é baixado no primeiro caso.
 */
export function criarVisual({ palco, canvas, botaoPausa, painel }) {
    const preferenciaMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');
    let cena = null;
    let geracao = 0;
    let estado = 'repouso';
    let pausadoPeloUsuario = false;

    function aplicarModo(modo) {
        palco.dataset.modo = modo;
        botaoPausa.hidden = modo !== 'animado';
    }

    function movimentoAtivo() {
        return cena !== null && !pausadoPeloUsuario && !document.hidden;
    }

    function sincronizarMovimento() {
        cena?.definirMovimento(movimentoAtivo());
    }

    function descartarCena() {
        cena?.destruir();
        cena = null;
    }

    async function iniciar() {
        const minhaGeracao = ++geracao;
        descartarCena();

        if (preferenciaMovimento.matches || !temWebGL()) {
            aplicarModo('estatico');

            return;
        }

        try {
            const { criarCena } = await import('./cena.js');
            if (minhaGeracao !== geracao) {
                return;
            }
            cena = criarCena(canvas, {
                painel,
                aoPerderContexto: () => {
                    geracao++;
                    descartarCena();
                    aplicarModo('estatico');
                },
            });
            cena.definirEstado(estado);
            aplicarModo('animado');
            sincronizarMovimento();
        } catch {
            descartarCena();
            aplicarModo('estatico');
        }
    }

    botaoPausa.addEventListener('click', () => {
        pausadoPeloUsuario = !pausadoPeloUsuario;
        botaoPausa.textContent = pausadoPeloUsuario ? ROTULO_RETOMAR : ROTULO_PAUSAR;
        sincronizarMovimento();
    });

    // Aba oculta: para o laço de animação e retoma ao voltar (se o usuário não pausou).
    document.addEventListener('visibilitychange', sincronizarMovimento);
    preferenciaMovimento.addEventListener('change', iniciar);

    iniciar();

    return {
        /** Estados: repouso, aguardando, sucesso, erro. */
        definirEstado(novo) {
            estado = novo;
            document.body.dataset.estado = novo;
            cena?.definirEstado(novo);
        },
        /** Verdadeiro quando há movimento contínuo na tela agora. */
        animando() {
            return movimentoAtivo();
        },
    };
}
