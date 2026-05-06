// --- 0. CONEXÃO COM A NUVEM (FIREBASE) ---
import { getFirestore, collection, addDoc, getDocs, onSnapshot, deleteDoc, doc, updateDoc, query, where, setDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
// NOVO: Ferramentas do Storage
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-storage.js";
const firebaseConfig = {
  apiKey: "AIzaSyAHk_Rwev-ZkkzJflzh7l5Ei1EBZwEgntA",
  authDomain: "dashboard-financeiro-911a0.firebaseapp.com",
  projectId: "dashboard-financeiro-911a0",
  storageBucket: "dashboard-financeiro-911a0.firebasestorage.app",
  messagingSenderId: "329815045435",
  appId: "1:329815045435:web:37cbd62ed7fd399fcc731e"
  // Removi o analytics para manter o app focado em performance
};

// ==========================================
// FORMATADOR GLOBAL DE MOEDA BRASILEIRA (UX PREMIUM)
// ==========================================
window.formatarMoedaBR = function(valor) {
    const numero = parseFloat(valor) || 0;
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(numero);
};

// Ligando o motor
const app = initializeApp(firebaseConfig);

// Criando o "gancho" para o Banco de Dados, Autenticação e Storage
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app); // <-- LINHA NOVA

// --- 1. PREPARAÇÃO DO BANCO DE DADOS (DEV vs PROD) ---
let transacoes = [];
let coresContas = {}; 
let categorias = []; // NOVO: Faltava declarar esta variável!
let coresCategorias = {}; // NOVO: Faltava declarar esta também!

// O detetive blindado: Se a URL NÃO contém "github.io", é o seu VS Code.
const rodandoNoComputador = !window.location.hostname.includes("github.io");

// SISTEMA DE CATEGORIA SALVO NO BANCO
const nomeColecaoCategorias = rodandoNoComputador ? "categorias_teste" : "categorias_oficial";
const categoriasRef = collection(db, nomeColecaoCategorias);
let categoriaEmEdicaoId = null; 

// SISTEMA DE CARTEIRA SALVO NO BANCO
const nomeColecaoCarteiras = rodandoNoComputador ? "banco_teste" : "banco_oficial";
const carteirasRef = collection(db, nomeColecaoCarteiras);
let sortableContasInstance = null;

const nomeDaColecao = rodandoNoComputador ? "Privado_teste" : "Privado_oficial";
const transacoesRef = collection(db, nomeDaColecao);

if (rodandoNoComputador) {
    console.warn("🛠️ MODO DESENVOLVIMENTO: Gravando na pasta 'Privado_Teste'");
} else {
    console.log("🚀 MODO PRODUÇÃO: Conectado ao banco Privado_oficial!");
}

// 1. Abrir e Fechar Modal
document.getElementById('btn-abrir-modal-conta').addEventListener('click', () => {
    document.getElementById('modal-contas').style.display = 'flex';
});
document.getElementById('fechar-modal-contas').addEventListener('click', () => {
    document.getElementById('modal-contas').style.display = 'none';
});

// Variável global para saber se estamos criando ou editando
let idContaEmEdicao = null; 

// 2. Salvar ou Atualizar Conta
document.getElementById('btn-salvar-conta').addEventListener('click', async () => {
    const inputNome = document.getElementById('nome-nova-conta');
    const inputCor = document.getElementById('cor-nova-conta');
    const nomeBanco = inputNome.value.trim();

    if (nomeBanco !== "") {
        const btnSalvar = document.getElementById('btn-salvar-conta');
        btnSalvar.innerText = "...";
        
        try {
            if (idContaEmEdicao) {
                // MODO EDIÇÃO: Atualiza a conta existente
                await updateDoc(doc(db, nomeColecaoCarteiras, idContaEmEdicao), {
                    nome: nomeBanco,
                    cor: inputCor.value
                });
                idContaEmEdicao = null; // Limpa a memória de edição
            } else {
                // MODO NOVO: Cria uma conta do zero
                await addDoc(carteirasRef, {
                    nome: nomeBanco,
                    cor: inputCor.value,
                    criadoEm: Date.now(),
                    userId: auth.currentUser.uid 
                });
            }
            inputNome.value = "";
            inputNome.focus();
            btnSalvar.innerText = "Salvar";
        } catch (erro) {
            console.error(erro);
            alert("Erro ao salvar conta. Verifique sua conexão.");
            btnSalvar.innerText = idContaEmEdicao ? "Atualizar" : "Salvar";
        }
    }
});

// 3. Funções de Ação (Editar e Excluir)
window.prepararEdicaoConta = function(docId, nomeAtual, corAtual) {
    document.getElementById('nome-nova-conta').value = nomeAtual;
    document.getElementById('cor-nova-conta').value = corAtual || '#8A05BE';
    
    idContaEmEdicao = docId; // Memoriza o ID que estamos editando
    document.getElementById('btn-salvar-conta').innerText = "Atualizar";
};

window.excluirConta = async function(docId, nomeConta) {
    if (confirm(`Tem certeza que deseja excluir a conta "${nomeConta}"?`)) {
        try {
            await deleteDoc(doc(db, nomeColecaoCarteiras, docId));
        } catch (erro) {
            alert("Erro ao excluir a conta.");
        }
    }
};

// 4. O Ouvinte que atualiza TUDO ao mesmo tempo (Contas)
let ouvinteContas = null;

