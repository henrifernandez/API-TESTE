import * as THREE from '../vendor/three/three.module.min.js';

// A cena foi escrita para o three.js r128, que não tinha gerenciamento de cor: o hexadecimal
// ia direto para a tela. Desligar o gerenciamento e usar saída linear reproduz as mesmas cores
// e a mesma neblina nas versões atuais.
THREE.ColorManagement.enabled = false;

const CIANO = 0x3df0d2;
const AMBAR = 0xffb454;
const VERMELHO = 0xff7a7a;
const FUNDO = 0x05070d;
const BRANCO = new THREE.Color(0xffffff);

const POSICAO_NUCLEO = new THREE.Vector3(4.2, 0, 0);
const POSICAO_CLIENTE = new THREE.Vector3(-4.6, 0, 0);
const QUANTIDADE_ESTRELAS = 900;
const MAX_RASTRO = 30;
const TREMOR_S = 0.6;
const MAX_FAISCAS = 300;
const PARADA_ERRO = 0.6; // fração da curva onde o pacote para quando a resposta é um erro
const CONGELA_S = 0.3; // tempo parado, com micro tremor, antes de virar faíscas
const CAMERA_S = 0.5; // duração do balanço da câmera
const CURVA_PARTIDA_S = 1; // tempo com um trecho da curva apagado
const FALHA_S = 1.9; // duração da falha do núcleo
const QUEDA_S = 1; // duração da queda do pacote quando a rede falha
const DISTANCIA_CAMERA = 11;
const LARGURA_CELULAR = 860; // mesma largura em que o CSS empilha o painel acima da cena
// Extensão horizontal da cena (do cliente à borda da órbita externa), para caber em telas estreitas.
const LARGURA_UTIL = 12.8;
const CENTRO_UTIL_X = 1;
const X_VISIVEL = -2.2; // ponto da curva que aparece logo ao lado do painel

/**
 * Uma variante por tipo de rota. Enquanto a resposta não chega, cada pacote se aproxima do seu
 * `alvo` (fração da curva) e fica ali. Quando ela chega, cada pacote termina a travessia em `dur`
 * segundos, começando `atraso` segundos depois, para que as chegadas fiquem espaçadas.
 */
const VARIANTES = {
    // Rápido e direto, com onda ao chegar.
    status: { saida: [0], alvo: [0.5], atraso: [0], tau: 0.25, dur: 0.28, rastro: 14, lag: 0.03, pulso: 1, onda: true },
    // Três pacotes em fila, chegada em cascata e três satélites.
    lista: { saida: [0, 0.4, 0.8], alvo: [0.5, 0.38, 0.26], atraso: [0, 0.5, 1], tau: 0.45, dur: 0.5, rastro: 14, lag: 0.03, pulso: 0.75, satelites: true },
    // Rastro longo, giro rápido do núcleo e o número da mensagem subindo.
    mensagem: { saida: [0], alvo: [0.5], atraso: [0], tau: 0.5, dur: 0.6, rastro: MAX_RASTRO, lag: 0.022, pulso: 1, giro: true },
};

function gerador(semente) {
    let s = semente;

    return () => {
        s = (s * 16807) % 2147483647;

        return (s - 1) / 2147483646;
    };
}

/** Brilho do núcleo durante a falha: apaga rápido, volta um pouco, cai de novo e se recupera. */
function luzDaFalha(e) {
    if (e < 0 || e >= FALHA_S) {
        return 1;
    }
    if (e < 0.12) {
        return 1 - 0.7 * (e / 0.12);
    }
    if (e < 0.7) {
        return 0.3;
    }
    if (e < 0.9) {
        return 0.3 + 0.35 * ((e - 0.7) / 0.2);
    }
    if (e < 1.1) {
        return 0.65 - 0.3 * ((e - 0.9) / 0.2);
    }

    return 0.35 + 0.65 * ((e - 1.1) / (FALHA_S - 1.1));
}

function suavizar(u) {
    const x = Math.min(1, Math.max(0, u));

    return x * x * (3 - 2 * x);
}

