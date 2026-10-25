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

/** Escolhe a variante da animação pela rota: status, lista de mensagens ou uma mensagem. */
function variantePorRota(rota = '') {
    const caminho = rota.split('?')[0].replace(/\/+$/, '');
    const mensagem = caminho.match(/\/mensagens\/(\d+)$/);

    if (mensagem) {
        return { variante: 'mensagem', id: mensagem[1] };
    }

    return { variante: /\/mensagens$/.test(caminho) ? 'lista' : 'status' };
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
    let contextoAtual = {};
    let pausadoPeloUsuario = false;
    let sacudida = null;

    function aplicarModo(modo) {
        palco.dataset.modo = modo;
        botaoPausa.hidden = modo !== 'animado';
    }

    function movimentoAtivo() {
        return cena !== null && !pausadoPeloUsuario && !document.hidden;
    }

    function sincronizarMovimento() {
        const ligado = movimentoAtivo();
        cena?.definirMovimento(ligado);
        if (!ligado) {
            sacudida?.cancel();
        }
    }

    /** Balanço curto do painel (até 6 px, 500 ms). Só transform: não move o foco nem reflui o texto. */
    function sacudirPainel() {
        if (!painel || !movimentoAtivo() || typeof painel.animate !== 'function') {
            return;
        }
        sacudida?.cancel();
        sacudida = painel.animate(
            [
                { transform: 'translate(0, 0)' },
                { transform: 'translate(-5px, 1px)', offset: 0.12 },
                { transform: 'translate(6px, -1px)', offset: 0.28 },
                { transform: 'translate(-4px, 2px)', offset: 0.46 },
                { transform: 'translate(3px, -1px)', offset: 0.64 },
                { transform: 'translate(-2px, 0)', offset: 0.82 },
                { transform: 'translate(0, 0)' },
            ],
            { duration: 500, easing: 'linear' },
        );
    }

    function descartarCena() {
        sacudida?.cancel();
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
                aoSacudir: sacudirPainel,
                aoPerderContexto: () => {
                    geracao++;
                    descartarCena();
                    aplicarModo('estatico');
                },
            });
            cena.definirEstado(estado, contextoAtual);
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
        /** O contexto traz a rota e, no fim, a falha de rede (`falha: 'rede'`) ou o status HTTP. */
        definirEstado(novo, contexto = {}) {
            estado = novo;
            contextoAtual = { ...variantePorRota(contexto.rota), ...contexto };
            document.body.dataset.estado = novo;
            cena?.definirEstado(novo, contextoAtual);
        },
        /** Verdadeiro quando há movimento contínuo na tela agora. */
        animando() {
            return movimentoAtivo();
        },
    };
}