function iniciarOuvinteContas() {
    if (ouvinteContas) ouvinteContas(); // Limpa se já existir, para não duplicar

    const user = auth.currentUser;
    if (!user) return;

    // AGORA SIM: Todo mundo (incluindo o Mestre) só puxa os seus próprios bancos!
    const consultaContas = query(carteirasRef, where("userId", "==", user.uid));

    ouvinteContas = onSnapshot(consultaContas, (snapshot) => {
        const selectConta = document.getElementById('conta');
        const selectFiltroConta = document.getElementById('filtro-conta'); 
        const listaModal = document.getElementById('lista-contas');
        
        // LIMPEZA TOTAL ANTES DE PREENCHER
        if (selectConta) selectConta.innerHTML = '<option value="" disabled selected>Selecione a conta...</option>';
        if (selectFiltroConta) selectFiltroConta.innerHTML = '<option value="todas">Todas as Contas</option>';
        if (listaModal) listaModal.innerHTML = ''; 
        
        let temConta = false;
        coresContas = {}; 

        // PASSO 1: Puxa do banco e coloca numa lista temporária para podermos organizar
        let listaDeContas = [];
        snapshot.forEach((docSnap) => {
            listaDeContas.push({ id: docSnap.id, ...docSnap.data() });
        });

        // PASSO 2: Ordena matematicamente pelo carimbo 'ordem'
        listaDeContas.sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999));

        // PASSO 3: Desenha tudo na tela, agora na ordem rigorosa
        listaDeContas.forEach((carteira) => {
            const docId = carteira.id; 
            const corDaConta = carteira.cor || '#b2bec3';
            
            if (selectConta) selectConta.innerHTML += `<option value="${carteira.nome}" style="color: ${corDaConta}; font-weight: 600;">${carteira.nome}</option>`;
            if (selectFiltroConta) selectFiltroConta.innerHTML += `<option value="${carteira.nome}">${carteira.nome}</option>`;
            
            if (listaModal) {
                listaModal.innerHTML += `
                    <li class="item-categoria drag-item" data-nome="${carteira.nome}" data-id="${docId}">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <i class="fa-solid fa-grip-lines drag-handle" style="cursor: grab; color: #dfe6e9; padding: 5px 10px; font-size: 16px; transition: 0.2s;" title="Arraste para reordenar"></i>
                            <span style="display: inline-block; width: 14px; height: 14px; border-radius: 50%; background-color: ${corDaConta};"></span>
                            <span style="color: var(--texto); font-weight: 500; font-size: 14px;">${carteira.nome}</span>
                        </div>
                        <div style="display: flex; gap: 15px; align-items: center;">
                            <i class="fa-solid fa-pen" style="color: #0984e3; cursor: pointer; padding: 5px;" onclick="prepararEdicaoConta('${docId}', '${carteira.nome}', '${corDaConta}')" title="Editar"></i>
                            <button class="btn-del-cat" onclick="excluirConta('${docId}', '${carteira.nome}')" title="Excluir" style="background: transparent; border: none; margin: 0; padding: 0;"><i class="fa-solid fa-trash" style="color: #ff7675; cursor: pointer; padding: 5px;"></i></button>
                        </div>
                    </li>
                `;
            }
            coresContas[carteira.nome] = corDaConta; 
            temConta = true;
        });

        if (!temConta && selectConta) {
            selectConta.innerHTML = '<option value="" disabled selected>Clique no + para criar uma conta</option>';
            if (listaModal) listaModal.innerHTML = '<div style="text-align: center; color: var(--texto-secundario); padding: 20px;">Nenhuma conta cadastrada.</div>';
        } else if (typeof ultimaContaAdicionada !== 'undefined' && ultimaContaAdicionada && selectConta) {
            selectConta.value = ultimaContaAdicionada;
        }
        
        atualizarCorDaConta();

        // PASSO 4: A Mágica de Salvar a Ordem no Firebase
        if (listaModal) {
            if (sortableContasInstance) sortableContasInstance.destroy(); 
            sortableContasInstance = new Sortable(listaModal, {
                animation: 150, handle: '.drag-handle', filter: '.fixed-item',
                onEnd: function () {
                    const itensNaTela = document.querySelectorAll('#lista-contas .item-categoria');
                    itensNaTela.forEach((li, index) => {
                        const docId = li.getAttribute('data-id');
                        updateDoc(doc(db, nomeColecaoCarteiras, docId), { ordem: index });
                    });
                }
            });
        }

        atualizarTela();
    });
}
// --- 1.1. GESTÃO DO TEMA CLARO/ESCURO ---
const temaSalvo = localStorage.getItem('temaDashboard');
if (temaSalvo === 'dark' || (!temaSalvo && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.body.classList.add('dark-theme');
}

function toggleTheme() {
    const body = document.body;
    const btnIcon = document.querySelector('#theme-toggle i');
    body.classList.toggle('dark-theme');
    
    if (body.classList.contains('dark-theme')) {
        btnIcon.classList.replace('fa-moon', 'fa-sun');
        localStorage.setItem('temaDashboard', 'dark');
    } else {
        btnIcon.classList.replace('fa-sun', 'fa-moon');
        localStorage.setItem('temaDashboard', 'light');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const btnIcon = document.querySelector('#theme-toggle i');
    if (document.body.classList.contains('dark-theme')) {
        btnIcon.classList.replace('fa-moon', 'fa-sun');
    }
});

let metaNome = localStorage.getItem('metaNome') || 'Meta do Período';
let metaFinanceira = parseFloat(localStorage.getItem('metaFinanceira')) || 0;
let graficoRosca = null;
let graficoRoscaBarras = null;

// --- 2. CAPTURANDO ELEMENTOS ---
const form = document.getElementById('form-transacao');
const corpoTabela = document.getElementById('corpo-tabela');
const displayReceita = document.getElementById('total-receita');
const displayDespesa = document.getElementById('total-despesa');
const displayLucro = document.getElementById('lucro-liquido');

const filtroTipo = document.getElementById('filtro-tipo');
const filtroCategoria = document.getElementById('filtro-categoria');
const filtroDataInicio = document.getElementById('filtro-data-inicio');
const filtroDataFim = document.getElementById('filtro-data-fim');
const filtroConta = document.getElementById('filtro-conta'); // Adicione nos capturadores se quiser

// --- 3. INICIALIZAÇÃO E DATAS ---
function getDataHoje() {
    const data = new Date();
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

document.getElementById('data').value = getDataHoje();

filtroTipo.addEventListener('change', atualizarTela);
filtroCategoria.addEventListener('change', atualizarTela);
filtroDataInicio.addEventListener('change', atualizarTela);
filtroDataFim.addEventListener('change', atualizarTela);


if (filtroConta) filtroConta.addEventListener('change', atualizarTela);

// --- FUNÇÃO MATEMÁTICA: CONTRASTE AUTOMÁTICO (YIQ) ---
function getCorTextoIdeal(hexColor) {
    if (!hexColor) return '#ffffff';
    hexColor = hexColor.replace('#', '');
    
    // Converte HEX para RGB
    const r = parseInt(hexColor.substr(0, 2), 16);
    const g = parseInt(hexColor.substr(2, 2), 16);
    const b = parseInt(hexColor.substr(4, 2), 16);
    
    // Calcula a luminosidade (Fórmula YIQ de percepção humana)
    const luminosidade = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    
    // Retorna Preto Chumbo se o fundo for claro, e Branco se o fundo for escuro
    return (luminosidade > 128) ? '#2d3436' : '#ffffff';
}

// --- FUNÇÃO VISUAL: COLORE A CAIXA DA CONTA ---
function atualizarCorDaConta() {
    const select = document.getElementById('conta');
    const cor = coresContas[select.value] || '#b2bec3';
    // Força a borda da mesma largura e cor que a categoria
    select.style.borderLeft = `5px solid ${cor}`; 
}
// NOVO: Obriga o navegador a pintar a borda na mesma hora que você troca de banco!
document.getElementById('conta').addEventListener('change', atualizarCorDaConta);

// --- FUNÇÃO VISUAL: COLORE A CAIXA DE SELEÇÃO ---
function atualizarCorDaCaixaDeSelecao() {
    const select = document.getElementById('categoria');
    const cor = coresCategorias[select.value] || '#b2bec3';
    // Coloca uma borda grossa na esquerda com a cor da categoria
    select.style.borderLeft = `6px solid ${cor}`;
}
document.getElementById('categoria').addEventListener('change', atualizarCorDaCaixaDeSelecao);

// --- 4. GESTÃO DE METAS ---
function definirMeta() {
    const novoNome = prompt("Como se chama esta meta? (ex: Meta de Abril)", metaNome);
    if (novoNome === null) return; 
    
    const novoValor = prompt(`Qual o valor para "${novoNome}"?`, metaFinanceira);
    if (novoValor !== null && !isNaN(novoValor)) {
        metaNome = novoNome;
        metaFinanceira = parseFloat(novoValor);
        localStorage.setItem('metaNome', metaNome);
        localStorage.setItem('metaFinanceira', metaFinanceira);
        atualizarTela(); 
    }
}

function atualizarProgressoMeta(faturamentoTotal) {
    document.getElementById('nome-meta-display').innerText = metaNome;
    document.getElementById('display-meta').innerText = formatarMoedaBR(metaFinanceira);

    const barra = document.getElementById('barra-progresso');
    const texto = document.getElementById('texto-progresso');

    if (metaFinanceira > 0) {
        let porcentagem = (faturamentoTotal / metaFinanceira) * 100;
        if (porcentagem > 100) porcentagem = 100;

        barra.style.width = `${porcentagem}%`;
        barra.style.background = porcentagem >= 100 ? 'linear-gradient(135deg, #00b894, #55efc4)' : 'var(--gradiente-meta)';
        texto.innerText = `${porcentagem.toFixed(1)}% atingido`;
    } else {
        barra.style.width = '0%';
        texto.innerText = 'Defina uma meta';
    }
}

// --- 5. GESTÃO DE CATEGORIAS (MIGRADO PARA NUVEM) ---
let sortableInstance = null;

// 1. Ouvinte em Tempo Real das Categorias na Nuvem
let ouvinteCategorias = null;
function iniciarOuvinteCategorias() {
    if (ouvinteCategorias) ouvinteCategorias(); // Limpa se já existir
    
    const user = auth.currentUser;
    if (!user) return;

    // AGORA SIM: Todo mundo (incluindo o Mestre) só puxa suas próprias categorias!
    const consultaCat = query(categoriasRef, where("userId", "==", user.uid));

    ouvinteCategorias = onSnapshot(consultaCat, (snapshot) => {
        const selectForm = document.getElementById('categoria');
        const selectFiltro = document.getElementById('filtro-categoria');
        const listaModal = document.getElementById('lista-categorias-modal') || document.getElementById('lista-categorias'); 

        const categoriaSelecionadaAntes = selectForm ? selectForm.value : 'Geral';

        // Zera as variáveis para reconstruir com dados frescos da nuvem
        categorias = ['Geral'];
        coresCategorias = { 'Geral': '#b2bec3' };

        if (selectForm) selectForm.innerHTML = '';
        if (selectFiltro) selectFiltro.innerHTML = '<option value="todas">Todas as Categorias</option>';
        if (listaModal) listaModal.innerHTML = '';

        // A. Carrega as categorias do Firebase
        snapshot.forEach((docSnap) => {
            const cat = docSnap.data();
            const id = docSnap.id;
            
            if(cat.nome !== 'Geral' && !categorias.includes(cat.nome)) {
                categorias.push(cat.nome);
                coresCategorias[cat.nome] = cat.cor || '#b2bec3';
            }
            // Guarda o ID do Firebase escondido para podermos editar/excluir depois
            coresCategorias[cat.nome + '_id'] = id; 
        });

        // B. Renderiza tudo na tela
        categorias.forEach((cat) => {
            let corDaCategoria = coresCategorias[cat];
            let idDoBanco = coresCategorias[cat + '_id']; 

            // Injeta nos selects (Com a cor no texto!)
            if (selectForm) selectForm.innerHTML += `<option value="${cat}" style="color: ${corDaCategoria}; font-weight: 600;">${cat}</option>`;
            if (selectFiltro) selectFiltro.innerHTML += `<option value="${cat}">${cat}</option>`;
            
            let htmlBolinhaColorida = `<span style="width: 12px; height: 12px; border-radius: 50%; background-color: ${corDaCategoria}; display: inline-block;"></span>`;

            // Injeta no Modal
            if (listaModal) {
                if (cat !== 'Geral') {
                    listaModal.innerHTML += `
                        <li class="item-categoria drag-item" data-nome="${cat}" data-id="${idDoBanco}">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <i class="fa-solid fa-grip-lines drag-handle" title="Arraste para reordenar" style="cursor: grab; color: #dfe6e9; padding: 5px 10px; font-size: 16px;"></i>
                                ${htmlBolinhaColorida}
                                <span style="font-weight: 500; color: var(--texto);">${cat}</span>
                            </div>
                            <div style="display: flex; gap: 15px; align-items: center;">
                                <i class="fa-solid fa-pen" style="color: #0984e3; cursor: pointer; padding: 5px;" onclick="prepararEdicaoCategoria('${idDoBanco}', '${cat}', '${corDaCategoria}')" title="Editar"></i>
                                <button class="btn-del-cat" onclick="removerCategoria('${idDoBanco}', '${cat}')" title="Excluir" style="background: transparent; border: none; margin: 0; padding: 0;"><i class="fa-solid fa-trash" style="color: #ff7675; cursor: pointer; padding: 5px;"></i></button>
                            </div>
                        </li>
                    `;
                } else {
                    listaModal.innerHTML += `
                        <li class="item-categoria fixed-item" data-nome="${cat}">
                            <div style="display: flex; align-items: center; gap: 10px; padding-left: 26px;">
                                ${htmlBolinhaColorida}
                                <span style="font-weight: 500; color: var(--texto);">${cat}</span>
                            </div>
                            <span style="color: var(--texto-secundario); font-size: 12px; margin-right: 10px;">(Padrão Fixo)</span>
                        </li>
                    `;
                }
            }
        });

        // Devolve a seleção que o usuário estava usando
        if (selectForm && categorias.includes(categoriaSelecionadaAntes)) {
            selectForm.value = categoriaSelecionadaAntes;
        }
        
        if (typeof atualizarCorDaCaixaDeSelecao === 'function') atualizarCorDaCaixaDeSelecao(); 

        if (listaModal) {
            if (sortableInstance) sortableInstance.destroy(); 
            sortableInstance = new Sortable(listaModal, {
                animation: 150, handle: '.drag-handle', filter: '.fixed-item'
            });
        }
        
        atualizarTela();
    });
}

function abrirModal() { document.getElementById('modal-categorias').style.display = 'flex'; }
function fecharModal() { 
    document.getElementById('modal-categorias').style.display = 'none'; 
    categoriaEmEdicaoId = null;
    if(document.getElementById('nova-categoria')) document.getElementById('nova-categoria').value = '';
    if(document.getElementById('btn-salvar-categoria')) document.getElementById('btn-salvar-categoria').innerText = "Salvar";
}

// 2. Salvar ou Atualizar na Nuvem (Substitui a antiga adicionarCategoria)
window.salvarCategoria = async function() {
    const input = document.getElementById('nova-categoria');
    const inputCor = document.getElementById('cor-categoria');
    const btnSalvar = document.getElementById('btn-salvar-categoria');
    
    let nome = input.value.trim();
    let corEscolhida = inputCor.value; 

    if (nome) nome = nome.charAt(0).toUpperCase() + nome.slice(1); 

    if (nome !== '') {
        btnSalvar.innerText = "...";
        try {
            if (categoriaEmEdicaoId) {
                // MODO EDIÇÃO: Atualiza no Firebase
                await updateDoc(doc(db, nomeColecaoCategorias, categoriaEmEdicaoId), {
                    nome: nome,
                    cor: corEscolhida
                });
                categoriaEmEdicaoId = null;
            } else {
                // MODO NOVO: Cria no Firebase
                await addDoc(categoriasRef, {
                    nome: nome,
                    cor: corEscolhida,
                    criadoEm: Date.now(),
                    userId: auth.currentUser.uid 
                });
            }
            input.value = '';
            input.focus();
            btnSalvar.innerText = "Salvar";
        } catch (erro) {
            console.error("Erro ao salvar categoria:", erro);
            alert("Erro ao salvar na nuvem.");
            btnSalvar.innerText = categoriaEmEdicaoId ? "Atualizar" : "Salvar";
        }
    }
};

window.prepararEdicaoCategoria = function(docId, nomeAtual, corAtual) {
    if (nomeAtual === 'Geral') return; 
    document.getElementById('nova-categoria').value = nomeAtual;
    document.getElementById('cor-categoria').value = corAtual || '#0984e3';
    
    categoriaEmEdicaoId = docId; // Salva o ID do Firebase
    document.getElementById('btn-salvar-categoria').innerText = "Atualizar";
};

// 3. Remover da Nuvem
window.removerCategoria = async function(docId, nomeCategoria) {
    if (nomeCategoria === 'Geral') return; 
    if (confirm(`Tem certeza que deseja excluir a categoria "${nomeCategoria}"?`)) {
        try {
            await deleteDoc(doc(db, nomeColecaoCategorias, docId));
        } catch (erro) {
            alert("Erro ao excluir. Verifique sua conexão.");
        }
    }
};

// --- FUNÇÃO PRINCIPAL DE ATUALIZAÇÃO DA TABELA ---
function atualizarTela() {
    if (!corpoTabela) return;
    corpoTabela.innerHTML = '';
    
    let totalReceitas = 0; 
    let totalDespesas = 0;
    let transacoesFiltradas = [];

    // 1. CAPTURANDO TODOS OS VALORES DOS FILTROS
    const filtroTipo = document.getElementById('filtro-tipo') ? document.getElementById('filtro-tipo').value : 'todos';
    const filtroCategoria = document.getElementById('filtro-categoria') ? document.getElementById('filtro-categoria').value : 'todas';
    const filtroDataInicio = document.getElementById('filtro-data-inicio') ? document.getElementById('filtro-data-inicio').value : '';
    const filtroDataFim = document.getElementById('filtro-data-fim') ? document.getElementById('filtro-data-fim').value : '';
    const filtroStatus = document.getElementById('filtro-status') ? document.getElementById('filtro-status').value : 'todos';
    const filtroContaValor = document.getElementById('filtro-conta') ? document.getElementById('filtro-conta').value : 'todas';
    
    const buscaTexto = document.getElementById('filtro-busca') ? document.getElementById('filtro-busca').value.toLowerCase().trim() : '';
    const inputMin = document.getElementById('filtro-valor-min') ? document.getElementById('filtro-valor-min').value : '';
    const inputMax = document.getElementById('filtro-valor-max') ? document.getElementById('filtro-valor-max').value : '';
    const valorMin = inputMin !== "" ? parseFloat(inputMin) : 0;
    const valorMax = inputMax !== "" ? parseFloat(inputMax) : Infinity;
    const operadorSelecionado = document.getElementById('filtro-operador') ? document.getElementById('filtro-operador').value : 'todos';

    // 2. FILTRAGEM
    transacoes.forEach((transacao) => {
        const valorSeguro = parseFloat(transacao.valor) || 0;
        
        let passaTipo = (filtroTipo === 'todos' || transacao.tipo === filtroTipo);
        let passaCategoria = (filtroCategoria === 'todas' || transacao.categoria === filtroCategoria);
        let passaConta = (filtroContaValor === 'todas' || transacao.conta === filtroContaValor);
        
        let passaData = true;
        if (filtroDataInicio && transacao.data < filtroDataInicio) passaData = false;
        if (filtroDataFim && transacao.data > filtroDataFim) passaData = false;

        const descricaoNormalizada = (transacao.descricao || "").toLowerCase();
        const categoriaNormalizada = (transacao.categoria || "").toLowerCase();
        const passaBusca = descricaoNormalizada.includes(buscaTexto) || categoriaNormalizada.includes(buscaTexto);
        
        const passaValor = valorSeguro >= valorMin && valorSeguro <= valorMax;
        const passaOperador = (operadorSelecionado === 'todos' || transacao.nomeUsuario === operadorSelecionado);

        const statusDaTransacao = transacao.status || 'pago'; 
        const passaStatus = (filtroStatus === 'todos' || statusDaTransacao === filtroStatus);

        // ==================================================
        // NOVA REGRA: MÁQUINA DO TEMPO
        // ==================================================
        let passaNavegacao = false;
        
        if (transacao.data) {
            const partesData = transacao.data.split('-'); // Ex: '2026-05-22'
            const anoTransacao = parseInt(partesData[0], 10);
            const mesTransacao = parseInt(partesData[1], 10) - 1; // No JS, Janeiro é 0 e Dezembro é 11
            
            const usandoFiltroAvancado = (filtroDataInicio !== '' || filtroDataFim !== '');
            
            if (usandoFiltroAvancado) {
                // Se a pessoa preencheu a data no menu lateral, a máquina do tempo desliga temporariamente
                passaNavegacao = true; 
            } else {
                // Se não preencheu, obedece o mês que está na tela!
                passaNavegacao = (anoTransacao === dataAtualNavegacao.getFullYear() && mesTransacao === dataAtualNavegacao.getMonth());
            }
        }

        if (passaTipo && passaCategoria && passaConta && passaData && passaBusca && passaValor && passaOperador && passaStatus && passaNavegacao) {
            transacoesFiltradas.push(transacao);
        }
    });

    // =====================================================================
    // ⭐ ORDENAÇÃO AVANÇADA: Mais recentes no topo (Por Data e Hora Exata)
    // =====================================================================
    transacoesFiltradas.sort((a, b) => {
        // 1. Tenta ordenar pelo dia (Ex: 22/04 vs 20/04)
        if (b.data !== a.data) {
            return b.data > a.data ? 1 : -1;
        }
        
        // 2. Se for o mesmo dia, desempata pela hora exata (milissegundos)
        // Se for um lançamento antigo que não tem timestamp, ele assume 0
        const tempoA = a.timestamp || 0;
        const tempoB = b.timestamp || 0;
        
        return tempoB - tempoA; 
    });

    // ==========================================
    // 3. CÁLCULO DE TOTAIS E PAGINAÇÃO
    // ==========================================
    
    // A. Primeiro, calcula a matemática com TODO MUNDO (Mês inteiro)
    transacoesFiltradas.forEach((transacao) => {
        const valorSeguro = parseFloat(transacao.valor) || 0;
        const statusDaTransacao = transacao.status || 'pago';
        const valorParaCalculo = statusDaTransacao === 'cancelado' ? 0 : valorSeguro;

        if (transacao.tipo === 'receita') totalReceitas += valorParaCalculo;
        else totalDespesas += valorParaCalculo;
    });

    // B. Corta a fatia exata para a página atual
    let transacoesDaPagina = transacoesFiltradas;
    const totalItensFiltrados = transacoesFiltradas.length;

    if (itensPorPagina !== 'todos') {
        const limite = parseInt(itensPorPagina, 10);
        const totalPaginasPossiveis = Math.ceil(totalItensFiltrados / limite) || 1;
        
        // Segurança: se o cara estava na pág 5 e mudou de mês, o sistema puxa de volta pra pág 1
        if (paginaAtual > totalPaginasPossiveis) paginaAtual = 1; 

        const inicio = (paginaAtual - 1) * limite;
        const fim = inicio + limite;
        transacoesDaPagina = transacoesFiltradas.slice(inicio, fim);
    }

    // C. Desenha NA TELA apenas a fatia cortada
    transacoesDaPagina.forEach((transacao) => {
        const valorSeguro = parseFloat(transacao.valor) || 0;
        const statusDaTransacao = transacao.status || 'pago';
        
        let corStatusBg = '', corStatusTxt = '', textoStatus = '', iconeStatus = '', estiloLinha = '';
        if (statusDaTransacao === 'pendente') {
            corStatusBg = 'rgba(243, 156, 18, 0.15)'; corStatusTxt = '#d35400'; textoStatus = 'Pendente'; iconeStatus = '<i class="fa-solid fa-clock"></i>'; estiloLinha = 'opacity: 0.9;'; 
        } else if (statusDaTransacao === 'cancelado') {
            corStatusBg = 'rgba(200, 214, 229, 0.3)'; corStatusTxt = '#8395a7'; textoStatus = 'Cancelado'; iconeStatus = '<i class="fa-solid fa-ban"></i>'; estiloLinha = 'text-decoration: line-through; opacity: 0.6;'; 
        } else {
            corStatusBg = 'rgba(0, 184, 148, 0.15)'; corStatusTxt = '#00b894'; textoStatus = 'Pago'; iconeStatus = '<i class="fa-solid fa-check-circle"></i>';
        }

        let dataFormatada = transacao.data ? transacao.data.split('-').reverse().join('/') : 'Sem Data';
        let catVisual = transacao.categoria || 'Geral'; 
        let corDaTag = coresCategorias[catVisual] || '#b2bec3';
        let corDoTextoIdeal = getCorTextoIdeal(corDaTag);
        let contaVisual = transacao.conta || 'Sem Conta'; 
        let corDaConta = coresContas[contaVisual] || '#b2bec3';
        let corTextoConta = getCorTextoIdeal(corDaConta);

        let htmlAnexo = '';
        if (transacao.comprovante) {
            htmlAnexo = `
                <div style="margin-top: 8px;">
                    <a href="${transacao.comprovante}" target="_blank" style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #0984e3; background: rgba(9, 132, 227, 0.1); padding: 5px 10px; border-radius: 6px; text-decoration: none; font-weight: 700; border: 1px solid rgba(9, 132, 227, 0.2);">
                        <i class="fa-solid fa-paperclip"></i> Ver Comprovante
                    </a>
                </div>
            `;
        }

        const tr = document.createElement('tr');
        tr.id = `linha-${transacao.id}`; 
        tr.style = estiloLinha; 
        tr.innerHTML = `
            <td data-label="Data">${dataFormatada}</td>
            <td data-label="Descrição" style="font-weight: 500;">${transacao.descricao}${htmlAnexo}</td>
            <td data-label="Status">
                <span style="background: ${corStatusBg}; color: ${corStatusTxt}; padding: 5px 10px; border-radius: 8px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 5px;">
                    ${iconeStatus} ${textoStatus}
                </span>
            </td>
            <td data-label="Categoria">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="background: ${corDaTag}; padding: 6px 12px; border-radius: 12px; font-size: 11px; color: ${corDoTextoIdeal}; font-weight: 700;">${catVisual}</span>
                    <span style="background: var(--fundo); border: 1px solid #dfe6e9; padding: 4px 8px; border-radius: 6px; font-size: 10px; opacity: 0.85;">
                        <i class="fa-solid fa-user-pen" style="margin-right: 4px;"></i>${transacao.nomeUsuario || 'Operador'}
                    </span>
                </div>
            </td>
            <td data-label="Conta">
                 <span style="background: ${corDaConta}; padding: 6px 12px; border-radius: 12px; font-size: 11px; color: ${corTextoConta}; font-weight: 700;">${contaVisual}</span>
            </td>
            <td data-label="Tipo" style="color: ${transacao.tipo === 'receita' ? 'var(--cor-primaria)' : 'var(--cor-alerta)'}; font-weight: 600;">${transacao.tipo.toUpperCase()}</td>
            <td data-label="Valor" style="font-weight: 700;">${formatarMoedaBR(valorSeguro)}</td>
            <td data-label="Ações">
                <div style="display: flex; gap: 15px; justify-content: center;">
                    <button onclick="prepararEdicao('${transacao.id}')" style="background:none; border:none; color:#0984e3; cursor:pointer;"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="removerTransacao('${transacao.id}')" class="btn-excluir"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        `;
        corpoTabela.appendChild(tr);
    });

    // D. Cria os botões [1] [2] [3] no HTML baseando no total de itens filtrados
    renderizarPaginacao(totalItensFiltrados);

    if (displayReceita) displayReceita.innerText = formatarMoedaBR(totalReceitas);
    if (displayDespesa) displayDespesa.innerText = formatarMoedaBR(totalDespesas);
    if (displayLucro) {
        const lucro = totalReceitas - totalDespesas;
        displayLucro.innerText = formatarMoedaBR(lucro);
        displayLucro.style.color = lucro >= 0 ? 'var(--texto)' : 'var(--cor-alerta)';
    }
    if (typeof atualizarProgressoMeta === "function") atualizarProgressoMeta(totalReceitas);
    if (typeof atualizarGrafico === "function") atualizarGrafico(totalReceitas, totalDespesas);
    if (typeof atualizarGraficoBarras === "function") atualizarGraficoBarras(transacoesFiltradas);
    if (typeof atualizarWidgetDinamico === "function") atualizarWidgetDinamico(transacoesFiltradas);

    if (typeof atualizarProjecao === "function") atualizarProjecao();
    if (typeof renderizarListaProjetada === "function") renderizarListaProjetada();
    renderizarCartoesDeContas();
}

// COLE A FUNÇÃO NOVA LOGO ABAIXO:
function renderizarCartoesDeContas() {
    const carrossel = document.getElementById('carrossel-contas');
    if (!carrossel) return;
    
    carrossel.innerHTML = ''; 
    const nomesDasContas = Object.keys(coresContas); // Pega os bancos cadastrados

    if (nomesDasContas.length === 0) {
        carrossel.innerHTML = `<div style="color: var(--texto-secundario); font-size: 13px;">Nenhuma conta cadastrada ainda.</div>`;
        return;
    }

    nomesDasContas.forEach(nomeConta => {
        let saldoConta = 0;
        const corConta = coresContas[nomeConta] || '#b2bec3';

        // O Motor de Cálculo: Soma tudo dessa conta!
        transacoes.forEach(t => {
            // Ignora o que foi cancelado
            if (t.conta === nomeConta && t.status !== 'cancelado') {
                const valor = parseFloat(t.valor) || 0;
                if (t.tipo === 'receita') saldoConta += valor;
                if (t.tipo === 'despesa') saldoConta -= valor;
            }
        });

        // Aplica o "blur" se o olho estiver fechado
        const saldoFormatado = formatarMoedaBR(saldoConta);
        const classeOculto = saldosOcultos ? 'saldo-oculto' : '';
        const corSaldo = saldoConta < 0 ? 'var(--cor-alerta)' : 'var(--texto)'; // Fica vermelho se a conta ficar negativa

        // Injeta o cartão no HTML
        carrossel.innerHTML += `
            <div class="cartao-conta" style="border-left: 5px solid ${corConta};" onclick="filtrarPorContaCartao('${nomeConta}')">
                <div class="nome-banco">
                    <i class="fa-solid fa-wallet" style="color: ${corConta};"></i> ${nomeConta}
                </div>
                <div class="saldo-banco ${classeOculto}" style="color: ${corSaldo};">${saldoFormatado}</div>
            </div>
        `;
    });
}

// --- SISTEMA DE PRIVACIDADE DE SALDOS ---
let saldosOcultos = false;

window.toggleSaldos = function() {
    saldosOcultos = !saldosOcultos;
    const btnIcon = document.querySelector('#btn-ocultar-saldos i');
    
    if (saldosOcultos) {
        btnIcon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        btnIcon.classList.replace('fa-eye-slash', 'fa-eye');
    }
    
    atualizarTela(); // Recarrega os valores borrados
};

// ==========================================
// LÓGICA DE ARRASTAR O CARROSSEL COM O MOUSE
// ==========================================
let isDown = false;
let startX;
let scrollLeft;
let isDragging = false; // Memória para diferenciar "clique" de "arraste"

const carrosselContas = document.getElementById('carrossel-contas');

if (carrosselContas) {
    carrosselContas.addEventListener('mousedown', (e) => {
        isDown = true;
        isDragging = false; // Toda vez que clica, zera o arraste
        startX = e.pageX - carrosselContas.offsetLeft;
        scrollLeft = carrosselContas.scrollLeft;
    });

    carrosselContas.addEventListener('mouseleave', () => { isDown = false; });
    carrosselContas.addEventListener('mouseup', () => { isDown = false; });

    carrosselContas.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault(); // Impede o navegador de tentar arrastar a tela ou os ícones
        
        const x = e.pageX - carrosselContas.offsetLeft;
        const walk = (x - startX) * 1.5; // O 1.5 é a velocidade do arraste
        
        if (Math.abs(walk) > 5) isDragging = true; // Se o mouse moveu mais de 5 pixels, o sistema entende que é arraste
        
        carrosselContas.scrollLeft = scrollLeft - walk;
    });
}