/** Textura com o número desenhado em pontos, para a partícula que sobe do núcleo. */
function criarTexturaNumero(texto) {
    const miniatura = document.createElement('canvas');
    miniatura.width = 64;
    miniatura.height = 64;
    const pequeno = miniatura.getContext('2d');
    let fonte = 52;
    pequeno.font = `700 ${fonte}px ui-monospace, Consolas, monospace`;
    while (pequeno.measureText(texto).width > 54 && fonte > 14) {
        fonte -= 2;
        pequeno.font = `700 ${fonte}px ui-monospace, Consolas, monospace`;
    }
    pequeno.textAlign = 'center';
    pequeno.textBaseline = 'middle';
    pequeno.fillStyle = '#fff';
    pequeno.fillText(texto, 32, 34);
    const dados = pequeno.getImageData(0, 0, 64, 64).data;

    const tela = document.createElement('canvas');
    tela.width = 256;
    tela.height = 256;
    const grande = tela.getContext('2d');
    grande.fillStyle = '#3df0d2';
    for (let y = 0; y < 64; y += 2) {
        for (let x = 0; x < 64; x += 2) {
            if (dados[(y * 64 + x) * 4 + 3] > 120) {
                grande.beginPath();
                grande.arc(x * 4 + 2, y * 4 + 2, 2.6, 0, Math.PI * 2);
                grande.fill();
            }
        }
    }

    return new THREE.CanvasTexture(tela);
}

/**
 * Cena em Three.js: cliente (octaedro âmbar), servidor (núcleo wireframe ciano com órbitas),
 * estrelas ao fundo e uma curva entre os dois, por onde viaja o pacote da requisição.
 *
 * `definirEstado(estado, contexto)` recebe repouso, aguardando, sucesso ou erro e, no contexto,
 * a variante da rota (status, lista ou mensagem) e o id da mensagem.
 */
