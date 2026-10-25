import { requisitar } from './api.js';
import { criarVisual } from './visual.js';

const ESPERA_MINIMA_ANIMADA_MS = 900;

const $ = (seletor) => document.querySelector(seletor);
const botoes = [...document.querySelectorAll('button[data-caminho]')];
const grupo = $('#acoes');
const resultado = $('#resultado');
const campos = {
    metodo: $('#r-metodo'),
    url: $('#r-url'),
    status: $('#r-status'),
    tempo: $('#r-tempo'),
    corpo: $('#r-corpo'),
};
const estadoTexto = $('#estado-texto');

const visual = criarVisual({
    palco: $('#palco'),
    canvas: $('#cena'),
    botaoPausa: $('#pausa'),
    painel: $('.painel'),
});

const ROTULOS_ESTADO = {
    repouso: 'Pronto para requisitar',
    aguardando: 'Requisição em andamento',
    sucesso: 'Resposta com sucesso',
    erro: 'Resposta com erro',
};

let ocupado = false;

function definirEstado(estado, contexto) {
    visual.definirEstado(estado, contexto);
    estadoTexto.textContent = ROTULOS_ESTADO[estado];
}

function definirOcupado(valor) {
    ocupado = valor;
    const texto = String(valor);
    grupo.setAttribute('aria-busy', texto);
    resultado.setAttribute('aria-busy', texto);
    botoes.forEach((botao) => {
        botao.disabled = valor;
    });
}

/**
 * Atualiza todos os campos de uma vez, com a região aria-busy ativa,
 * para que o leitor de tela anuncie o resultado completo uma única vez.
 */
function mostrar({ metodo, url, status, tempo, corpo, tom }) {
    campos.metodo.textContent = metodo;
    campos.url.textContent = url;
    campos.status.textContent = status;
    campos.tempo.textContent = tempo;
    campos.corpo.textContent = corpo;
    resultado.dataset.tom = tom;
}

function esperar(ms) {
    return new Promise((resolver) => setTimeout(resolver, ms));
}

async function enviar(botao) {
    if (ocupado) {
        return;
    }

    const caminho = botao.dataset.caminho;
    const inicio = performance.now();

    definirOcupado(true);
    definirEstado('aguardando', { rota: caminho });
    mostrar({
        metodo: 'GET',
        url: new URL(caminho, window.location.href).href,
        status: 'Aguardando resposta…',
        tempo: 'Medindo…',
        corpo: 'Aguardando a resposta da API…',
        tom: 'aguardando',
    });

    const retorno = await requisitar(caminho);

    // Com animação ativa, mantém o pacote em trânsito por um instante para a espera ser perceptível.
    if (visual.animando()) {
        const restante = ESPERA_MINIMA_ANIMADA_MS - (performance.now() - inicio);
        if (restante > 0) {
            await esperar(restante);
        }
    }

    if (retorno.tipo === 'rede') {
        mostrar({
            metodo: retorno.metodo,
            url: retorno.url,
            status: 'Sem resposta',
            tempo: `${retorno.ms} ms`,
            corpo: retorno.mensagem,
            tom: 'erro',
        });
        definirEstado('erro', { rota: caminho, falha: 'rede' });
    } else {
        const sucesso = retorno.status >= 200 && retorno.status < 300;
        mostrar({
            metodo: retorno.metodo,
            url: retorno.url,
            status: `${retorno.status} ${retorno.textoStatus}`.trim(),
            tempo: `${retorno.ms} ms`,
            corpo: retorno.corpo,
            tom: sucesso ? 'sucesso' : 'erro',
        });
        definirEstado(sucesso ? 'sucesso' : 'erro', { rota: caminho, status: retorno.status, falha: sucesso ? undefined : 'http' });
    }

    definirOcupado(false);

    // Botão desabilitado perde o foco; devolve ao mesmo botão para quem usa teclado.
    if (document.activeElement === document.body || document.activeElement === null) {
        botao.focus();
    }
}

botoes.forEach((botao) => {
    botao.addEventListener('click', () => {
        enviar(botao);
    });
});