// ==========================================
// Clicou no cartão do banco? Filtra a tabela e abre a sanfona!
// ==========================================
window.filtrarPorContaCartao = function(nomeConta) {
    if (isDragging) return; // A MÁGICA: Se estava arrastando, ignora o clique!
    
    const selectFiltroConta = document.getElementById('filtro-conta');
    
    if (selectFiltroConta) {
        // 1. Aplica o filtro e atualiza a tela
        selectFiltroConta.value = nomeConta;
        atualizarTela();
        
        // 2. Verifica se a sanfona está fechada. Se estiver, abre!
        const painel = document.getElementById('painel-filtros-avancados');
        const btn = document.getElementById('btn-toggle-filtros');
        
        if (!painel.classList.contains('aberto')) {
            painel.classList.add('aberto');
            btn.innerHTML = '<i class="fa-solid fa-chevron-up"></i> Esconder Filtros';
            btn.style.backgroundColor = 'var(--cor-primaria)';
            btn.style.color = '#ffffff';
        }
        
        // 3. Rola a tela suavemente para mostrar os filtros (em vez da tabela)
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // 4. MICROINTERAÇÃO: Dá um "brilho" verde no campo do banco para o cliente saber onde limpar
        setTimeout(() => {
            selectFiltroConta.style.transition = "box-shadow 0.4s, border 0.4s";
            selectFiltroConta.style.boxShadow = "0 0 15px var(--cor-primaria)";
            selectFiltroConta.style.borderColor = "var(--cor-primaria)";
            
            // Tira o brilho depois de 1.5 segundos
            setTimeout(() => {
                selectFiltroConta.style.boxShadow = "none";
                selectFiltroConta.style.borderColor = "rgba(255,255,255,0.1)";
            }, 1500);
        }, 400); // Espera a sanfona desenrolar um pouco antes de brilhar
    }
};

