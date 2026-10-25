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
const PONTOS_RASTRO = 14;
const TRANSITO_S = 1.1; // tempo do pacote para cruzar a curva
const CHEGADA_S = 0.4; // tempo para terminar a travessia quando a resposta já chegou
const TREMOR_S = 0.6;
const DISTANCIA_CAMERA = 11;
const LARGURA_CELULAR = 860; // mesma largura em que o CSS empilha o painel acima da cena
// Extensão horizontal da cena (do cliente à borda da órbita externa), para caber em telas estreitas.
const LARGURA_UTIL = 12.8;
const CENTRO_UTIL_X = 1;

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

/**
 * Cena em Three.js: cliente (octaedro âmbar), servidor (núcleo wireframe ciano com órbitas),
 * estrelas ao fundo e uma curva entre os dois, por onde viaja o pacote da requisição.
 *
 * Estados: repouso (cena calma), aguardando (pacote em trânsito), sucesso (o núcleo brilha
 * em ciano uma vez) e erro (o núcleo pisca em vermelho e treme por cerca de 600 ms).
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

    // Pacote âmbar com rastro. Um só conjunto de malhas, reaproveitado a cada requisição.
    const pacote = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), new THREE.MeshBasicMaterial({ color: AMBAR }));
    const geometriaRastro = new THREE.SphereGeometry(0.1, 8, 8);
    const rastro = Array.from({ length: PONTOS_RASTRO }, (_, i) => {
        const bolha = new THREE.Mesh(
            geometriaRastro,
            new THREE.MeshBasicMaterial({ color: AMBAR, transparent: true, opacity: 0.5 * (1 - i / PONTOS_RASTRO) }),
        );
        bolha.scale.setScalar(1 - i / 16);

        return bolha;
    });
    const viajante = new THREE.Group();
    viajante.add(pacote, ...rastro);
    viajante.visible = false;
    mundo.add(viajante);

    // Onda de choque do sucesso: uma coroa que cresce e some.
    const onda = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1, 64),
        new THREE.MeshBasicMaterial({ color: CIANO, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    onda.visible = false;
    mundo.add(onda);

    let estado = 'repouso';
    let movimento = false;
    let destruido = false;
    let quadro = 0;
    let anterior = 0;
    let relogio = 0;

    // Pacote: progresso de 0 a 1 na curva; "chegando" acelera o fim assim que a resposta vem.
    const viagem = { ativa: false, chegando: false, p: 0 };
    // Efeitos do núcleo, de 1 (pico) a 0 (calmo).
    const efeito = { pulso: 0, vermelho: 0, tremor: 0, onda: 1 };
    const mouse = { x: 0, y: 0 };
    const corNucleo = new THREE.Color(CIANO);
    const corCiano = new THREE.Color(CIANO);
    const corErro = new THREE.Color(VERMELHO);

    function aoMoverMouse(evento) {
        mouse.x = evento.clientX / window.innerWidth - 0.5;
        mouse.y = evento.clientY / window.innerHeight - 0.5;
    }
    window.addEventListener('pointermove', aoMoverMouse);

    function esconderPacote() {
        viagem.ativa = false;
        viagem.chegando = false;
        viajante.visible = false;
    }

    function dispararEfeito(tipo, animado) {
        if (tipo === 'sucesso') {
            efeito.pulso = animado ? 1 : 0.6;
            if (animado) {
                efeito.onda = 0;
                onda.visible = true;
            }
        } else {
            efeito.pulso = 0.5;
            efeito.vermelho = 1;
            efeito.tremor = animado ? 1 : 0;
        }
    }

    function chegar() {
        esconderPacote();
        dispararEfeito(estado, true);
    }

    /** Anda um passo no tempo: rotações, efeitos, pacote, onda e parallax da câmera. */
    function avancar(dt) {
        relogio += dt;

        nucleo.rotation.y += dt * 0.25;
        nucleo.rotation.x += dt * 0.08;
        orbitas[0].rotation.z += dt * 0.4;
        orbitas[1].rotation.z -= dt * 0.3;
        cliente.rotation.y += dt * 0.5;
        estrelas.rotation.y += dt * 0.01;

        efeito.pulso = Math.max(0, efeito.pulso - dt * 1.6);
        efeito.vermelho = Math.max(0, efeito.vermelho - dt * 1.4);
        efeito.tremor = Math.max(0, efeito.tremor - dt / TREMOR_S);

        if (viagem.ativa) {
            viagem.p += dt / (viagem.chegando ? CHEGADA_S : TRANSITO_S);
            if (viagem.p >= 1) {
                if (viagem.chegando) {
                    chegar();
                } else {
                    viagem.p -= 1; // ainda sem resposta: um novo pacote sai do cliente
                }
            }
        }

        if (onda.visible) {
            efeito.onda += dt / 1.2;
            if (efeito.onda >= 1) {
                onda.visible = false;
            }
        }

        // Parallax suave: a câmera acompanha o mouse.
        const mistura = 1 - Math.exp(-dt * 2.4);
        camera.position.x += (mouse.x * 2 - camera.position.x) * mistura;
        camera.position.y += (-mouse.y * 1.4 - camera.position.y) * mistura;
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

        if (viagem.ativa) {
            viajante.visible = true;
            pacote.position.copy(curva.getPoint(suavizar(viagem.p)));
            rastro.forEach((bolha, k) => {
                bolha.position.copy(curva.getPoint(suavizar(viagem.p - k * 0.0303)));
            });
        }

        if (onda.visible) {
            const tamanho = 1 + efeito.onda * 9;
            onda.position.copy(POSICAO_NUCLEO);
            onda.scale.setScalar(tamanho);
            onda.material.opacity = Math.max(0, 0.9 * (1 - efeito.onda));
            onda.lookAt(camera.position);
        }

        camera.position.z = DISTANCIA_CAMERA;
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

    /**
     * Cobre a janela inteira, como na versão original. No computador o núcleo fica no centro
     * da área livre à direita do painel; no celular a cena inteira cabe acima do painel.
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
            const direita = caixa ? caixa.right : largura * 0.4;
            const livre = Math.max(1, largura - direita);
            const escala = THREE.MathUtils.clamp((0.92 * livre * porPixel) / (LARGURA_UTIL / 2), 0.55, 1.2);
            const centroX = (direita + largura) / 2;
            mundo.scale.setScalar(escala);
            mundo.position.set((centroX - largura / 2) * porPixel - POSICAO_NUCLEO.x * escala, 0, 0);
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
        definirEstado(novo) {
            if (destruido || novo === estado) {
                return;
            }
            estado = novo;

            if (novo === 'aguardando') {
                viagem.ativa = true;
                viagem.chegando = false;
                // Parado (pausa ou aba oculta), mostra o pacote no meio da curva.
                viagem.p = movimento ? 0 : 0.5;
            } else if (novo === 'repouso') {
                esconderPacote();
            } else if (viagem.ativa && movimento) {
                viagem.chegando = true; // o pacote termina a travessia e só então o núcleo reage
            } else {
                esconderPacote();
                dispararEfeito(novo, false);
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
            cena.traverse((objeto) => {
                objeto.geometry?.dispose();
                objeto.material?.dispose();
            });
            renderer.dispose();
            renderer.forceContextLoss();
        },
    };
}