export function criarCena(canvas, { painel = null, aoPerderContexto = () => {}, aoSacudir = () => {} } = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    const cena = new THREE.Scene();
    cena.fog = new THREE.FogExp2(FUNDO, 0.045);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 0, DISTANCIA_CAMERA);

    const mundo = new THREE.Group();
    cena.add(mundo);

    // Servidor: núcleo wireframe e casca interna translúcida.
    const nucleo = new THREE.Group();
    const casca = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.7, 1),
        new THREE.MeshBasicMaterial({ color: CIANO, wireframe: true, transparent: true, opacity: 0.75 }),
    );
    const miolo = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.9, 0),
        new THREE.MeshBasicMaterial({ color: CIANO, transparent: true, opacity: 0.25 }),
    );
    nucleo.add(casca, miolo);
    nucleo.position.copy(POSICAO_NUCLEO);
    mundo.add(nucleo);

    // Cliente: octaedro wireframe.
    const cliente = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.8, 0),
        new THREE.MeshBasicMaterial({ color: AMBAR, wireframe: true }),
    );
    cliente.position.copy(POSICAO_CLIENTE);
    mundo.add(cliente);

    // Órbitas do servidor.
    const orbitas = [0, 1].map((i) => {
        const toroOrbita = new THREE.Mesh(
            new THREE.TorusGeometry(2.6 + i * 0.6, 0.012, 8, 120),
            new THREE.MeshBasicMaterial({ color: CIANO, transparent: true, opacity: 0.35 }),
        );
        toroOrbita.rotation.x = Math.PI / 2.4 + i * 0.6;
        nucleo.add(toroOrbita);

        return toroOrbita;
    });

    // Estrelas ao fundo.
    const sorteio = gerador(20261024);
    const posicoes = new Float32Array(QUANTIDADE_ESTRELAS * 3);
    for (let i = 0; i < QUANTIDADE_ESTRELAS; i++) {
        posicoes[i * 3] = (sorteio() - 0.5) * 40;
        posicoes[i * 3 + 1] = (sorteio() - 0.5) * 24;
        posicoes[i * 3 + 2] = (sorteio() - 0.5) * 30 - 4;
    }
    const geometriaEstrelas = new THREE.BufferGeometry();
    geometriaEstrelas.setAttribute('position', new THREE.BufferAttribute(posicoes, 3));
    const estrelas = new THREE.Points(
        geometriaEstrelas,
        new THREE.PointsMaterial({ color: 0x7fd8e6, size: 0.05, transparent: true, opacity: 0.6 }),
    );
    cena.add(estrelas);

    // Curva entre cliente e servidor, e o cabo que a desenha.
    const curva = new THREE.CatmullRomCurve3([
        POSICAO_CLIENTE.clone(),
        new THREE.Vector3(-1.5, 1.4, 1),
        new THREE.Vector3(1.2, -1.2, -1),
        POSICAO_NUCLEO.clone(),
    ]);
    const PASSOS_CABO = 80;
    const pontosCabo = curva.getPoints(PASSOS_CABO);
    const posicoesCabo = new Float32Array(PASSOS_CABO * 6);
    const geometriaCabo = new THREE.BufferGeometry();
    geometriaCabo.setAttribute('position', new THREE.BufferAttribute(posicoesCabo, 3));
    mundo.add(new THREE.LineSegments(
        geometriaCabo,
        new THREE.LineBasicMaterial({ color: CIANO, transparent: true, opacity: 0.18 }),
    ));

    /** Escreve o cabo; os segmentos entre `de` e `ate` (fração da curva) ficam sem comprimento, ou seja, somem. */
    function desenharCabo(de = 1, ate = 0) {
        for (let j = 0; j < PASSOS_CABO; j++) {
            const inicio = pontosCabo[j];
            const fim = pontosCabo[j + 1];
            const u = (j + 0.5) / PASSOS_CABO;
            const apagado = u >= de && u <= ate;
            posicoesCabo.set([inicio.x, inicio.y, inicio.z], j * 6);
            posicoesCabo.set(apagado ? [inicio.x, inicio.y, inicio.z] : [fim.x, fim.y, fim.z], j * 6 + 3);
        }
        geometriaCabo.attributes.position.needsUpdate = true;
    }
    desenharCabo();

    // Pacotes âmbar com rastro. Até três, reaproveitados a cada requisição.
    const geometriaCabeca = new THREE.SphereGeometry(0.14, 12, 12);
    const geometriaRastro = new THREE.SphereGeometry(0.1, 8, 8);

    function criarPacote(quantidadeRastro) {
        const cabeca = new THREE.Mesh(geometriaCabeca, new THREE.MeshBasicMaterial({ color: AMBAR, transparent: true }));
        const rastro = Array.from({ length: quantidadeRastro }, (_, i) => {
            const bolha = new THREE.Mesh(
                geometriaRastro,
                new THREE.MeshBasicMaterial({ color: AMBAR, transparent: true, opacity: 0 }),
            );
            bolha.scale.setScalar(Math.max(0.12, 1 - (i * 14) / (quantidadeRastro * 16)));

            return bolha;
        });
        const grupo = new THREE.Group();
        grupo.add(cabeca, ...rastro);
        grupo.visible = false;
        mundo.add(grupo);

        return {
            grupo,
            cabeca,
            rastro,
            ativos: 14,
            lag: 0.03,
            fase: 'oculto',
            visivel: false,
            p: 0,
            saida: 0,
            alvo: 0.5,
            tau: 0.3,
            atraso: 0,
            t0: 0,
            de: 0,
            para: 1,
            dur: 0.3,
            brilho: 1,
            queda: 0,
            velocidadeQueda: 0,
            tq: 0,
        };
    }

    const pacotes = [criarPacote(MAX_RASTRO), criarPacote(14), criarPacote(14)];
    const ponto = new THREE.Vector3();

    // Glitch do erro: cópias ciano, deslocadas, do pacote e do rastro (sem pós-processamento).
    const copiaCabeca = new THREE.Mesh(geometriaCabeca, new THREE.MeshBasicMaterial({ color: CIANO, transparent: true, opacity: 0.8 }));
    const copiaRastro = Array.from({ length: 14 }, (_, i) => {
        const bolha = new THREE.Mesh(
            geometriaRastro,
            new THREE.MeshBasicMaterial({ color: CIANO, transparent: true, opacity: 0.4 * (1 - i / 14) }),
        );
        bolha.scale.setScalar(1 - i / 16);

        return bolha;
    });
    const glitch = new THREE.Group();
    glitch.add(copiaCabeca, ...copiaRastro);
    glitch.visible = false;
    mundo.add(glitch);

    // Faíscas vermelhas do pacote destruído. A cor vai a preto com a vida; com mistura aditiva, preto some.
    const faiscaPos = new Float32Array(MAX_FAISCAS * 3).fill(-100);
    const faiscaCor = new Float32Array(MAX_FAISCAS * 3);
    const faiscaVel = new Float32Array(MAX_FAISCAS * 3);
    const faiscaVida = new Float32Array(MAX_FAISCAS);
    const faiscaDuracao = new Float32Array(MAX_FAISCAS).fill(1);
    const geometriaFaiscas = new THREE.BufferGeometry();
    geometriaFaiscas.setAttribute('position', new THREE.BufferAttribute(faiscaPos, 3));
    geometriaFaiscas.setAttribute('color', new THREE.BufferAttribute(faiscaCor, 3));
    const faiscas = new THREE.Points(geometriaFaiscas, new THREE.PointsMaterial({
        size: 0.14,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
    }));
    faiscas.frustumCulled = false;
    mundo.add(faiscas);
    let faiscasVivas = 0;

    // Onda de choque do sucesso: uma coroa que cresce e some.
    const onda = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1, 64),
        new THREE.MeshBasicMaterial({ color: CIANO, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    onda.visible = false;
    mundo.add(onda);

    // Satélites da lista: três esferas pequenas que orbitam o núcleo por alguns segundos.
    const geometriaSatelite = new THREE.SphereGeometry(0.12, 10, 10);
    const satelites = [0, 1, 2].map((i) => {
        const malha = new THREE.Mesh(geometriaSatelite, new THREE.MeshBasicMaterial({ color: CIANO }));
        malha.visible = false;
        mundo.add(malha);

        return { malha, raio: 2.2 + i * 0.45, velocidade: 1.9 - i * 0.35, fase: (i * Math.PI * 2) / 3, inclinacao: 0.5 + i * 0.5 };
    });

    // Número da mensagem: sprite com a textura de pontos, criado só quando é preciso.
    let numero = null;

    let movimento = false;
    let destruido = false;
    let quadro = 0;
    let anterior = 0;
    let relogio = 0;

    const espera = { variante: VARIANTES.status, id: null, resolvido: false, modo: null, chegadas: 0 };
    // Efeitos do núcleo: pulso, vermelho e tremor vão de 1 (pico) a 0 (calmo); os demais são
    // tempos decorridos em segundos, ou -1 quando inativos.
    const efeito = { pulso: 0, vermelho: 0, tremor: 0, onda: -1, giro: -1, satelites: -1, camera: -1, falha: -1, curva: -1 };
    // Sequência do erro HTTP: o pacote para no caminho, congela, vira faíscas e o núcleo falha.
    let sequenciaErro = null;
    const paralaxe = { x: 0, y: 0 };
    const mouse = { x: 0, y: 0 };
    const corNucleo = new THREE.Color(CIANO);
    const corCiano = new THREE.Color(CIANO);
    const corErro = new THREE.Color(VERMELHO);

    function aoMoverMouse(evento) {
        mouse.x = evento.clientX / window.innerWidth - 0.5;
        mouse.y = evento.clientY / window.innerHeight - 0.5;
    }
    window.addEventListener('pointermove', aoMoverMouse);

    function descartarNumero() {
        if (numero === null) {
            return;
        }
        mundo.remove(numero.sprite);
        numero.sprite.material.map.dispose();
        numero.sprite.material.dispose();
        numero = null;
    }

    function soltarFaiscas(origem, quantidade) {
        let criadas = 0;
        for (let i = 0; i < MAX_FAISCAS && criadas < quantidade; i++) {
            if (faiscaVida[i] > 0) {
                continue;
            }
            const angulo = Math.random() * Math.PI * 2;
            const velocidade = 0.8 + Math.random() * 2.2;
            faiscaPos.set([origem.x, origem.y, origem.z], i * 3);
            faiscaVel.set([Math.cos(angulo) * velocidade, 0.6 + Math.random() * 1.6, Math.sin(angulo) * velocidade * 0.5], i * 3);
            faiscaDuracao[i] = 0.9 + Math.random() * 0.8;
            faiscaVida[i] = faiscaDuracao[i];
            criadas += 1;
            faiscasVivas += 1;
        }
    }

    function atualizarFaiscas(dt) {
        if (faiscasVivas === 0) {
            return;
        }
        let vivas = 0;
        for (let i = 0; i < MAX_FAISCAS; i++) {
            if (faiscaVida[i] <= 0) {
                continue;
            }
            faiscaVida[i] -= dt;
            if (faiscaVida[i] <= 0) {
                faiscaPos.set([0, -100, 0], i * 3);
                faiscaCor.set([0, 0, 0], i * 3);
                continue;
            }
            vivas += 1;
            faiscaVel[i * 3 + 1] -= 5 * dt;
            for (let k = 0; k < 3; k++) {
                faiscaPos[i * 3 + k] += faiscaVel[i * 3 + k] * dt;
            }
            const vida = faiscaVida[i] / faiscaDuracao[i];
            faiscaCor.set([vida, 0.48 * vida, 0.48 * vida], i * 3);
        }
        faiscasVivas = vivas;
        geometriaFaiscas.attributes.position.needsUpdate = true;
        geometriaFaiscas.attributes.color.needsUpdate = true;
    }

    function definirCorPacote(pk, cor) {
        pk.cabeca.material.color.setHex(cor);
        pk.rastro.forEach((bolha) => bolha.material.color.setHex(cor));
    }

    function limparErro() {
        sequenciaErro = null;
        efeito.camera = -1;
        efeito.falha = -1;
        if (efeito.curva >= 0) {
            efeito.curva = -1;
            desenharCabo();
        }
        faiscaVida.fill(0);
        faiscaPos.fill(-100);
        faiscaCor.fill(0);
        faiscasVivas = 0;
        geometriaFaiscas.attributes.position.needsUpdate = true;
        geometriaFaiscas.attributes.color.needsUpdate = true;
        glitch.visible = false;
        pacotes.forEach((pk) => {
            pk.brilho = 1;
            pk.queda = 0;
            definirCorPacote(pk, AMBAR);
        });
    }

    function limparEfeitos() {
        limparErro();
        efeito.onda = -1;
        onda.visible = false;
        efeito.giro = -1;
        efeito.satelites = -1;
        satelites.forEach((s) => {
            s.malha.visible = false;
        });
        descartarNumero();
    }

    function esconderPacotes() {
        pacotes.forEach((pk) => {
            pk.fase = 'oculto';
            pk.visivel = false;
            pk.grupo.visible = false;
        });
    }

    function iniciarEspera(contexto) {
        limparEfeitos();
        esconderPacotes();
        const variante = VARIANTES[contexto.variante] ?? VARIANTES.status;
        espera.variante = variante;
        espera.id = contexto.id ?? null;
        espera.resolvido = false;
        espera.modo = null;
        espera.chegadas = 0;

        variante.saida.forEach((saida, i) => {
            const pk = pacotes[i];
            pk.fase = 'espera';
            pk.visivel = false;
            // Parado (pausa ou aba oculta), o pacote já aparece no ponto de espera.
            pk.saida = movimento ? relogio + saida : relogio - 10;
            pk.alvo = variante.alvo[i];
            pk.tau = variante.tau;
            pk.atraso = variante.atraso[i];
            pk.ativos = variante.rastro;
            pk.lag = variante.lag;
            pk.rastro.forEach((bolha, k) => {
                bolha.visible = k < pk.ativos;
            });
            atualizarPacote(pk, 0);
        });
    }

    function acenderNucleo(intensidade) {
        efeito.pulso = intensidade;
    }

    function concluirSucesso() {
        if (espera.variante.satelites) {
            efeito.satelites = 0;
        }
        if (espera.variante.giro) {
            efeito.giro = 0;
            if (espera.id !== null && numero === null) {
                const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: criarTexturaNumero(String(espera.id)),
                    transparent: true,
                    opacity: 0,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                    fog: false,
                }));
                sprite.scale.setScalar(2.2);
                mundo.add(sprite);
                numero = { sprite, e: 0 };
            }
        }
    }

    /** O pacote para no caminho, congela, vira faíscas, a curva se parte, a câmera e o painel sacodem. */
    function iniciarSequenciaErro(lider) {
        lider.fase = 'parado';
        lider.visivel = true;
        sequenciaErro = { e: 0, faiscou: false, lider };
        efeito.camera = 0;
        efeito.curva = 0;
        desenharCabo(lider.p - 0.1, lider.p + 0.1);
        definirCorPacote(lider, VERMELHO);
        aoSacudir();
    }

    function chegou(pk) {
        pk.p = pk.para;
        if (espera.modo === 'erro') {
            iniciarSequenciaErro(pk);

            return;
        }
        pk.fase = 'oculto';
        pk.visivel = false;
        acenderNucleo(espera.variante.pulso);
        if (espera.variante.onda) {
            efeito.onda = 0;
            onda.visible = true;
        }
        espera.chegadas += 1;
        if (espera.chegadas === espera.variante.saida.length) {
            concluirSucesso();
        }
    }

    function atualizarPacote(pk, dt) {
        if (pk.fase === 'espera') {
            const decorrido = relogio - pk.saida;
            pk.visivel = decorrido > 0;
            pk.p = pk.visivel ? pk.alvo * (1 - Math.exp(-decorrido / pk.tau)) : 0;
            if (espera.resolvido && relogio >= pk.t0) {
                pk.fase = 'final';
                pk.de = pk.p;
                pk.t0 = relogio;
                pk.visivel = true;
            }
        } else if (pk.fase === 'final') {
            const u = (relogio - pk.t0) / pk.dur;
            pk.p = pk.de + (pk.para - pk.de) * suavizar(u);
            if (u >= 1) {
                chegou(pk);
            }
        } else if (pk.fase === 'caindo') {
            // Falha de rede: o pacote perde brilho e cai antes de chegar.
            pk.tq += dt;
            pk.velocidadeQueda += 7 * dt;
            pk.queda += pk.velocidadeQueda * dt;
            pk.brilho = Math.max(0, 1 - pk.tq / QUEDA_S);
            if (pk.tq >= QUEDA_S) {
                pk.fase = 'oculto';
                pk.visivel = false;
            }
        }
    }

    /** Anda um passo no tempo: rotações, efeitos, pacotes, onda e parallax da câmera. */
    function avancar(dt) {
        relogio += dt;

        const giro = efeito.giro >= 0 ? 1 + 5 * (1 - suavizar(efeito.giro / 1.5)) : 1;
        nucleo.rotation.y += dt * 0.25 * giro;
        nucleo.rotation.x += dt * 0.08 * giro;
        orbitas[0].rotation.z += dt * 0.4;
        orbitas[1].rotation.z -= dt * 0.3;
        cliente.rotation.y += dt * 0.5;
        estrelas.rotation.y += dt * 0.01;

        efeito.pulso = Math.max(0, efeito.pulso - dt * 1.6);
        efeito.vermelho = Math.max(0, efeito.vermelho - dt * 1.4);
        efeito.tremor = Math.max(0, efeito.tremor - dt / TREMOR_S);

        pacotes.forEach((pk) => atualizarPacote(pk, dt));

        if (efeito.onda >= 0) {
            efeito.onda += dt / 1.2;
            if (efeito.onda >= 1) {
                efeito.onda = -1;
                onda.visible = false;
            }
        }
        if (efeito.giro >= 0) {
            efeito.giro += dt;
            if (efeito.giro > 1.5) {
                efeito.giro = -1;
            }
        }
        if (efeito.satelites >= 0) {
            efeito.satelites += dt;
            if (efeito.satelites > 4) {
                efeito.satelites = -1;
                satelites.forEach((s) => {
                    s.malha.visible = false;
                });
            }
        }
        if (numero !== null) {
            numero.e += dt;
            if (numero.e > 2.6) {
                descartarNumero();
            }
        }

        atualizarFaiscas(dt);
        if (sequenciaErro !== null) {
            sequenciaErro.e += dt;
            if (!sequenciaErro.faiscou && sequenciaErro.e >= CONGELA_S) {
                const lider = sequenciaErro.lider;
                sequenciaErro.faiscou = true;
                soltarFaiscas(curva.getPoint(lider.p, ponto), 60);
                lider.fase = 'oculto';
                lider.visivel = false;
                efeito.vermelho = 1;
                efeito.pulso = 0.4;
                efeito.tremor = 1;
                efeito.falha = 0;
            }
            if (sequenciaErro.e >= CONGELA_S + FALHA_S) {
                sequenciaErro = null;
            }
        }
        if (efeito.falha >= 0) {
            efeito.falha += dt;
            if (efeito.falha >= FALHA_S) {
                efeito.falha = -1;
            }
        }
        if (efeito.camera >= 0) {
            efeito.camera += dt;
            if (efeito.camera >= CAMERA_S) {
                efeito.camera = -1;
            }
        }
        if (efeito.curva >= 0) {
            efeito.curva += dt;
            if (efeito.curva >= CURVA_PARTIDA_S) {
                efeito.curva = -1;
                desenharCabo();
            }
        }

        // Parallax suave: a câmera acompanha o mouse.
        const mistura = 1 - Math.exp(-dt * 2.4);
        paralaxe.x += (mouse.x * 2 - paralaxe.x) * mistura;
        paralaxe.y += (-mouse.y * 1.4 - paralaxe.y) * mistura;
    }

    /** Posiciona os objetos conforme o estado atual e desenha um quadro. */
    function compor() {
        const { pulso, vermelho, tremor } = efeito;

        nucleo.scale.setScalar(1 + pulso * 0.35 + Math.sin(relogio * 1.5) * 0.02);
        nucleo.position.set(
            POSICAO_NUCLEO.x + (Math.sin(relogio * 61) + Math.sin(relogio * 37)) * 0.06 * tremor,
            (Math.sin(relogio * 53) + Math.sin(relogio * 41)) * 0.06 * tremor,
            0,
        );
        const luz = luzDaFalha(efeito.falha);
        miolo.material.opacity = (0.25 + pulso * 0.6) * luz;
        casca.material.opacity = (0.75 + pulso * 0.25) * luz;

        corNucleo.copy(corCiano).lerp(corErro, vermelho).lerp(BRANCO, pulso * 0.4 * (1 - vermelho));
        casca.material.color.copy(corNucleo);
        miolo.material.color.copy(corNucleo);

        // Parado (pausa ou aba oculta), o quadro não treme nem balança.
        const tremendo = movimento ? 1 : 0;
        pacotes.forEach((pk) => {
            pk.grupo.visible = pk.visivel;
            if (!pk.visivel) {
                return;
            }
            pk.grupo.position.y = -pk.queda;
            pk.rastro.forEach((bolha, k) => {
                if (k >= pk.ativos) {
                    return;
                }
                curva.getPoint(Math.min(1, Math.max(0, pk.p - k * pk.lag)), ponto);
                bolha.position.copy(ponto);
                bolha.material.opacity = 0.5 * (1 - k / pk.ativos) * pk.brilho;
            });
            curva.getPoint(Math.min(1, Math.max(0, pk.p)), ponto);
            pk.cabeca.position.copy(ponto);
            pk.cabeca.material.opacity = pk.brilho;
        });

        const travado = sequenciaErro !== null && !sequenciaErro.faiscou ? sequenciaErro.lider : null;
        glitch.visible = travado !== null;
        if (travado !== null) {
            // Micro tremor do pacote parado e cópias ciano deslocadas, em movimento suave.
            const treme = tremendo * 0.025;
            travado.cabeca.position.x += Math.sin(relogio * 70) * treme;
            travado.cabeca.position.y += Math.sin(relogio * 53 + 1) * treme;
            const dx = Math.sin(relogio * 23) * 0.14 * tremendo + 0.06;
            const dy = Math.cos(relogio * 31) * 0.08 * tremendo;
            copiaCabeca.position.copy(travado.cabeca.position).add(ponto.set(dx, dy, 0.05));
            copiaRastro.forEach((bolha, k) => {
                bolha.visible = k < travado.ativos;
                bolha.position.copy(travado.rastro[Math.min(k, travado.ativos - 1)].position).add(ponto.set(dx, dy, 0.05));
            });
        }

        if (onda.visible) {
            onda.position.copy(POSICAO_NUCLEO);
            onda.scale.setScalar(1 + efeito.onda * 9);
            onda.material.opacity = Math.max(0, 0.9 * (1 - efeito.onda));
            onda.lookAt(camera.position);
        }

        if (efeito.satelites >= 0) {
            const e = efeito.satelites;
            const tamanho = suavizar(e / 0.5) * suavizar((4 - e) / 0.6);
            satelites.forEach((s) => {
                const a = s.fase + e * s.velocidade;
                s.malha.visible = tamanho > 0.01;
                s.malha.scale.setScalar(tamanho);
                s.malha.position.set(
                    POSICAO_NUCLEO.x + Math.cos(a) * s.raio,
                    Math.sin(a) * Math.sin(s.inclinacao) * s.raio,
                    Math.sin(a) * Math.cos(s.inclinacao) * s.raio,
                );
            });
        }

        if (numero !== null) {
            const e = numero.e;
            const subida = 1 - (1 - Math.min(1, e / 1.6)) ** 2;
            numero.sprite.position.set(POSICAO_NUCLEO.x, 0.4 + 2.3 * subida, 0.5);
            numero.sprite.material.opacity = suavizar(e / 0.35) * (1 - suavizar((e - 1.7) / 0.9));
            numero.sprite.scale.setScalar(1.6 + 0.6 * suavizar(e / 1.2));
        }

        const balanco = efeito.camera >= 0 ? (1 - efeito.camera / CAMERA_S) * tremendo * 0.16 : 0;
        camera.position.set(
            paralaxe.x + Math.sin(relogio * 47) * balanco,
            paralaxe.y + Math.sin(relogio * 39 + 1) * balanco,
            DISTANCIA_CAMERA,
        );
        camera.lookAt(0, 0, 0);
        renderer.render(cena, camera);
    }

    function passo(agora) {
        if (!movimento || destruido) {
            return;
        }
        const dt = Math.min((agora - anterior) / 1000, 0.05);
        anterior = agora;
        avancar(dt);
        compor();
        quadro = requestAnimationFrame(passo);
    }

    /** Parado, avança o relógio até o primeiro momento marcante, para o quadro congelado dizer o resultado. */
    function adiantar() {
        const pronto = () => {
            if (espera.modo === 'sucesso') {
                return espera.chegadas >= 1;
            }
            if (espera.modo === 'erro') {
                return sequenciaErro !== null && sequenciaErro.e >= 0.12;
            }

            return pacotes[0].tq >= 0.3;
        };
        for (let i = 0; i < 240 && !pronto(); i++) {
            avancar(1 / 60);
        }
    }

    /**
     * Cobre a tela inteira, como na versão original. No computador o núcleo ocupa a área
     * à direita do painel; no celular a cena inteira cabe acima do painel.
     */
    function redimensionar() {
        const largura = Math.max(1, window.innerWidth);
        const altura = Math.max(1, window.innerHeight);
        renderer.setSize(largura, altura, false);
        camera.aspect = largura / altura;
        camera.updateProjectionMatrix();

        // Unidades do mundo por pixel no plano do núcleo.
        const porPixel = (2 * DISTANCIA_CAMERA * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / altura;
        const caixa = painel ? painel.getBoundingClientRect() : null;

        if (largura > LARGURA_CELULAR) {
            // A curva sai de trás do painel: o trecho visível começa em X_VISIVEL e a órbita
            // externa termina na borda direita da tela.
            const direita = caixa ? caixa.right : largura * 0.4;
            const extensao = POSICAO_NUCLEO.x + 3.2 - X_VISIVEL;
            const escala = THREE.MathUtils.clamp(((largura - direita - 40) * porPixel) / extensao, 0.55, 1.2);
            mundo.scale.setScalar(escala);
            mundo.position.set((direita + 20 - largura / 2) * porPixel - X_VISIVEL * escala, 0, 0);
        } else {
            const topoPainel = caixa ? caixa.top + window.scrollY : altura * 0.38;
            const area = THREE.MathUtils.clamp(topoPainel, altura * 0.2, altura * 0.6);
            const escala = Math.min(
                (0.96 * largura * porPixel) / LARGURA_UTIL,
                (0.9 * area * porPixel) / 6.8,
                0.6,
            );
            mundo.scale.setScalar(escala);
            mundo.position.set(-CENTRO_UTIL_X * escala, (altura / 2 - area / 2) * porPixel, 0);
        }

        if (!movimento) {
            compor();
        }
    }

    const observador = new ResizeObserver(redimensionar);
    observador.observe(document.documentElement);
    if (painel) {
        observador.observe(painel);
    }

    canvas.addEventListener('webglcontextlost', (evento) => {
        evento.preventDefault();
        aoPerderContexto();
    });

    redimensionar();

    return {
        definirEstado(novo, contexto = {}) {
            if (destruido) {
                return;
            }
            if (novo === 'aguardando') {
                iniciarEspera(contexto);
            } else if (novo === 'repouso') {
                limparEfeitos();
                esconderPacotes();
                espera.modo = null;
            } else {
                const emEspera = espera.modo === null && pacotes[0].fase !== 'oculto';
                if (!emEspera) {
                    iniciarEspera(contexto);
                }
                espera.resolvido = true;
                espera.modo = novo === 'sucesso' ? 'sucesso' : 'erro';
                if (contexto.id !== undefined) {
                    espera.id = contexto.id;
                }
                const v = espera.variante;
                if (novo === 'sucesso') {
                    pacotes.slice(0, v.saida.length).forEach((pk, i) => {
                        pk.t0 = relogio + v.atraso[i];
                        pk.para = 1;
                        pk.dur = v.dur;
                    });
                } else if (contexto.falha === 'rede') {
                    // Sem resposta: os pacotes perdem brilho e caem, sem tremor.
                    espera.modo = 'rede';
                    pacotes.forEach((pk) => {
                        if (pk.visivel) {
                            pk.fase = 'caindo';
                            pk.tq = 0;
                            pk.velocidadeQueda = 0;
                        } else {
                            pk.fase = 'oculto';
                        }
                    });
                    efeito.vermelho = 0.35;
                } else {
                    // Erro HTTP: só o primeiro pacote segue; ele para no caminho e se desfaz.
                    pacotes.slice(1).forEach((pk) => {
                        if (pk.visivel) {
                            soltarFaiscas(curva.getPoint(pk.p, ponto), 10);
                        }
                        pk.fase = 'oculto';
                        pk.visivel = false;
                    });
                    const lider = pacotes[0];
                    lider.t0 = relogio;
                    lider.para = Math.max(PARADA_ERRO, lider.p + 0.05);
                    lider.dur = 0.3;
                }
                if (!movimento) {
                    adiantar();
                }
            }

            if (!movimento) {
                compor();
            }
        },
        definirMovimento(ligado) {
            if (destruido || ligado === movimento) {
                return;
            }
            movimento = ligado;
            cancelAnimationFrame(quadro);
            if (ligado) {
                anterior = performance.now();
                quadro = requestAnimationFrame(passo);
            } else {
                compor();
            }
        },
        destruir() {
            destruido = true;
            movimento = false;
            cancelAnimationFrame(quadro);
            observador.disconnect();
            window.removeEventListener('pointermove', aoMoverMouse);
            descartarNumero();
            cena.traverse((objeto) => {
                objeto.geometry?.dispose();
                objeto.material?.map?.dispose();
                objeto.material?.dispose();
            });
            renderer.dispose();
            renderer.forceContextLoss();
        },
    };
}