// --- 13. SISTEMA DE AUTENTICAÇÃO (LOGIN / LOGOUT) ---
const overlayLogin = document.getElementById('login-overlay');
const formLogin = document.getElementById('form-login');
const msgErro = document.getElementById('msg-erro-login');

// Fica vigiando 24h se o usuário está logado ou não
// --- SISTEMA DE HIERARQUIA E AUTENTICAÇÃO ---
// --- SISTEMA DE HIERARQUIA E AUTENTICAÇÃO ---
const ADMIN_UID = "RBEUXYma3kQXTDjK1kT4m1bCQyL2"; // EXATAMENTE igual ao painel do Firebase
let unsubscribeSnapshot = null; 

onAuthStateChanged(auth, async (user) => {
    if (user) {
        iniciarOuvinteContas();
        iniciarOuvinteCategorias();
        if (overlayLogin) overlayLogin.style.display = 'none';

        // 1. LÓGICA DO NOME (BEM-VINDO)
        let nomeDoUsuario = user.displayName;
        if (!nomeDoUsuario) {
            // Se for a primeira vez, pergunta o nome
            nomeDoUsuario = prompt("Bem-vindo! Qual é o seu nome ou apelido para o sistema?");
            if (!nomeDoUsuario) nomeDoUsuario = "Operador"; // Nome padrão se a pessoa não digitar nada
            
            // Salva o nome na conta do Google Firebase permanentemente
            await updateProfile(user, { displayName: nomeDoUsuario });
        }
        
        // Mostra o nome na tela COM O BOTÃO DE EDITAR
        const saudacao = document.getElementById('saudacao-usuario');
        if (saudacao) {
            saudacao.innerHTML = `
                <span style="font-weight: 400;">Olá,</span> 
                <strong style="color: var(--cor-primaria);">${nomeDoUsuario}</strong>
                <button onclick="mudarNome()" title="Editar Nome" style="background: transparent; border: none; color: var(--texto); cursor: pointer; opacity: 0.5; font-size: 12px; margin-left: 5px;">
                    <i class="fa-solid fa-pen"></i>
                </button>
            `;
        }

        // MOSTRA A ÁREA DE ADMIN APENAS PARA O MESTRE
        const areaAdmin = document.getElementById('area-admin');
        if (user.uid === ADMIN_UID) {
            areaAdmin.style.display = 'block';
        } else {
            areaAdmin.style.display = 'none';
        }

        if (user.uid === ADMIN_UID) {
            const containerOperador = document.getElementById('container-filtro-operador');
            if (containerOperador) containerOperador.style.display = 'block';
            
            // Opcional: Aqui você pode fazer um loop nas transações para preencher 
            // o select 'filtro-operador' com os nomes únicos que existem no banco.
        }

        // 2. LÓGICA DO BANCO (MESTRE VS OPERADOR)
        let consultaBanco;
        if (user.uid === ADMIN_UID) {
            consultaBanco = transacoesRef; // Você (Mestre) puxa tudo
        } else {
            consultaBanco = query(transacoesRef, where("userId", "==", user.uid)); // Eles puxam só o deles
        }

        if (unsubscribeSnapshot) unsubscribeSnapshot(); 
        
        unsubscribeSnapshot = onSnapshot(consultaBanco, (snapshot) => {
            transacoes = []; 
            const nomesUnicos = new Set(); // Cria uma lista sem repetições
            
            snapshot.forEach((documento) => {
                const dados = documento.data();
                transacoes.push({ id: documento.id, ...dados }); 
                
                // Salva o nome de quem lançou para o filtro
                if (dados.nomeUsuario) {
                    nomesUnicos.add(dados.nomeUsuario);
                }
            });
            
            // Lógica para popular o menu de operadores (Só para o Mestre)
            const containerOperador = document.getElementById('container-filtro-operador');
            const selectOperador = document.getElementById('filtro-operador');
            
            if (user.uid === ADMIN_UID) {
                if (containerOperador) containerOperador.style.display = 'block';
                
                if (selectOperador) {
                    const valorAntigo = selectOperador.value; // Guarda a seleção atual
                    selectOperador.innerHTML = '<option value="todos">Todos os Operadores</option>';
                    
                    nomesUnicos.forEach(nome => {
                        selectOperador.innerHTML += `<option value="${nome}">${nome}</option>`;
                    });
                    
                    selectOperador.value = valorAntigo || "todos"; // Devolve a seleção
                }
            } else {
                if (containerOperador) containerOperador.style.display = 'none';
            }

            atualizarTela(); 
        });

    } else {
        if (overlayLogin) overlayLogin.style.display = 'flex';
        if (unsubscribeSnapshot) unsubscribeSnapshot(); 
        transacoes = []; 
        atualizarTela();
    }

    
});

// --- FUNÇÃO PARA O MESTRE CADASTRAR NOVOS USUÁRIOS ---
const formAdmin = document.getElementById('form-cadastro-admin');
if (formAdmin) {
    formAdmin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('novo-email-admin').value;
        const senha = document.getElementById('nova-senha-admin').value;
        const msg = document.getElementById('msg-sucesso-admin');

        try {
            // Criamos uma instância secundária rápida só para o cadastro
            // Isso evita que o Firebase te deslogue ao criar a conta
            const appSecundario = initializeApp(firebaseConfig, "Secondary");
            const authSecundario = getAuth(appSecundario);
            
            await createUserWithEmailAndPassword(authSecundario, email, senha);
            
            // Limpa a instância secundária para não dar erro de duplicata
            await deleteApp(appSecundario);

            msg.style.display = 'block';
            formAdmin.reset();
            setTimeout(() => { msg.style.display = 'none'; }, 3000);
            
        } catch (error) {
            console.error("Erro ao cadastrar via Admin:", error);
            alert("Erro: " + error.message);
        }
    });
}

// Quando clicar em "Entrar no Sistema"
if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault(); // Impede a página de piscar/recarregar
        console.log("TENTATIVA: Enviando dados para a nuvem...");
        
        const email = document.getElementById('email-login').value;
        const senha = document.getElementById('senha-login').value;
        const btn = formLogin.querySelector('button');
        const textoOriginal = btn.innerText;
        
        try {
            msgErro.style.display = 'none'; 
            btn.innerText = "Autenticando..."; // Dá um feedback visual no botão
            
            await signInWithEmailAndPassword(auth, email, senha);
            
            // Se chegou aqui, a senha estava certa! O onAuthStateChanged vai esconder a tela.
            btn.innerText = textoOriginal; 
        } catch (error) {
            console.error("FALHA no login:", error.code);
            msgErro.style.display = 'block';
            msgErro.innerText = "Credenciais inválidas. Verifique o e-mail e a senha.";
            btn.innerText = textoOriginal;
        }
    });
}

// Função para deslogar
function fazerLogout() {
    signOut(auth).then(() => {
        // O onAuthStateChanged vai perceber e mostrar a tela de login novamente
        document.getElementById('email-login').value = '';
        document.getElementById('senha-login').value = '';
    }).catch((error) => {
        console.error("Erro ao sair:", error);
    });
}

// --- FUNÇÃO PARA ALTERAR O NOME DE USUÁRIO ---
async function mudarNome() {
    if (!auth.currentUser) return;
    
    const novoNome = prompt("Digite o seu nome correto:", auth.currentUser.displayName);
    
    if (novoNome && novoNome.trim() !== "") {
        try {
            await updateProfile(auth.currentUser, { displayName: novoNome.trim() });
            // Atualiza os lançamentos antigos que já estavam com o nome errado na tela (apenas visualmente até recarregar)
            location.reload(); 
        } catch (erro) {
            console.error("Erro ao atualizar o nome:", erro);
            alert("Não foi possível alterar o nome agora.");
        }
    }
}

// --- 7. GRÁFICOS ---
function atualizarGrafico(receitas, despesas) {
    const ctx = document.getElementById('graficoRosca').getContext('2d');
    if (graficoRosca) { graficoRosca.destroy(); }
    graficoRosca = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Receitas', 'Despesas'], datasets: [{ data: [receitas, despesas], backgroundColor: ['#00b894', '#ff7675'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'Proporção do Filtro Atual' } }, cutout: '70%' }
    });
}

// --- ATUALIZAÇÃO DO GRÁFICO DE BARRAS (CORES DINÂMICAS) ---
function atualizarGraficoBarras(listaFiltrada) {
    const ctx = document.getElementById('graficoBarras').getContext('2d');
    if (graficoRoscaBarras) { graficoRoscaBarras.destroy(); }

    const resumoCategorias = {};
    listaFiltrada.forEach(t => {
        const cat = t.categoria || 'Geral';
        if (!resumoCategorias[cat]) { resumoCategorias[cat] = { receita: 0, despesa: 0 }; }
        
        // Matemática: Se estiver CANCELADO, vira R$ 0,00 no gráfico também
        const statusDaTransacao = t.status || 'pago';
        const valorParaCalculo = statusDaTransacao === 'cancelado' ? 0 : (parseFloat(t.valor) || 0);

        if (t.tipo === 'receita') { resumoCategorias[cat].receita += valorParaCalculo; } 
        else { resumoCategorias[cat].despesa += valorParaCalculo; }
    });

    const labels = Object.keys(resumoCategorias);
    const dadosReceitas = labels.map(cat => resumoCategorias[cat].receita);
    const dadosDespesas = labels.map(cat => resumoCategorias[cat].despesa);
    
    // A MÁGICA: Puxa o dicionário de cores e cria uma lista na mesma ordem das barras
    const coresDasCategorias = labels.map(cat => coresCategorias[cat] || '#b2bec3');

    graficoRoscaBarras = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { 
                    label: 'Receitas', 
                    data: dadosReceitas, 
                    backgroundColor: '#00b894', // Verde fixo para Receitas
                    borderRadius: 6 
                },
                { 
                    label: 'Despesas', 
                    data: dadosDespesas, 
                    backgroundColor: coresDasCategorias, // Cores dinâmicas das categorias para Despesas!
                    borderRadius: 6 
                }
            ]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                title: { display: true, text: 'Desempenho por Categoria', color: 'var(--texto-secundario)' },
                legend: { labels: { color: 'var(--texto)' } }
            }, 
            scales: { 
                y: { 
                    beginAtZero: true, 
                    grid: { color: 'rgba(150, 150, 150, 0.1)' }, 
                    ticks: { color: 'var(--texto-secundario)' } 
                },
                x: { 
                    grid: { display: false }, 
                    ticks: { 
                        // A MÁGICA: Passamos a lista de cores no lugar de uma cor fixa
                        color: coresDasCategorias,
                        font: { weight: 'bold' } // Coloquei em negrito para a cor "acender" mais no fundo escuro
                    } 
                }
            } 
        }
    });
}

