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
export function criarCena(canvas, { painel = null, aoPerderContexto = () => {} } = {}) {
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
    mundo.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curva.getPoints(80)),
        new THREE.LineBasicMaterial({ color: CIANO, transparent: true, opacity: 0.18 }),
    ));

    // Pacotes âmbar com rastro. Até três, reaproveitados a cada requisição.
    const geometriaCabeca = new THREE.SphereGeometry(0.14, 12, 12);
    const geometriaRastro = new THREE.SphereGeometry(0.1, 8, 8);

    function criarPacote(quantidadeRastro) {
        const cabeca = new THREE.Mesh(geometriaCabeca, new THREE.MeshBasicMaterial({ color: AMBAR }));
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
        };
    }

    const pacotes = [criarPacote(MAX_RASTRO), criarPacote(14), criarPacote(14)];
    const ponto = new THREE.Vector3();

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
    const efeito = { pulso: 0, vermelho: 0, tremor: 0, onda: -1, giro: -1, satelites: -1 };
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

    function limparEfeitos() {
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

    function chegou(pk) {
        pk.p = pk.para;
        pk.fase = 'oculto';
        pk.visivel = false;
        if (espera.modo === 'sucesso') {
            acenderNucleo(espera.variante.pulso);
            if (espera.variante.onda) {
                efeito.onda = 0;
                onda.visible = true;
            }
            espera.chegadas += 1;
            if (espera.chegadas === espera.variante.saida.length) {
                concluirSucesso();
            }
        } else {
            efeito.pulso = 0.5;
            efeito.vermelho = 1;
            efeito.tremor = 1;
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
        miolo.material.opacity = 0.25 + pulso * 0.6;
        casca.material.opacity = 0.75 + pulso * 0.25;

        corNucleo.copy(corCiano).lerp(corErro, vermelho).lerp(BRANCO, pulso * 0.4 * (1 - vermelho));
        casca.material.color.copy(corNucleo);
        miolo.material.color.copy(corNucleo);

        pacotes.forEach((pk) => {
            pk.grupo.visible = pk.visivel;
            if (!pk.visivel) {
                return;
            }
            pk.rastro.forEach((bolha, k) => {
                if (k >= pk.ativos) {
                    return;
                }
                curva.getPoint(Math.min(1, Math.max(0, pk.p - k * pk.lag)), ponto);
                bolha.position.copy(ponto);
                bolha.material.opacity = 0.5 * (1 - k / pk.ativos);
            });
            curva.getPoint(Math.min(1, Math.max(0, pk.p)), ponto);
            pk.cabeca.position.copy(ponto);
        });

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

        camera.position.set(paralaxe.x, paralaxe.y, DISTANCIA_CAMERA);
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
        for (let i = 0; i < 180 && espera.chegadas < 1 && efeito.vermelho === 0; i++) {
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
                pacotes.slice(0, v.saida.length).forEach((pk, i) => {
                    pk.t0 = relogio + v.atraso[i];
                    pk.para = 1;
                    pk.dur = v.dur;
                });
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