// --- 8. EXPORTAR PDF ---
// --- 8. EXPORTAR PDF (CORRIGIDO) ---
function gerarPDF() {
    const dataHoje = new Date();
    const dia = String(dataHoje.getDate()).padStart(2, '0');
    const mes = String(dataHoje.getMonth() + 1).padStart(2, '0');
    const ano = dataHoje.getFullYear();
    const nomePadrao = `Relatorio_Financeiro_${dia}-${mes}-${ano}`;

    let nomeArquivo = prompt("Escolha o nome do arquivo para salvar:", nomePadrao);
    if (nomeArquivo === null) return; 
    if (!nomeArquivo.endsWith('.pdf')) nomeArquivo += '.pdf';

    const elemento = document.querySelector(".tabela-container");
    
    // Captura a caixa com todos os botões novos
    const grupoBotoes = document.getElementById('grupo-botoes'); 
    const areaFiltros = document.querySelector('.filtro-area');
    const colunasAcoes = document.querySelectorAll('th:last-child, td:last-child');
    const tituloOriginal = document.getElementById('titulo-historico'); 

    const body = document.body;
    const estavaEscuro = body.classList.contains('dark-theme');
    if (estavaEscuro) { body.classList.remove('dark-theme'); }

    const dtInicioRaw = document.getElementById('filtro-data-inicio').value;
    const dtFimRaw = document.getElementById('filtro-data-fim').value;
    let textoPeriodo = (!dtInicioRaw && !dtFimRaw) ? "Todo o período" : `${dtInicioRaw ? dtInicioRaw.split('-').reverse().join('/') : '-'} até ${dtFimRaw ? dtFimRaw.split('-').reverse().join('/') : 'Hoje'}`;
    const selTipo = document.getElementById('filtro-tipo'); const selCat = document.getElementById('filtro-categoria');
    const txtTipo = selTipo.options[selTipo.selectedIndex].text; const txtCat = selCat.options[selCat.selectedIndex].text;

    // ESCONDE TUDO PARA A FOTO DO PDF
    if (grupoBotoes) grupoBotoes.style.display = 'none'; 
    if (areaFiltros) areaFiltros.style.display = 'none'; 
    if (tituloOriginal) tituloOriginal.style.display = 'none'; 
    colunasAcoes.forEach(celula => celula.style.display = 'none');
    
    window.scrollTo(0, 0); 
    elemento.style.overflow = 'visible'; 

    const infoPDF = document.createElement('div');
    infoPDF.id = 'info-impressao'; 
    const agora = new Date();
    
    infoPDF.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #dfe6e9; font-family: sans-serif; color: #2d3436;">
            <div>
                <h2 style="margin: 0 0 10px 0; color: #2d3436; font-size: 22px;">Relatório Financeiro</h2>
                <div style="color: #636e72; font-size: 14px;"><strong>Filtro:</strong> ${txtTipo} | ${txtCat}<br><strong>Período:</strong> ${textoPeriodo}</div>
            </div>
            <div style="text-align: right; color: #636e72; font-size: 13px;">
                <span style="display: block; margin-bottom: 4px;">Gerado em:</span>
                <strong style="color: #2d3436; font-size: 15px;">${agora.toLocaleDateString('pt-BR')}</strong><br>
                às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute:'2-digit' })}
            </div>
        </div>
    `;
    
    document.querySelector('table').insertAdjacentElement('beforebegin', infoPDF);

    html2pdf().set({
        margin: 10, filename: nomeArquivo, image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, scrollY: 0 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(elemento).save().then(() => {
        // MOSTRA OS BOTÕES DE VOLTA DEPOIS DA FOTO
        if (grupoBotoes) grupoBotoes.style.display = 'flex'; 
        if (areaFiltros) areaFiltros.style.display = 'flex'; 
        if (tituloOriginal) tituloOriginal.style.display = 'block'; 
        colunasAcoes.forEach(celula => celula.style.display = '');
        
        document.getElementById('info-impressao').remove(); 
        elemento.style.overflow = 'auto'; 
        if (estavaEscuro) { body.classList.add('dark-theme'); }
    });
}

// --- 10. REGISTRO DO APLICATIVO (PWA) ---
/*if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('App registrado com sucesso!'))
            .catch(err => console.log('Falha ao registrar o App:', err));
    });
}*/

// VARIÁVEL GLOBAL PARA CONTROLE DE EDIÇÃO
let idEdicao = null;

// --- 6.1 EXCLUSÃO COM CONFIRMAÇÃO ---
/*function removerTransacao(index) {
    if (confirm("Deseja realmente excluir este lançamento? Esta ação não pode ser desfeita.")) {
        transacoes.splice(index, 1);
        localStorage.setItem('bancoDashboard', JSON.stringify(transacoes));
        atualizarTela();
    }
}*/

// --- 6.1 EXCLUSÃO NA NUVEM ---
async function removerTransacao(id) {
    if (confirm("Deseja realmente excluir este lançamento? Esta ação não pode ser desfeita.")) {
        // Manda o Firebase apagar o documento com este ID
        await deleteDoc(doc(db, nomeDaColecao, id));
        // O onSnapshot deteta a exclusão e limpa a linha da tabela automaticamente!
    }
}

// --- 6.2 LÓGICA DE EDIÇÃO ---
function prepararEdicao(id) {
    // Procura na nossa lista local qual é o item que tem este ID
    const t = transacoes.find(item => item.id === id);
    if (!t) return;

    idEdicao = id;

    document.getElementById('descricao').value = t.descricao;
    document.getElementById('valor').value = formatarMoedaBR(t.valor);
    document.getElementById('data').value = t.data;
    // NOVO: Puxa a Conta para o modo de Edição e já pinta a borda!
    if (t.conta) {
        document.getElementById('conta').value = t.conta;
        atualizarCorDaConta(); 
    }

    document.getElementById('categoria').value = t.categoria;
    document.getElementById('tipo').value = t.tipo;

    atualizarCorDaCaixaDeSelecao();

    const btn = document.getElementById('btn-salvar-transacao');
    btn.innerText = "Salvar Alteração";
    btn.style.background = "linear-gradient(135deg, #f39c12, #e67e22)";
    document.querySelector('.form-container').classList.add('modo-edicao');
    
    document.querySelector('.form-container').scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (t.comprovante) {
        mostrarPreviewComprovante(t.comprovante);
    } else {
        removerAnexo();
    }
}

// Memória temporária para guardar a última categoria e data de inclusão
let ultimaCategoriaAdicionada = 'Geral';
let ultimaDataAdicionada = getDataHoje();
let ultimoTipoAdicionado = 'despesa'; 
let ultimoStatusAdicionado = 'pago';
let ultimaContaAdicionada = '';

// --- LÓGICA DE SALVAR / EDITAR NA NUVEM ---
form.addEventListener('submit', async function(evento) {
    evento.preventDefault(); 

const dados = {
        descricao: document.getElementById('descricao').value,
        valor: converterMoedaParaNumero(document.getElementById('valor').value),
        tipo: document.getElementById('tipo').value,
        data: document.getElementById('data').value || getDataHoje(),
        conta: document.getElementById('conta').value,
        categoria: document.getElementById('categoria').value,
        userId: auth.currentUser.uid, 
        nomeUsuario: auth.currentUser.displayName || "Operador",
        status: document.getElementById('status-lancamento').value,
        comprovante: document.getElementById('url-comprovante').value, // <-- NOVA LINHA (Grava o link da foto)
    };

    let indexParaRolar = null; 
    let foiEdicao = (idEdicao !== null); // NOVO: O código memoriza se era edição ANTES de limpar a variável

    try {
        if (idEdicao !== null) {
            // MODO EDIÇÃO: Atualiza o documento específico na nuvem
            const documentoRef = doc(db, nomeDaColecao, idEdicao);
            await updateDoc(documentoRef, dados);
            
            indexParaRolar = idEdicao; 
            idEdicao = null; 
            
            const btn = document.getElementById('btn-salvar-transacao');
            btn.innerText = "Adicionar";
            btn.style.background = "var(--gradiente-btn)";
            document.querySelector('.form-container').classList.remove('modo-edicao');
        } else {
            // MODO NOVO: Cria um documento novo na nuvem
            dados.timestamp = Date.now();
            const novoDoc = await addDoc(transacoesRef, dados);
            
            indexParaRolar = novoDoc.id; 
            ultimaCategoriaAdicionada = dados.categoria; 
            ultimaDataAdicionada = dados.data; 
            ultimoTipoAdicionado = dados.tipo;
            ultimoStatusAdicionado = dados.status;
            ultimaContaAdicionada = dados.conta; 
        }

        // ATENÇÃO: Repare que já não usamos localStorage aqui! 
        // O onSnapshot lá em cima vai perceber a mudança e atualizar a tela sozinho.

form.reset();
        removerAnexo();
        document.getElementById('data').value = ultimaDataAdicionada;
        document.getElementById('categoria').value = ultimaCategoriaAdicionada;
        
        // ADICIONE ESTA LINHA AQUI:
        if (ultimaContaAdicionada) document.getElementById('conta').value = ultimaContaAdicionada;

        if (typeof ultimoTipoAdicionado !== 'undefined') {
            document.getElementById('tipo').value = ultimoTipoAdicionado;
        }
        if (typeof ultimoStatusAdicionado !== 'undefined') {
            document.getElementById('status-lancamento').value = ultimoStatusAdicionado;
        }
        // ================================

        // A MÁGICA DA DIGITAÇÃO CONTÍNUA (Que fizemos antes)
        if (!foiEdicao) {
            document.getElementById('descricao').focus();
        }

        // Efeito de Rolagem e Destaque
        setTimeout(() => { 
            const linhaAtualizada = document.getElementById(`linha-${indexParaRolar}`);
            if (linhaAtualizada) {
                // NOVO: Só rola a tela para baixo se foi uma EDIÇÃO
                if (foiEdicao) {
                    linhaAtualizada.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                linhaAtualizada.style.transition = "background-color 0.8s";
                linhaAtualizada.style.backgroundColor = "rgba(9, 132, 227, 0.2)";
                setTimeout(() => { linhaAtualizada.style.backgroundColor = ""; }, 1000);
            }
        }, 500);

    } catch (erro) {
        console.error("Erro ao comunicar com o Firebase:", erro);
        alert("Ocorreu um erro ao guardar os dados na nuvem.");
    }
});

// --- 11. BACKUP E RESTAURAÇÃO ---
function exportarDados() {
    const dadosParaExportar = {
        transacoes: transacoes,
        categorias: categorias,
        cores: coresCategorias,
        meta: { nome: metaNome, valor: metaFinanceira }
    };

    const blob = new Blob([JSON.stringify(dadosParaExportar, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_financeiro_${getDataHoje()}.json`;
    a.click();
}

async function importarDados(event) {
    const arquivo = event.target.files[0];
    if (!arquivo) return;

    const leitor = new FileReader();
    leitor.onload = async function(e) {
        try {
            const dados = JSON.parse(e.target.result);
            
            if (confirm("Isso irá ADICIONAR os dados do arquivo ao seu banco de dados na nuvem. Deseja continuar?")) {
                const btnStatus = event.target.parentElement; // Para dar feedback visual
                const textoOriginal = btnStatus.innerHTML;
                btnStatus.innerText = "Importando para Nuvem...";

                // 1. IMPORTAR CATEGORIAS
                if (dados.categorias && Array.isArray(dados.categorias)) {
                    for (const catNome of dados.categorias) {
                        // Verifica se é uma categoria nova (não Geral)
                        if (catNome !== 'Geral') {
                            const cor = dados.cores ? dados.cores[catNome] : '#b2bec3';
                            await addDoc(categoriasRef, {
                                nome: catNome,
                                cor: cor,
                                criadoEm: Date.now(),
                                userId: auth.currentUser.uid
                            });
                        }
                    }
                }

                // 2. IMPORTAR TRANSAÇÕES
                if (dados.transacoes && Array.isArray(dados.transacoes)) {
                    for (const t of dados.transacoes) {
                        // Criamos um novo objeto limpando IDs antigos para não dar conflito
                        const novaTransacao = {
                            descricao: t.descricao,
                            valor: t.valor,
                            tipo: t.tipo,
                            data: t.data,
                            categoria: t.categoria,
                            conta: t.conta || "Sem Conta",
                            status: t.status || "pago",
                            nomeUsuario: t.nomeUsuario || auth.currentUser.displayName,
                            userId: auth.currentUser.uid,
                            timestamp: t.timestamp || Date.now()
                        };
                        await addDoc(transacoesRef, novaTransacao);
                    }
                }

                alert("Importação concluída com sucesso! Os dados agora estão na nuvem.");
                location.reload(); 
            }
        } catch (err) {
            console.error("Erro na importação:", err);
            alert("Erro ao ler o arquivo. Certifique-se de que é um JSON válido gerado pelo sistema.");
        }
    };
    leitor.readAsText(arquivo);
}

// --- 11.1 EXPORTAR PARA EXCEL (CSV) ---
function exportarExcel() {
    if (transacoes.length === 0) {
        alert("Não há dados para exportar.");
        return;
    }

    // 1. Criar o cabeçalho das colunas
    let csvContent = "Data;Descricao;Categoria;Tipo;Valor\n";

    // 2. Percorrer as transações e adicionar as linhas
    transacoes.forEach(t => {
        // Formata a data de AAAA-MM-DD para DD/MM/AAAA para o Excel brasileiro
        const dataFormatada = t.data.split('-').reverse().join('/');
        
        // Formata o valor trocando ponto por vírgula para o Excel entender como número
        const valorFormatado = t.valor.toFixed(2).replace('.', ',');

        // Monta a linha separada por ponto e vírgula (padrão brasileiro do Excel)
        const linha = `${dataFormatada};${t.descricao};${t.categoria};${t.tipo.toUpperCase()};${valorFormatado}\n`;
        csvContent += linha;
    });

    // 3. Criar o arquivo para download
    // O prefixo \uFEFF serve para o Excel entender que o arquivo tem acentos (UTF-8)
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    link.setAttribute("href", url);
    link.setAttribute("download", `Relatorio_Financeiro_${getDataHoje()}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- 14. SISTEMA DE ANEXOS E QR CODE HÍBRIDO ---
let ouvinteUpload = null;
let qrCodeApp = null;

function mostrarPreviewComprovante(url) {
    document.getElementById('url-comprovante').value = url;
    document.getElementById('img-preview').src = url;
    document.getElementById('preview-comprovante').style.display = 'block';
    document.getElementById('botoes-upload').style.display = 'none';
}

function removerAnexo() {
    document.getElementById('url-comprovante').value = '';
    document.getElementById('img-preview').src = '';
    document.getElementById('preview-comprovante').style.display = 'none';
    document.getElementById('botoes-upload').style.display = 'flex';
    document.getElementById('arquivo-upload').value = '';
}

// Upload Tradicional (Pelo Arquivo do PC)
async function uploadTradicional(event) {
    const arquivo = event.target.files[0];
    if (!arquivo) return;

    const status = document.getElementById('upload-status');
    status.style.display = 'block';
    status.innerText = 'Enviando imagem...';

    try {
        const nomeArquivo = `comprovantes/${Date.now()}_${arquivo.name}`;
        const referenciaStorage = ref(storage, nomeArquivo);
        await uploadBytesResumable(referenciaStorage, arquivo);
        const url = await getDownloadURL(referenciaStorage);
        
        mostrarPreviewComprovante(url);
        status.style.display = 'none';
    } catch (erro) {
        console.error("Erro no upload:", erro);
        status.innerText = 'Erro ao enviar.';
        status.style.color = 'red';
    }
}

// Upload Mágico (Pelo Celular via QR Code)
function abrirModalQR() {
    document.getElementById('modal-qrcode').style.display = 'flex';
    const container = document.getElementById('qrcode-container');
    container.innerHTML = ''; // Limpa QR antigo

    // 1. Cria um ID único para essa sessão
    const sessaoId = 'qr_' + Date.now();
    
// 2. Monta o link que o celular vai abrir (Apontando para o arquivo NOVO)
    let urlBase = window.location.href.split('index.html')[0];
    
    // Limpa qualquer sujeira que possa estar na URL
    urlBase = urlBase.split('?')[0]; 
    if (!urlBase.endsWith('/')) urlBase += '/';
    
    // O FURA-CACHE: Mudamos para camera.html e colocamos um número aleatório (?v=...)
    const linkCelular = `${urlBase}camera.html?v=${Date.now()}&id=${sessaoId}`;

    // 3. Desenha o QR Code na tela
    qrCodeApp = new QRCode(container, {
        text: linkCelular,
        width: 200, height: 200,
        colorDark : "#2d3436", colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });

    document.getElementById('status-qr').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Aguardando celular...';

    // 4. O Computador fica "escutando" a sala de espera no banco de dados
    const docRef = doc(db, "temp_uploads", sessaoId);
    if(ouvinteUpload) ouvinteUpload(); // Cancela o anterior se existir

    ouvinteUpload = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const dados = docSnap.data();
            if (dados.url) {
                // O CELULAR MANDOU A FOTO! 🎉
                fecharModalQR();
                mostrarPreviewComprovante(dados.url);
                deleteDoc(docRef); // Limpa o banco de dados
            }
        }
    });
}

function fecharModalQR() {
    document.getElementById('modal-qrcode').style.display = 'none';
    if(ouvinteUpload) {
        ouvinteUpload(); // O PC para de escutar se você fechar a janela
        ouvinteUpload = null;
    }
}

// Caso você tenha as funções de fechar e salvar a categoria direto no HTML, já garantimos elas aqui:
if (typeof fecharModal !== 'undefined') window.fecharModal = fecharModal;
if (typeof salvarCategoria !== 'undefined') window.salvarCategoria = salvarCategoria;

// ==========================================
// ATALHOS DE TECLADO (DIGITAÇÃO RÁPIDA)
// ==========================================

// 1. Ouve o "Enter" no Modal de Contas
const inputNomeConta = document.getElementById('nome-nova-conta');
if (inputNomeConta) {
    inputNomeConta.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault(); // Impede bugar a tela
            document.getElementById('btn-salvar-conta').click();
        }
    });
}

// 2. Ouve o "Enter" no Modal de Categorias
const inputNovaCategoria = document.getElementById('nova-categoria');
if (inputNovaCategoria) {
    inputNovaCategoria.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            salvarCategoria();
        }
    });
}

// ==========================================
// MÁSCARA DE MOEDA E LIMPEZA
// ==========================================
window.mascaraMoeda = function(input) {
    let valor = input.value.replace(/\D/g, '');
    if (valor === '') {
        input.value = '';
        return;
    }
    valor = (parseInt(valor, 10) / 100).toFixed(2) + '';
    valor = valor.replace('.', ',');
    valor = valor.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.');
    input.value = 'R$ ' + valor;
};

window.converterMoedaParaNumero = function(valorFormatado) {
    if (!valorFormatado) return 0;
    let numeroLimpo = valorFormatado.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    return parseFloat(numeroLimpo) || 0;
};

// ==========================================
// MÁQUINA DO TEMPO (NAVEGAÇÃO POR MESES)
// ==========================================
let dataAtualNavegacao = new Date(); // Começa no mês atual em que estamos

const nomesMeses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

window.atualizarDisplayMes = function() {
    const mes = nomesMeses[dataAtualNavegacao.getMonth()];
    const ano = dataAtualNavegacao.getFullYear();
    const display = document.getElementById('display-mes-atual');
    if (display) display.innerText = `${mes} ${ano}`;
};

window.mudarMes = function(direcao) {
    // direcao: -1 (volta um mês) ou 1 (avança um mês)
    dataAtualNavegacao.setMonth(dataAtualNavegacao.getMonth() + direcao);
    atualizarDisplayMes();
    
    // Zera os filtros avançados de data para não dar conflito
    const dataInicio = document.getElementById('filtro-data-inicio');
    const dataFim = document.getElementById('filtro-data-fim');
    if (dataInicio) dataInicio.value = '';
    if (dataFim) dataFim.value = '';

    atualizarTela(); // A Mágica: Manda o painel inteiro se redesenhar!
};

// ==========================================
// SISTEMA DE PAGINAÇÃO CLÁSSICA COM MEMÓRIA
// ==========================================
let paginaAtual = 1;
// Puxa a preferência do usuário ou define 15 como padrão
let itensPorPagina = localStorage.getItem('configItensPorPagina') || '15'; 

window.alterarItensPorPagina = function() {
    const select = document.getElementById('select-itens-pagina');
    itensPorPagina = select.value;
    localStorage.setItem('configItensPorPagina', itensPorPagina); // Salva na memória do navegador
    paginaAtual = 1; // Sempre que muda a quantidade, volta pra página 1
    atualizarTela();
};

window.mudarPagina = function(novaPagina) {
    paginaAtual = novaPagina;
    atualizarTela();
    // Dá uma leve rolada para cima na tabela para o usuário continuar lendo
    document.querySelector('.tabela-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.renderizarPaginacao = function(totalItens) {
    const container = document.getElementById('numeros-paginacao');
    if (!container) return;
    
    // Se escolheu "Todos" ou não tem itens, esconde os números
    if (itensPorPagina === 'todos' || totalItens === 0) {
        container.innerHTML = ''; 
        return;
    }

    const limite = parseInt(itensPorPagina, 10);
    const totalPaginas = Math.ceil(totalItens / limite);
    
    let html = '';
    
    // Botão Voltar (<)
    html += `<button onclick="mudarPagina(${paginaAtual - 1})" ${paginaAtual === 1 ? 'disabled' : ''} style="padding: 6px 12px; margin: 0 2px; border-radius: 6px; border: none; cursor: ${paginaAtual === 1 ? 'not-allowed' : 'pointer'}; opacity: ${paginaAtual === 1 ? '0.4' : '1'}; background: var(--fundo); color: var(--texto); transition: 0.2s;"><i class="fa-solid fa-chevron-left"></i></button>`;

    // Números Dinâmicos (1, 2, 3...)
    for (let i = 1; i <= totalPaginas; i++) {
        const isAtiva = (i === paginaAtual);
        const corFundo = isAtiva ? 'var(--cor-primaria)' : 'var(--fundo)';
        const corTexto = isAtiva ? '#fff' : 'var(--texto)';
        html += `<button onclick="mudarPagina(${i})" style="padding: 6px 12px; margin: 0 2px; border-radius: 6px; border: none; cursor: pointer; background: ${corFundo}; color: ${corTexto}; font-weight: ${isAtiva ? 'bold' : '500'}; transition: 0.2s;">${i}</button>`;
    }

    // Botão Avançar (>)
    html += `<button onclick="mudarPagina(${paginaAtual + 1})" ${paginaAtual === totalPaginas ? 'disabled' : ''} style="padding: 6px 12px; margin: 0 2px; border-radius: 6px; border: none; cursor: ${paginaAtual === totalPaginas ? 'not-allowed' : 'pointer'}; opacity: ${paginaAtual === totalPaginas ? '0.4' : '1'}; background: var(--fundo); color: var(--texto); transition: 0.2s;"><i class="fa-solid fa-chevron-right"></i></button>`;

    container.innerHTML = html;
};

// Faz a caixinha de seleção já nascer com a escolha salva do cliente
window.addEventListener('DOMContentLoaded', () => {
    const selectPaginacao = document.getElementById('select-itens-pagina');
    if (selectPaginacao) selectPaginacao.value = itensPorPagina;
});

// ==========================================
// CARROSSEL DE WIDGETS (LINHA & ALERTAS)
// ==========================================
let slideAtualWidget = 1;
let meuGraficoEvolucao = null;

// Função 1: Faz a Seta virar a página do Widget
window.alternarWidget = function(direcao) {
    slideAtualWidget += direcao;
    if (slideAtualWidget > 2) slideAtualWidget = 1; // Se passar do limite, volta pro 1
    if (slideAtualWidget < 1) slideAtualWidget = 2; // Se voltar antes do 1, vai pro 2

    const slideGrafico = document.getElementById('slide-grafico-linha');
    const slideAlertas = document.getElementById('slide-alertas');
    const titulo = document.getElementById('titulo-widget');
    const ponto1 = document.getElementById('ponto-widget-1');
    const ponto2 = document.getElementById('ponto-widget-2');

    if (slideAtualWidget === 1) {
        slideGrafico.style.display = 'block';
        slideAlertas.style.display = 'none';
        titulo.innerText = 'Evolução Diária';
        ponto1.style.background = 'var(--cor-primaria)'; ponto1.style.opacity = '1';
        ponto2.style.background = 'var(--texto-secundario)'; ponto2.style.opacity = '0.3';
    } else {
        slideGrafico.style.display = 'none';
        slideAlertas.style.display = 'block';
        titulo.innerText = 'Contas Pendentes';
        ponto1.style.background = 'var(--texto-secundario)'; ponto1.style.opacity = '0.3';
        ponto2.style.background = 'var(--cor-alerta)'; ponto2.style.opacity = '1';
    }
};

// Função 2: Calcula a matemática do Gráfico e da Lista
window.atualizarWidgetDinamico = function(listaFiltrada) {
    const ctx = document.getElementById('graficoEvolucao');
    const listaAlertasHTML = document.getElementById('lista-alertas-vencimento');
    if (!ctx || !listaAlertasHTML) return; 

    // --- PARTE A: MATEMÁTICA DO GRÁFICO DE LINHA ---
    const diasNoMes = new Date(dataAtualNavegacao.getFullYear(), dataAtualNavegacao.getMonth() + 1, 0).getDate();
    const labelsDias = Array.from({length: diasNoMes}, (_, i) => String(i + 1).padStart(2, '0'));
    
    let arrayReceitas = new Array(diasNoMes).fill(0);
    let arrayDespesas = new Array(diasNoMes).fill(0);
    let alertasPendentes = [];

    listaFiltrada.forEach(t => {
        const valor = parseFloat(t.valor) || 0;
        
        // 1. Organiza por dia para o gráfico
        if (t.data && t.status !== 'cancelado') {
            const diaTransacao = parseInt(t.data.split('-')[2], 10);
            if (t.tipo === 'receita') arrayReceitas[diaTransacao - 1] += valor;
            if (t.tipo === 'despesa') arrayDespesas[diaTransacao - 1] += valor;
        }

        // 2. Separa os Pendentes para a lista
        if (t.status === 'pendente') alertasPendentes.push(t);
    });

    // Desenha o Gráfico de Linha
    if (meuGraficoEvolucao) meuGraficoEvolucao.destroy();
    meuGraficoEvolucao = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: labelsDias,
            datasets: [
                { label: 'Receitas', data: arrayReceitas, borderColor: '#00b894', backgroundColor: 'rgba(0, 184, 148, 0.1)', borderWidth: 2, fill: true, tension: 0.4 },
                { label: 'Despesas', data: arrayDespesas, borderColor: '#ff7675', backgroundColor: 'rgba(255, 118, 117, 0.1)', borderWidth: 2, fill: true, tension: 0.4 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: {display: false} }, y: { border: {display: false} } } }
    });

    // --- PARTE B: DESENHA A LISTA DE ALERTAS ---
    listaAlertasHTML.innerHTML = '';
    alertasPendentes.sort((a, b) => (a.data > b.data ? 1 : -1)); // Ordena da data mais velha pra mais nova

    if (alertasPendentes.length === 0) {
        listaAlertasHTML.innerHTML = '<li style="text-align: center; color: var(--texto-secundario); margin-top: 50px;">Nenhum lançamento pendente neste mês! 🎉</li>';
    } else {
        const hoje = getDataHoje();
        alertasPendentes.forEach(t => {
            let corBorda = '#0984e3'; // Azul (No Prazo - Futuro)
            let textoTempo = 'No prazo';
            
            if (t.data < hoje) { corBorda = '#ff7675'; textoTempo = 'Atrasado'; } // Vermelho
            else if (t.data === hoje) { corBorda = '#f39c12'; textoTempo = 'Vence Hoje'; } // Laranja

            const dataBR = t.data.split('-').reverse().join('/');
            const corValor = t.tipo === 'receita' ? '#00b894' : '#ff7675';
            
            listaAlertasHTML.innerHTML += `
                <li style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 12px 15px; border-radius: 8px; border-left: 4px solid ${corBorda};">
                    <div>
                        <div style="color: var(--texto); font-weight: 600; font-size: 13px;">${t.descricao}</div>
                        <div style="color: var(--texto-secundario); font-size: 11px; margin-top: 3px;">
                            <i class="fa-regular fa-calendar"></i> ${dataBR} 
                            <span style="margin-left: 8px; color: ${corBorda}; font-weight: bold; background: ${corBorda}20; padding: 2px 6px; border-radius: 4px;">${textoTempo}</span>
                        </div>
                    </div>
                    <div style="font-weight: 700; color: ${corValor}; font-size: 14px;">${formatarMoedaBR(t.valor)}</div>
                </li>
            `;
        });
    }
};

window.toggleFiltrosAvancados = function() {
    const painel = document.getElementById('painel-filtros-avancados');
    const btn = document.getElementById('btn-toggle-filtros');
    
    // Tira ou coloca a classe 'aberto' - o CSS faz o resto da animação
    const estaAberto = painel.classList.toggle('aberto');
    
    if (estaAberto) {
        btn.innerHTML = '<i class="fa-solid fa-chevron-up"></i> Esconder Filtros';
        // Removemos a troca de background manual aqui para não bugar o hover do CSS
        btn.style.backgroundColor = 'var(--cor-primaria)';
        btn.style.color = '#ffffff';
    } else {
        btn.innerHTML = '<i class="fa-solid fa-sliders"></i> Filtros Avançados';
        btn.style.backgroundColor = 'transparent';
        btn.style.color = 'var(--cor-primaria)';
    }
};

// Dá a partida assim que a tela carrega
window.addEventListener('DOMContentLoaded', atualizarDisplayMes);

// ==========================================
// FUNÇÃO PARA LIMPAR TODOS OS FILTROS
// ==========================================
window.limparFiltros = function() {
    // 1. Esvazia a barra de pesquisa
    const inputBusca = document.getElementById('filtro-busca');
    if (inputBusca) inputBusca.value = '';

    // 2. Reseta os selects para o valor padrão
    const selects = [
        { id: 'filtro-tipo', padrao: 'todos' },
        { id: 'filtro-categoria', padrao: 'todas' },
        { id: 'filtro-conta', padrao: 'todas' },
        { id: 'filtro-status', padrao: 'todos' },
        { id: 'filtro-operador', padrao: 'todos' }
    ];

    selects.forEach(item => {
        const elemento = document.getElementById(item.id);
        if (elemento) elemento.value = item.padrao;
    });

    // 3. Esvazia as datas (o que reativa a Máquina do Tempo automaticamente!)
    const dataInicio = document.getElementById('filtro-data-inicio');
    const dataFim = document.getElementById('filtro-data-fim');
    if (dataInicio) dataInicio.value = '';
    if (dataFim) dataFim.value = '';

    // 4. Se a sanfona estiver aberta, a gente pode dar a opção de fechar ela (opcional, vou manter aberta para o cliente ver que limpou)
    // 5. Manda a tela calcular tudo de novo!
    atualizarTela();
    
    // (Opcional) Tira o brilho de qualquer campo que estava aceso
    const selectFiltroConta = document.getElementById('filtro-conta');
    if (selectFiltroConta) {
        selectFiltroConta.style.boxShadow = "none";
        selectFiltroConta.style.borderColor = "rgba(255,255,255,0.1)";
    }
};

window.abrirAba = function(idAbaDesejada, elementoBotao) {
    // 1. Esconde todas as abas
    const todasAbas = document.querySelectorAll('.conteudo-aba');
    todasAbas.forEach(aba => aba.classList.remove('ativa'));

    // 2. Tira a cor de 'ativo' de todos os botões
    const todosBotoes = document.querySelectorAll('.tab-btn');
    todosBotoes.forEach(btn => btn.classList.remove('ativo'));

    // 3. Mostra a aba clicada e pinta o botão correspondente
    document.getElementById(idAbaDesejada).classList.add('ativa');
    elementoBotao.classList.add('ativo');

    // MÁGICA: Se o usuário abrir a aba de Visão Geral, forçamos os gráficos a se redesenharem 
    // para evitar bugs de renderização do Chart.js quando o canvas fica oculto (display: none)
    if (idAbaDesejada === 'aba-visao-geral') {
        atualizarTela(); 
    }
}

// ==========================================
// MÓDULO 3: INTERFACE DE PROJEÇÕES
// ==========================================
window.toggleParcelas = function() {
    const tipo = document.getElementById('tipo-recorrencia').value;
    const inputQtd = document.getElementById('qtd-parcelas');
    
    if (tipo === 'parcelado') {
        inputQtd.style.display = 'block';
        inputQtd.setAttribute('required', 'true');
        // Dá um pequeno destaque visual para o usuário notar que o campo apareceu
        inputQtd.style.animation = 'fadeIn 0.3s ease-in-out';
    } else {
        inputQtd.style.display = 'none';
        inputQtd.removeAttribute('required');
        inputQtd.value = ''; // Limpa o valor se a pessoa desistir do parcelamento
    }
};

// ==========================================
// CAPTURA DO FORMULÁRIO DE PROJEÇÕES E MOTOR
// ==========================================
const formRecorrente = document.getElementById('form-recorrente');

if (formRecorrente) {
    formRecorrente.addEventListener('submit', async function(e) {
        e.preventDefault(); 

        const descricao = document.getElementById('desc-recorrente').value;
        const valor = converterMoedaParaNumero(document.getElementById('valor-recorrente').value);
        const tipoRecorrencia = document.getElementById('tipo-recorrencia').value;
        const qtdParcelas = parseInt(document.getElementById('qtd-parcelas').value) || 0;
        const tipoLancamento = document.getElementById('tipo-lanc-recorrente').value;
        const dataInicio = document.getElementById('data-inicio-recorrente').value;

        const btn = formRecorrente.querySelector('button');
        const textoOriginal = btn.innerText;
        btn.innerText = "Processando Lançamentos...";
        btn.style.background = "#f39c12";

        try {
            // Se for parcela, usa a quantidade informada. Se for conta fixa, projeta 12 meses pra frente.
            const repeticoes = tipoRecorrencia === 'parcelado' ? qtdParcelas : 12; 
            let promessasFirebase = [];

            // Adiciona o T12:00:00 para o fuso horário do Brasil não engolir 1 dia na hora de calcular
            const dataBase = new Date(dataInicio + 'T12:00:00');

            // O LOOP MÁGICO: Roda X vezes e joga a data um mês pra frente a cada volta
            for (let i = 0; i < repeticoes; i++) {
                
                let novaData = new Date(dataBase);
                novaData.setMonth(novaData.getMonth() + i);
                
                // Formata a data de volta pro formato do banco (YYYY-MM-DD)
                let ano = novaData.getFullYear();
                let mes = String(novaData.getMonth() + 1).padStart(2, '0');
                let dia = String(novaData.getDate()).padStart(2, '0');
                let dataFormatada = `${ano}-${mes}-${dia}`;
                
                // Se for parcelado, adiciona o número da parcela no nome (ex: iPhone 15 (1/10))
                let descFinal = tipoRecorrencia === 'parcelado' ? `${descricao} (${i + 1}/${qtdParcelas})` : descricao;
                
                let novaTransacao = {
                    descricao: descFinal,
                    valor: valor,
                    tipo: tipoLancamento,
                    data: dataFormatada,
                    conta: "", // Deixamos vazio para o usuário categorizar quando for pagar
                    categoria: "Geral", 
                    userId: auth.currentUser.uid, 
                    nomeUsuario: auth.currentUser.displayName || "Operador Simulador",
                    status: "pendente", // Projeções nascem pendentes por padrão
                    timestamp: Date.now() + i // O "+ i" evita que os arquivos tenham o mesmíssimo milissegundo
                };
                
                // Prepara a bomba: empilha todas as ordens de salvamento
                promessasFirebase.push(addDoc(transacoesRef, novaTransacao));
            }

            // Dispara todas as ordens para o banco de dados ao mesmo tempo!
            await Promise.all(promessasFirebase);

            formRecorrente.reset();
            document.getElementById('qtd-parcelas').style.display = 'none';

            btn.innerText = "Sucesso!";
            btn.style.background = "#00b894";

            setTimeout(() => {
                btn.innerText = textoOriginal;
                btn.style.background = "var(--gradiente-btn)";
            }, 2000);

        } catch (erro) {
            console.error("Erro ao gerar parcelas:", erro);
            alert("Ocorreu um erro ao gerar a projeção no banco de dados.");
            btn.innerText = textoOriginal;
            btn.style.background = "var(--gradiente-btn)";
        }
    });
}

// ==========================================
// MÓDULO 3: MOTOR DO GRÁFICO DE PROJEÇÕES E RESUMO
// ==========================================
let graficoProjecaoCaixa = null;

window.atualizarProjecao = function() {
    const ctx = document.getElementById('graficoProjecao');
    if (!ctx) return; // Se a aba não estiver carregada direito, ignora

    // Quantos meses para frente vamos olhar? (Vem do menu dropdown)
    const mesesParaProjetar = parseInt(document.getElementById('filtro-meses-projecao').value) || 3;
    
    // 1. Descobrir o Saldo Atual (Tudo que já foi pago ou que a data é anterior a hoje)
    let saldoAtual = 0;
    const dataHoje = new Date(); 
    const stringHoje = getDataHoje(); // Sua função que já pega a data atual YYYY-MM-DD

    // 2. Variáveis para os cartões de resumo (Futuro)
    let somaDespesasFixas = 0;
    let somaReceitasFixas = 0;

    // 3. Estruturas para o gráfico
    let labelsMeses = [];
    let dadosSaldo = []; 
    let fluxoMensal = new Array(mesesParaProjetar).fill().map(() => ({ receita: 0, despesa: 0 }));

    // O "Pente Fino": Varre todas as transações que o Firebase mandou
    transacoes.forEach(t => {
        if (t.status === 'cancelado') return; // Ignora o lixo
        
        const valor = parseFloat(t.valor) || 0;

        // Se já passou ou tá pago, forma o nosso saldo de partida hoje
        if (t.data <= stringHoje || t.status === 'pago') {
            if (t.tipo === 'receita') saldoAtual += valor;
            else saldoAtual -= valor;
        } 
        else {
            // É FUTURO! Vamos calcular em qual mês cai
            const dataT = new Date(t.data + 'T12:00:00'); // T12:00:00 evita bugs de fuso horário
            
            const diffAnos = dataT.getFullYear() - dataHoje.getFullYear();
            const diffMeses = (diffAnos * 12) + (dataT.getMonth() - dataHoje.getMonth());

            // Se cair dentro da nossa janela de projeção (3, 6 ou 12 meses)
            if (diffMeses >= 0 && diffMeses < mesesParaProjetar) {
                if (t.tipo === 'receita') {
                    fluxoMensal[diffMeses].receita += valor;
                    somaReceitasFixas += valor;
                } else {
                    fluxoMensal[diffMeses].despesa += valor;
                    somaDespesasFixas += valor;
                }
            }
        }
    });

    // 4. Montar a progressão mês a mês para desenhar a linha
    let saldoAcumulado = saldoAtual;
    const nomesMesesCurto = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    for (let i = 0; i < mesesParaProjetar; i++) {
        let mesAlvo = new Date(dataHoje.getFullYear(), dataHoje.getMonth() + i, 1);
        labelsMeses.push(`${nomesMesesCurto[mesAlvo.getMonth()]}/${mesAlvo.getFullYear().toString().slice(-2)}`);
        
        // A matemática do mês: Saldo que tinha + Receitas do Mês - Despesas do Mês
        saldoAcumulado += fluxoMensal[i].receita - fluxoMensal[i].despesa;
        dadosSaldo.push(saldoAcumulado);
    }

    // 5. Escrever nos painéis HTML
    document.getElementById('display-saldo-previsto').innerText = formatarMoedaBR(saldoAcumulado);
    document.getElementById('display-despesas-fixas').innerText = formatarMoedaBR(somaDespesasFixas);
    document.getElementById('display-receitas-fixas').innerText = formatarMoedaBR(somaReceitasFixas);

    // Se o saldo final der negativo, o texto fica em vermelho de alerta!
    document.getElementById('display-saldo-previsto').style.color = saldoAcumulado < 0 ? 'var(--cor-alerta)' : 'var(--cor-primaria)';

    // 6. Desenhar o Gráfico (Chart.js)
    if (graficoProjecaoCaixa) graficoProjecaoCaixa.destroy(); // Limpa o antigo
    
    // A cor da linha acompanha o status da conta
    const corLinha = saldoAcumulado < 0 ? '#ff7675' : '#0984e3';
    const corFundo = saldoAcumulado < 0 ? 'rgba(255, 118, 117, 0.1)' : 'rgba(9, 132, 227, 0.1)';

    graficoProjecaoCaixa = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: labelsMeses,
            datasets: [{
                label: 'Caixa Estimado',
                data: dadosSaldo,
                borderColor: corLinha,
                backgroundColor: corFundo,
                borderWidth: 3,
                fill: true,
                tension: 0.4, // Deixa a linha suave e curva
                pointBackgroundColor: corLinha,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { ticks: { color: 'var(--texto-secundario)' }, grid: { color: 'rgba(150, 150, 150, 0.1)' } },
                x: { ticks: { color: 'var(--texto-secundario)', font: {weight: 'bold'} }, grid: { display: false } }
            }
        }
    });
};

// ==========================================
// MÓDULO 3: LISTA DE LANÇAMENTOS FUTUROS (AGRUPADA EM SANFONA)
// ==========================================
window.renderizarListaProjetada = function() {
    const listaHTML = document.getElementById('lista-recorrentes');
    if (!listaHTML) return;
    
    listaHTML.innerHTML = '';
    const hoje = getDataHoje();
    
    // 1. O Detetive: Objeto para agrupar as contas pelo "Nome Base"
    let grupos = {};

    transacoes.forEach(t => {
        let isParcelado = false;
        let nomeBase = t.descricao;

        // MÁGICA DO REGEX: Procura o padrão "(1/10)" no nome da conta
        const regex = /(.+?)\s*\((\d+)\/(\d+)\)/;
        const match = t.descricao.match(regex);

        if (match) {
            isParcelado = true;
            nomeBase = match[1].trim(); // Extrai só o "iphone 17 esposa"
        }

        // Regra de Ouro: Puxa todas as parcelas (mesmo as pagas) OU fixas que estão no futuro
        if (isParcelado || (t.status === 'pendente' && t.data >= hoje)) {
            
            // Se o grupo ainda não existe, cria a "pasta" dele
            if (!grupos[nomeBase]) {
                grupos[nomeBase] = {
                    nome: nomeBase,
                    tipo: t.tipo,
                    isParcelado: isParcelado,
                    totalParcelas: isParcelado ? parseInt(match[3], 10) : null,
                    valorParcela: parseFloat(t.valor) || 0,
                    itens: []
                };
            }
            
            // Joga a transação dentro da pasta do grupo
            grupos[nomeBase].itens.push(t);
        }
    });

    // 2. Filtra e Ordena os Grupos
    let gruposAtivos = [];

    for (const key in grupos) {
        let grupo = grupos[key];
        
        // Coloca os itens do grupo em ordem de data (da mais antiga pra mais nova)
        grupo.itens.sort((a, b) => a.data > b.data ? 1 : -1);

        // Verifica se o grupo ainda tem alguma conta pendente. Se estiver tudo pago, some da tela!
        const temPendente = grupo.itens.some(item => item.status === 'pendente');
        if (temPendente) {
            gruposAtivos.push(grupo);
        }
    }

    if (gruposAtivos.length === 0) {
        listaHTML.innerHTML = '<li style="text-align: center; color: var(--texto-secundario); padding: 20px;">Nenhuma automação ativa no momento.</li>';
        return;
    }

    // 3. Desenha o HTML Dinâmico (A Sanfona)
    gruposAtivos.forEach((grupo, index) => {
        const idSanfona = `sanfona-grupo-${index}`;

        // Descobre qual é a PRÓXIMA conta que o usuário tem que pagar
        const proximaParcela = grupo.itens.find(item => item.status === 'pendente');
        const dataBrProxima = proximaParcela ? proximaParcela.data.split('-').reverse().join('/') : 'Concluído';

        const corBorda = grupo.tipo === 'receita' ? '#00b894' : '#ff7675';
        const sinal = grupo.tipo === 'receita' ? '+' : '-';

        // Lógica visual: Ícones e Textos diferentes para Fixo x Parcelado
        let textoTotal = '';
        let iconeTipo = '';

        if (grupo.isParcelado) {
            const valorTotal = grupo.valorParcela * grupo.totalParcelas;
            textoTotal = `<div style="font-size: 11px; color: var(--texto-secundario);">Total: ${formatarMoedaBR(valorTotal)}</div>`;
            iconeTipo = '<i class="fa-solid fa-credit-card"></i>';
        } else {
            textoTotal = `<div style="font-size: 11px; color: var(--texto-secundario);">Mensal Fixo</div>`;
            iconeTipo = '<i class="fa-solid fa-repeat"></i>';
        }

        // Monta as "linhas de dentro" (Os itens da sanfona)
        let htmlItensInternos = '';
        grupo.itens.forEach(item => {
            const isPago = item.status === 'pago';
            const estiloRiscado = isPago ? 'text-decoration: line-through; opacity: 0.4;' : '';
            const iconeStatus = isPago ? '<i class="fa-solid fa-check-circle" style="color: #00b894;"></i>' : '<i class="fa-regular fa-circle" style="color: var(--texto-secundario);"></i>';
            const dataBrItem = item.data.split('-').reverse().join('/');

            htmlItensInternos += `
                <li style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px 10px 45px; border-top: 1px solid rgba(150,150,150,0.1); ${estiloRiscado}">
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button onclick="removerTransacao('${item.id}')" title="Excluir Parcela" style="background: none; border: none; color: var(--texto-secundario); cursor: pointer; transition: 0.3s; padding: 0;" onmouseover="this.style.color='var(--cor-alerta)'" onmouseout="this.style.color='var(--texto-secundario)'">
                            <i class="fa-solid fa-trash" style="font-size: 11px;"></i>
                        </button>
                        <div style="font-size: 12px; color: var(--texto); font-weight: 500;">${iconeStatus} ${item.descricao}</div>
                    </div>
                    <div style="font-size: 11px; color: var(--texto-secundario); font-weight: 600;">${dataBrItem}</div>
                </li>
            `;
        });

        // Monta o Cartão Principal (O Header da Sanfona)
        listaHTML.innerHTML += `
            <li style="background: var(--fundo); border-radius: 10px; border-left: 4px solid ${corBorda}; border-bottom: 1px solid rgba(150,150,150,0.1); overflow: hidden; margin-bottom: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
                
                <div onclick="toggleSanfona('${idSanfona}')" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.backgroundColor='rgba(150,150,150,0.05)'" onmouseout="this.style.backgroundColor='transparent'">
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <div style="background: rgba(150,150,150,0.1); width: 38px; height: 38px; border-radius: 8px; display: flex; justify-content: center; align-items: center; color: ${corBorda}; font-size: 16px;">
                            ${iconeTipo}
                        </div>
                        <div>
                            <div style="color: var(--texto); font-weight: 700; font-size: 14px; text-transform: uppercase;">${grupo.nome}</div>
                            <div style="color: var(--texto-secundario); font-size: 11px; margin-top: 3px; font-weight: 500;">
                                Próxima: <span style="color: var(--texto);">${dataBrProxima}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div style="text-align: right; display: flex; align-items: center; gap: 15px;">
                        <div>
                            <div style="font-weight: 700; color: ${corBorda}; font-size: 15px;">${sinal} ${formatarMoedaBR(grupo.valorParcela)}</div>
                            ${textoTotal}
                        </div>
                        <div style="background: rgba(150,150,150,0.1); padding: 5px; border-radius: 5px;">
                            <i id="icone-${idSanfona}" class="fa-solid fa-chevron-down" style="color: var(--texto-secundario); transition: transform 0.3s; font-size: 12px;"></i>
                        </div>
                    </div>
                </div>

                <ul id="${idSanfona}" style="list-style: none; padding: 0; margin: 0; display: none; background: rgba(150,150,150,0.03);">
                    ${htmlItensInternos}
                </ul>
            </li>
        `;
    });
};

// FUNÇÃO PARA ABRIR/FECHAR A SANFONA
window.toggleSanfona = function(id) {
    const gaveta = document.getElementById(id);
    const icone = document.getElementById('icone-' + id);
    
    if (gaveta.style.display === 'none' || gaveta.style.display === '') {
        gaveta.style.display = 'block';
        icone.style.transform = 'rotate(180deg)';
        gaveta.style.animation = 'fadeIn 0.3s ease';
    } else {
        gaveta.style.display = 'none';
        icone.style.transform = 'rotate(0deg)';
    }
};

// Faz o menu de "X meses" disparar o recálculo imediatamente quando você muda a opção
document.getElementById('filtro-meses-projecao').addEventListener('change', atualizarProjecao);

// --- 12. A CHAVE MESTRA: EXPORTANDO FUNÇÕES PARA O HTML ---
window.toggleTheme = toggleTheme;
window.definirMeta = definirMeta;
window.abrirModal = abrirModal;
window.fecharModal = fecharModal;
window.salvarCategoria = salvarCategoria; // MUDOU AQUI
window.prepararEdicaoCategoria = prepararEdicaoCategoria; // MUDOU AQUI
window.removerCategoria = removerCategoria;
window.prepararEdicao = prepararEdicao;
window.removerTransacao = removerTransacao;
window.exportarExcel = exportarExcel;
window.exportarDados = exportarDados;
window.importarDados = importarDados;
window.gerarPDF = gerarPDF;
window.fazerLogout = fazerLogout;
window.mudarNome = mudarNome;
window.atualizarTela = atualizarTela;
window.abrirModalQR = abrirModalQR;
window.fecharModalQR = fecharModalQR;
window.uploadTradicional = uploadTradicional;
window.removerAnexo = removerAnexo;
window.mascaraMoeda = mascaraMoeda;
window.atualizarCorDaConta = atualizarCorDaConta;
window.atualizarCorDaCaixaDeSelecao = atualizarCorDaCaixaDeSelecao;
window.mudarMes = mudarMes;
window.alterarItensPorPagina = alterarItensPorPagina;
window.mudarPagina = mudarPagina;
window.alternarWidget = alternarWidget;
window.toggleFiltrosAvancados = toggleFiltrosAvancados;
window.limparFiltros = limparFiltros;
window.abrirAba = abrirAba;


// --- 9. INICIA O SISTEMA ---
atualizarTela();