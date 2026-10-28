// frontend/js/dashboard.js

// Funções para Design Responsivo (Mobile-First)
window.toggleFilter = function(idFiltro) {
    const el = document.getElementById(idFiltro);
    const header = el.previousElementSibling;
    if(el.classList.contains('aberto')) {
        el.classList.remove('aberto');
        header.classList.remove('aberto');
    } else {
        el.classList.add('aberto');
        header.classList.add('aberto');
    }
};

window.mudarAbaResponsiva = function(idConteudo, elementoNav, idAbaDesktop) {
    // 1. Simula o clique na aba do desktop para reaproveitar a lógica original de exibição e bloqueios
    const abaDesktop = document.getElementById(idAbaDesktop);
    if(abaDesktop) abaDesktop.click();
    
    // 2. Atualiza o estado visual da Bottom Nav Bar
    document.querySelectorAll('.bottom-nav .nav-item').forEach(el => el.classList.remove('ativo'));
    elementoNav.classList.add('ativo');
};

// Menu lateral em gaveta no celular (abaixo de 768px)
window.abrirMenuMobile = function() {
    document.getElementById('menu-lateral')?.classList.add('aberta');
    document.getElementById('sidebar-overlay')?.classList.add('visivel');
    document.getElementById('btn-menu-mobile')?.setAttribute('aria-expanded', 'true');
};
window.fecharMenuMobile = function() {
    document.getElementById('menu-lateral')?.classList.remove('aberta');
    document.getElementById('sidebar-overlay')?.classList.remove('visivel');
    document.getElementById('btn-menu-mobile')?.setAttribute('aria-expanded', 'false');
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.fecharMenuMobile(); });

// Copia o endereço da plataforma para colar no WhatsApp/e-mail
window.compartilharLink = async function(btn) {
    const rotulo = btn.querySelector('.rotulo');
    const textoOriginal = rotulo ? rotulo.textContent : '';
    try {
        await navigator.clipboard.writeText(window.location.origin);
        btn.dataset.copiado = '1';
        if (rotulo) rotulo.textContent = 'Link copiado';
    } catch (e) {
        window.prompt('Copie o link da plataforma:', window.location.origin);
        return;
    }
    setTimeout(() => { btn.dataset.copiado = ''; if (rotulo) rotulo.textContent = textoOriginal; }, 2000);
};

// Indicadores em carregamento mostram esqueleto; em falha mostram "—" em vez de um zero enganoso
function marcarIndicadores(ids, estado) {
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('esqueleto', estado === 'carregando');
        if (el.tagName === 'DIV') el.classList.toggle('esqueleto-bloco', estado === 'carregando');
        if (estado === 'erro') el.innerText = '—';
    });
}

document.addEventListener("DOMContentLoaded", function() {

    // Padrões visuais de todos os gráficos: fonte da plataforma, dica na cor da marca e animação curta
    if (window.Chart) {
        Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
        Chart.defaults.color = '#64748b';
        Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.18)';
        Chart.defaults.animation.duration = 550;
        Chart.defaults.animation.easing = 'easeOutQuart';
        Object.assign(Chart.defaults.plugins.tooltip, {
            backgroundColor: 'rgba(20, 26, 77, 0.94)',
            titleColor: '#fde68a',
            bodyColor: '#f8fafc',
            padding: 10,
            cornerRadius: 10,
            boxPadding: 4,
            titleFont: { weight: '600' },
            displayColors: true
        });
    }

    // Configurações Globais Responsivas do Chart.js
    if (window.innerWidth <= 768) {
        Chart.defaults.plugins.legend.display = false;
        Chart.defaults.font.size = 10;
        Chart.defaults.maintainAspectRatio = false; // permite CSS controlar a altura
    }

    let logisticaAutenticada = true;
    let diretoriaAutenticada = true;
    let comercialAutenticado = true;
    let telemetriaAutenticada = true;
    window.logisticaAutenticada = true;
    window.diretoriaAutenticada = true;
    window.comercialAutenticado = true;
    window.telemetriaAutenticada = true;

    const hoje = new Date();
    
    
    const sessentaDiasAtras = new Date(); sessentaDiasAtras.setDate(hoje.getDate() - 90);
    const trintaDiasAtras = new Date(); trintaDiasAtras.setDate(hoje.getDate() - 30);

    const dsCortes = hoje.toISOString().split('T')[0];
    const diCortes = sessentaDiasAtras.toISOString().split('T')[0];
    const diComercial = trintaDiasAtras.toISOString().split('T')[0];

    if(document.getElementById('data-inicio')) document.getElementById('data-inicio').value = diCortes;
    if(document.getElementById('data-fim')) document.getElementById('data-fim').value = dsCortes;
    if(document.getElementById('data-inicio-comercial')) document.getElementById('data-inicio-comercial').value = diComercial;
    if(document.getElementById('data-fim-comercial')) document.getElementById('data-fim-comercial').value = dsCortes;
    if(document.getElementById('data-inicio-telemetria')) document.getElementById('data-inicio-telemetria').value = diComercial;
    if(document.getElementById('data-fim-telemetria')) document.getElementById('data-fim-telemetria').value = dsCortes;

    carregarSupervisores();
    carregarFiltroMotoristas();

    function lerFiltrosCortes() {
        return {
            i: document.getElementById('data-inicio') ? document.getElementById('data-inicio').value : '',
            f: document.getElementById('data-fim') ? document.getElementById('data-fim').value : '',
            a: document.getElementById('filtro-area-cortes') ? document.getElementById('filtro-area-cortes').value : 'LOGISTICA'
        };
    }
    
    
    

    document.getElementById('btn-filtrar-cortes')?.addEventListener('click', function() {
        if(!logisticaAutenticada) return;
        const f = lerFiltrosCortes(); carregarDadosCortes(f.i, f.f, f.a); carregarTabelaTop100(f.i, f.f, f.a);
    });
    document.getElementById('btn-filtrar-excesso')?.addEventListener('click', carregarDadosExcesso);
    document.getElementById('btn-filtrar-comercial')?.addEventListener('click', carregarDadosComercial);

    document.getElementById('btn-exportar-cortes')?.addEventListener('click', function() {
        if(!logisticaAutenticada) return;
        const f = lerFiltrosCortes(); window.location.href = `/api/exportar-cortes?data_inicio=${f.i}&data_fim=${f.f}&area=${f.a}`;
    });
    document.getElementById('btn-exportar-excesso')?.addEventListener('click', function() {
        window.location.href = `/api/exportar-excesso?comprador=${document.getElementById('filtro-comprador').value}`;
    });
    document.getElementById('btn-exportar-isv')?.addEventListener('click', function() {
        window.location.href = `/api/exportar-isv?comprador=${document.getElementById('filtro-comprador').value}`;
    });
    document.getElementById('btn-exportar-ruptura')?.addEventListener('click', function() {
        window.location.href = `/api/exportar-ruptura?comprador=${document.getElementById('filtro-comprador').value}`;
    });
    document.getElementById('btn-exportar-comercial')?.addEventListener('click', function() {
        const i = document.getElementById('data-inicio-comercial').value;
        const f = document.getElementById('data-fim-comercial').value;
        const c = document.getElementById('filtro-comprador-comercial').value;
        const s = document.getElementById('filtro-supervisor-comercial').value;
        window.location.href = `/api/exportar-comercial?data_inicio=${i}&data_fim=${f}&comprador=${c}&supervisor=${s}`;
    });

    const abas = document.querySelectorAll('.aba');
    abas.forEach(aba => {
        aba.addEventListener('click', function() {
            const titulo = document.getElementById('titulo-pagina');

            if (this.id === 'aba-dashboard') {
                mudarAba(this, 'conteudo-dashboard');
                if(titulo) titulo.innerText = 'Dashboard · Visão Geral';
                if (typeof carregarDashboardVisaoGeral === 'function') carregarDashboardVisaoGeral();
            }
            else if (this.id === 'aba-cortes') { 
                mudarAba(this, 'conteudo-cortes'); 
                if(titulo) titulo.innerText = 'Cortes & Rupturas';
                const f = lerFiltrosCortes();
                carregarDadosCortes(f.i, f.f, f.a);
                carregarTabelaTop100(f.i, f.f, f.a);
            }
            else if (this.id === 'aba-excesso') { 
                mudarAba(this, 'conteudo-excesso'); 
                if(titulo) titulo.innerText = 'Excesso de Estoque';
                carregarDadosExcesso(); 
            }
            else if (this.id === 'aba-comercial') { 
                mudarAba(this, 'conteudo-comercial'); 
                if(titulo) titulo.innerText = 'Comercial & Vendas';
                carregarDadosComercial(); 
            }
            else if (this.id === 'aba-telemetria') {
                mudarAba(this, 'conteudo-telemetria');
                if(titulo) titulo.innerText = 'Telemetria & Frota';
                setTimeout(() => {
                    if (window.mapaTelemetria) { window.mapaTelemetria.invalidateSize(); } else { initMaps(); }
                    atualizarDadosMotorista();
                }, 100);
            }
            else if (this.id === 'aba-pedidos-a-faturar') {
                mudarAba(this, 'conteudo-pedidos-a-faturar');
                if(titulo) titulo.innerText = 'Pedidos a Faturar';
                if (typeof carregarPedidosAFaturar === 'function') carregarPedidosAFaturar();
            }
            else if (this.id === 'aba-pedidos-consulta') {
                mudarAba(this, 'conteudo-pedidos-consulta');
                if(titulo) titulo.innerText = 'Consulta de Pedidos (Rotina 335)';
                const iniEl = document.getElementById('filtro-335-ini');
                const fimEl = document.getElementById('filtro-335-fim');
                const hoje = new Date();
                if (iniEl && !iniEl.value) {
                    iniEl.value = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
                }
                if (fimEl && !fimEl.value) {
                    fimEl.value = hoje.toISOString().slice(0, 10);
                }
            }
            else if (this.id === 'aba-devolucoes-detalhe') {
                mudarAba(this, 'conteudo-devolucoes-detalhe');
                if(titulo) titulo.innerText = 'Devoluções & Setores Responsáveis';
                const iniEl = document.getElementById('filtro-dev-ini');
                const fimEl = document.getElementById('filtro-dev-fim');
                const hoje = new Date();
                if (iniEl && !iniEl.value) {
                    iniEl.value = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
                }
                if (fimEl && !fimEl.value) {
                    fimEl.value = hoje.toISOString().slice(0, 10);
                }
                if (typeof abrirAbaDevolucoes === 'function') abrirAbaDevolucoes();
            }
        });
    });

    window.irParaAbaSistema = function(idBotaoAba) {
        const btn = document.getElementById(idBotaoAba);
        if (btn) btn.click();
    };

    const SUBTITULOS = {
        'aba-dashboard': 'Faturamento e devoluções do mês direto do WinThor',
        'aba-telemetria': 'Entregas, devoluções e quilometragem da frota por motorista',
        'aba-pedidos-a-faturar': 'Pedidos liberados e montados aguardando faturamento',
        'aba-pedidos-consulta': 'Pesquisa de pedidos, itens e DANFE das filiais 1 e 11',
        'aba-devolucoes-detalhe': 'Devoluções por setor, motivo, cliente, vendedor e motorista',
        'aba-cortes': 'Itens cortados, valor perdido e responsáveis',
        'aba-excesso': 'Capital em estoque, excesso, obsoletos e ruptura',
        'aba-comercial': 'Faturamento, rentabilidade e positivação por produto e cliente'
    };

    function mudarAba(abaBotao, idConteudo) {
        abas.forEach(a => { a.classList.remove('ativa'); a.removeAttribute('aria-current'); });
        abaBotao.classList.add('ativa');
        abaBotao.setAttribute('aria-current', 'page');
        const subtitulo = document.getElementById('subtitulo-pagina');
        if (subtitulo && SUBTITULOS[abaBotao.id]) subtitulo.innerText = SUBTITULOS[abaBotao.id];
        window.fecharMenuMobile();
        document.getElementById('main-content')?.scrollTo({ top: 0 });

        const todosConteudos = [
            'conteudo-dashboard', 'conteudo-cortes', 'conteudo-excesso', 'conteudo-comercial', 
            'conteudo-telemetria', 'conteudo-pedidos-a-faturar', 
            'conteudo-pedidos-consulta', 'conteudo-devolucoes-detalhe'
        ];
        
        todosConteudos.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        
        const alvo = document.getElementById(idConteudo);
        if (alvo) {
            alvo.style.display = 'flex';
            alvo.style.flexDirection = 'column';
            alvo.classList.remove('aba-entrando');
            void alvo.offsetWidth;
            alvo.classList.add('aba-entrando');
        }
    }

    // Adicionar logica de minimizar sidebar adaptável
    const toggleBtn = document.createElement('button');
    // O visual minimizado fica todo no CSS (.sidebar-mini em index.html); aqui só alterna a classe.
    toggleBtn.type = 'button';
    toggleBtn.id = 'btn-recolher-menu';
    toggleBtn.title = 'Recolher menu';
    toggleBtn.setAttribute('aria-label', 'Recolher menu');
    toggleBtn.innerHTML = '<i class="fa-solid fa-chevron-left text-[10px]" id="sidebar-chevron"></i>';
    toggleBtn.className = 'absolute -right-3 top-7 w-6 h-6 flex items-center justify-center rounded-full bg-white text-[#323063] shadow-md ring-1 ring-slate-200 cursor-pointer z-50 hover:bg-amber-400 transition-colors';
    const sidebar = document.querySelector('aside.sidebar');
    if (sidebar) {
        sidebar.appendChild(toggleBtn);

        toggleBtn.addEventListener('click', () => {
            const isMinimized = sidebar.classList.toggle('sidebar-mini');
            const chevron = document.getElementById('sidebar-chevron');
            if (chevron) chevron.classList.toggle('rotate-180', isMinimized);
            toggleBtn.title = isMinimized ? 'Expandir menu' : 'Recolher menu';

            // Sem os textos, o nome da aba aparece como dica ao passar o mouse
            document.querySelectorAll('.sidebar .nav-btn, #btn-logout-sidebar').forEach(btn => {
                const label = btn.querySelector('span');
                if (isMinimized && label) btn.title = label.textContent.trim();
                else btn.removeAttribute('title');
            });
        });
    }

    const inputsFiltro = document.querySelectorAll('.filtro-coluna');
    inputsFiltro.forEach(input => {
        input.addEventListener('keyup', function() {
            const idTabela = this.closest('table').id;
            const trs = document.querySelectorAll(`#${idTabela} tbody tr`);
            const inputsLocais = document.querySelectorAll(`#${idTabela} .filtro-coluna`);
            trs.forEach(tr => {
                let mostraLinha = true;
                inputsLocais.forEach(inp => {
                    const colIndex = inp.getAttribute('data-col');
                    const termo = inp.value.toLowerCase();
                    if (termo && tr.cells[colIndex]) {
                        const textoCelula = tr.cells[colIndex].innerText.toLowerCase();
                        if (!textoCelula.includes(termo)) mostraLinha = false;
                    }
                });
                tr.style.display = mostraLinha ? '' : 'none';
            });
        });
    });

    // A plataforma abre sempre na Visão Geral (menu, título e conteúdo coerentes)
    document.getElementById('aba-dashboard')?.click();
});

// Diminui a fonte de um valor só quando ele não cabe inteiro no card (ex.: faturamento com 9 dígitos)
function caberNoCard(id) {
    const el = document.getElementById(id);
    if (!el || !el.offsetParent) return;
    el.style.fontSize = '';
    let tamanho = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth && tamanho > 12) {
        tamanho -= 1;
        el.style.fontSize = tamanho + 'px';
    }
}
window.addEventListener('resize', () => caberNoCard('kpi-faturamento'));

function formatarBRL(valor) { return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function setTexto(id, texto) { const e = document.getElementById(id); if (e) e.innerText = texto; }
function setTextoHTML(id, html) { const e = document.getElementById(id); if (e) e.innerHTML = html; }

const COR_AZUL_FORTE = '#0055A4'; const COR_AZUL_MARINHO = '#002F6C'; const COR_AZUL_CLARO = '#4DA6FF'; 
const COR_AMARELO_OURO = '#FFD100'; const COR_AMARELO_CLARO = '#FFE566'; const COR_VERDE_BOM = '#10B981';

async function pollJobAsync(urlStart) {
    const resStart = await fetch(urlStart);
    const dataStart = await resStart.json();
    if (dataStart.erro) throw new Error(dataStart.erro);
    
    const jobId = dataStart.job_id;
    while (true) {
        await new Promise(r => setTimeout(r, 3000));
        const resStatus = await fetch(`/api/status-job?job_id=${jobId}`);
        const dataStatus = await resStatus.json();
        if (dataStatus.status === 'done') return dataStatus.dados;
        if (dataStatus.erro) throw new Error(dataStatus.erro);
    }
}

const KPIS_CORTES = ['kpi-valor-venda', 'kpi-valor-custo', 'kpi-perc-corte', 'kpi-qtd-produtos', 'kpi-faturamento', 'kpi-qtd-skus'];
const KPIS_EXCESSO = ['kpi-estoque-pago', 'kpi-contas-pagar', 'kpi-perda-venda', 'kpi-valor-estoque', 'kpi-limite-seguranca', 'kpi-valor-excesso',
    'kpi-valor-venda-est', 'kpi-media-venda', 'kpi-custo-fin-excesso', 'kpi-oportunidade-valor', 'kpi-qtd-obsoletos', 'kpi-valor-obsoletos',
    'kpi-skus-zerados', 'kpi-fator-margem', 'kpi-indice-ruptura-valor', 'kpi-indice-ruptura-qtd', 'kpi-indice-45d', 'kpi-oportunidade-compra', 'kpi-itens-estoque'];
const KPIS_COMERCIAL = ['kpi-com-fat-total', 'kpi-com-fat-comp', 'kpi-com-fat-sup', 'kpi-com-perc-total', 'kpi-com-perc-comp',
    'kpi-com-mais-vendido', 'kpi-com-menos-vendido', 'kpi-com-mais-rentavel', 'kpi-com-mais-positivou', 'kpi-com-consistente'];
const KPIS_TELEMETRIA = ['kpi-entregas-qtd', 'kpi-qtd-devolucoes', 'kpi-clientes-atendidos', 'kpi-clientes-devolveram', 'kpi-combustivel', 'kpi-km-rodados'];
const COMPARATIVO_CORTES = ['ant', 'atu', 'res'].flatMap(p => ['fat', 'venda', 'custo', 'perc', 'skus', 'vol'].map(c => `comp-${p}-${c}`));

async function carregarDadosCortes(inicio, fim, area) {
    marcarIndicadores(KPIS_CORTES, 'carregando');
    marcarIndicadores(COMPARATIVO_CORTES, 'carregando');
    try {
        const dados = await pollJobAsync(`/api/start-dashboard-cortes?data_inicio=${inicio}&data_fim=${fim}&area=${area}`);
        marcarIndicadores(KPIS_CORTES, 'pronto');

        setTexto('kpi-valor-venda', formatarBRL(dados.kpis?.valor_total_venda));
        setTexto('kpi-valor-custo', formatarBRL(dados.kpis?.valor_total_custo));
        setTexto('kpi-perc-corte', Number(dados.kpis?.perc_cortes || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + "%");
        setTexto('kpi-qtd-produtos', (dados.kpis?.quantidade_total || 0).toLocaleString('pt-BR') + " ud.");
        setTexto('kpi-faturamento', formatarBRL(dados.kpis?.faturamento_total));
        caberNoCard('kpi-faturamento');
        setTexto('kpi-qtd-skus', (dados.kpis?.qtd_skus_cortados || 0).toLocaleString('pt-BR') + " SKUs");

        desenharGraficoHorizontal('graficoCortesComprador', dados.top_compradores, 'NOME_COMPRADOR', COR_AZUL_FORTE, 'VALOR_PERDIDO');
        desenharGraficoHorizontal('graficoClientes', dados.top_clientes, 'NOME_CLIENTE', COR_AZUL_CLARO, 'VALOR_PERDIDO');
        desenharGraficoHorizontal('graficoProdutos', dados.top_produtos, 'NOME_PRODUTO', COR_AZUL_MARINHO, 'VALOR_PERDIDO');
        desenharGraficoHorizontal('graficoFornecedores', dados.top_fornecedores, 'NOME_FORNECEDOR', COR_AMARELO_OURO, 'VALOR_PERDIDO');
        desenharGraficoHorizontal('graficoConferentes', dados.top_conferentes, 'NOME_CONFERENTE', COR_AZUL_FORTE, 'VALOR_PERDIDO');
        
        const dadosSemanas = dados.cortes_por_semana || [];
        const selectMes = document.getElementById('filtro-mes-grafico');
        if (selectMes && dadosSemanas.length > 0) {
            const mesesUnicos = [...new Set(dadosSemanas.map(item => item.MES))]; selectMes.innerHTML = '';
            if (mesesUnicos.length > 1) { 
                selectMes.style.display = 'block'; 
                mesesUnicos.forEach(mes => { const opt = document.createElement('option'); opt.value = mes; opt.textContent = "Mês: " + mes; selectMes.appendChild(opt); }); 
                selectMes.value = mesesUnicos[mesesUnicos.length - 1]; 
                selectMes.onchange = function() { desenharGraficoLinha('graficoCortesSemana', dadosSemanas.filter(item => item.MES === this.value), 'SEMANA', COR_AZUL_CLARO, 'VALOR_PERDIDO'); }; 
                selectMes.onchange(); 
            } 
            else { selectMes.style.display = 'none'; desenharGraficoLinha('graficoCortesSemana', dadosSemanas, 'SEMANA', COR_AZUL_CLARO, 'VALOR_PERDIDO'); }
        } else { if(selectMes) selectMes.style.display = 'none'; desenharGraficoLinha('graficoCortesSemana', dadosSemanas, 'SEMANA', COR_AZUL_CLARO, 'VALOR_PERDIDO'); }
        
        const c = document.getElementById('listaMotivos');
        if(c) {
            let htmlMotivos = '';
            if ((dados.top_motivos||[]).length === 0) { 
                htmlMotivos = '<p class="text-sm text-slate-400 text-center py-4">Nenhum motivo encontrado.</p>'; 
            } else { 
                let maxMotivo = Math.max(...dados.top_motivos.map(i => i.VALOR_PERDIDO || 0));
                dados.top_motivos.forEach(i => { 
                    let val = i.VALOR_PERDIDO || 0;
                    let pct = maxMotivo > 0 ? (val / maxMotivo * 100) : 0;
                    htmlMotivos += `
                    <div class="mb-3">
                        <div class="flex justify-between items-end mb-1">
                            <span class="text-[11px] font-bold text-[#2A2C65] uppercase truncate mr-2" title="${i.MOTIVO_CORTE || 'Sem Justificativa'}">${i.MOTIVO_CORTE || 'Sem Justificativa'}</span>
                            <span class="text-xs font-black text-rose-600 whitespace-nowrap">${formatarBRL(val)}</span>
                        </div>
                        <div class="w-full bg-slate-100 rounded-full h-1.5">
                            <div class="bg-rose-500 h-1.5 rounded-full" style="width: ${pct}%"></div>
                        </div>
                    </div>`; 
                }); 
            }
            c.innerHTML = htmlMotivos;
        }

        // Busca dados anteriores via polling em background
        pollJobAsync(`/api/start-dashboard-cortes-ant?data_inicio=${inicio}&data_fim=${fim}&area=${area}`)
        .then(dadosAnt => {
            marcarIndicadores(COMPARATIVO_CORTES, dadosAnt.kpis_ant ? 'pronto' : 'erro');
            if (dadosAnt.kpis_ant) {
                const fmtData = (d) => { if(!d) return '--'; const x = new Date(d + 'T00:00:00'); return x.toLocaleDateString('pt-BR'); };
                setTexto('lbl-data-anterior', `${fmtData(dadosAnt.datas_ant.inicio)} a ${fmtData(dadosAnt.datas_ant.fim)}`);
                setTexto('lbl-data-atual', `${fmtData(inicio)} a ${fmtData(fim)}`);
                setTexto('legenda-datas-comparativo', `Atual: ${fmtData(inicio)} a ${fmtData(fim)} | Anterior: ${fmtData(dadosAnt.datas_ant.inicio)} a ${fmtData(dadosAnt.datas_ant.fim)}`);

                const ka = dadosAnt.kpis_ant, kt = dados.kpis;
                const fmtPerc = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
                setTexto('comp-ant-fat', formatarBRL(ka.faturamento_total));
                setTexto('comp-ant-venda', formatarBRL(ka.valor_total_venda));
                setTexto('comp-ant-custo', formatarBRL(ka.valor_total_custo));
                setTexto('comp-ant-perc', fmtPerc(ka.perc_cortes));
                setTexto('comp-ant-skus', (ka.qtd_skus_cortados || 0).toLocaleString('pt-BR'));
                setTexto('comp-ant-vol', (ka.quantidade_total || 0).toLocaleString('pt-BR'));
                
                setTexto('comp-atu-fat', formatarBRL(kt.faturamento_total));
                setTexto('comp-atu-venda', formatarBRL(kt.valor_total_venda));
                setTexto('comp-atu-custo', formatarBRL(kt.valor_total_custo));
                setTexto('comp-atu-perc', fmtPerc(kt.perc_cortes));
                setTexto('comp-atu-skus', (kt.qtd_skus_cortados || 0).toLocaleString('pt-BR'));
                setTexto('comp-atu-vol', (kt.quantidade_total || 0).toLocaleString('pt-BR'));

                // Variação atual x anterior: valor com seta na 1ª linha, percentual em etiqueta na 2ª.
                // inverteCor = true quando subir é ruim (perdas e cortes): verde é sempre "melhorou".
                const renderRes = (id, atu, ant, formatFunc, inverteCor) => {
                    const diff = (atu || 0) - (ant || 0);
                    if (diff === 0) {
                        setTextoHTML(id, `<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500"><i class="fa-solid fa-equals text-[10px]" aria-hidden="true"></i>Estável</span>`);
                        return;
                    }
                    const subiu = diff > 0;
                    const melhorou = inverteCor ? !subiu : subiu;
                    const perc = ant ? Math.abs(diff / ant * 100) : 100;
                    const corValor = melhorou ? 'text-emerald-700' : 'text-rose-600';
                    const corEtiqueta = melhorou ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200';
                    setTextoHTML(id, `
                        <div class="flex flex-col items-start gap-1.5 leading-tight">
                            <span class="inline-flex items-center gap-1.5 text-[13px] font-bold ${corValor}">
                                <i class="fa-solid ${subiu ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'} text-[11px]" aria-hidden="true"></i>${formatFunc(Math.abs(diff))} ${subiu ? 'a mais' : 'a menos'}
                            </span>
                            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${corEtiqueta}">
                                ${subiu ? '+' : '−'}${perc.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% ${subiu ? 'de crescimento' : 'de redução'}
                            </span>
                        </div>`);
                };

                renderRes('comp-res-fat', kt.faturamento_total, ka.faturamento_total, formatarBRL, false); 
                renderRes('comp-res-venda', kt.valor_total_venda, ka.valor_total_venda, formatarBRL, true); 
                renderRes('comp-res-custo', kt.valor_total_custo, ka.valor_total_custo, formatarBRL, true);
                renderRes('comp-res-perc', kt.perc_cortes, ka.perc_cortes, fmtPerc, true);
                renderRes('comp-res-skus', kt.qtd_skus_cortados, ka.qtd_skus_cortados, (v) => v.toLocaleString('pt-BR') + (v === 1 ? ' SKU' : ' SKUs'), true);
                renderRes('comp-res-vol', kt.quantidade_total, ka.quantidade_total, (v) => v.toLocaleString('pt-BR') + ' un.', true);
            }
        }).catch(e => { console.error(e); marcarIndicadores(COMPARATIVO_CORTES, 'erro'); });
    } catch (e) {
        console.error('Erro ao carregar Cortes:', e);
        marcarIndicadores(KPIS_CORTES, 'erro');
        marcarIndicadores(COMPARATIVO_CORTES, 'erro');
    }
}

async function carregarTabelaTop100(inicio, fim, area) {
    try {
        const resposta = await fetch(`/api/top100-detalhado?data_inicio=${inicio}&data_fim=${fim}&area=${area}`);
        const dados = await resposta.json();
        const tbody = document.querySelector('#tabela-top100 tbody'); if(!tbody) return;
        
        let htmlContent = '';
        if (!dados || dados.length === 0) { htmlContent = '<tr><td colspan="13" style="text-align:center;">Nenhum corte encontrado.</td></tr>'; }
        else {
            dados.forEach(row => { 
                htmlContent += `<tr><td>${row.CARREGAMENTO || '-'}</td><td>${row.COMPRADOR || '-'}</td><td>${row.CLIENTE || '-'}</td><td>${row.FORNECEDOR || '-'}</td><td>${row.PRODUTO || '-'}</td><td>${(row.QUANTIDADE_CORTADA || 0).toLocaleString('pt-BR')}</td><td>${(row.QTD_PEDIDOS_CORTADOS || 0).toLocaleString('pt-BR')}</td><td class="valor-td">${formatarBRL(row.VALOR_CORTADO)}</td><td>${row.DATA_CORTE || '-'}</td><td>${row.NOME_CONFERENTE || row.CONFERENTE || '-'}</td><td>${row.MOTIVO_CORTE || '-'}</td><td class="estoque-td">${(row.ESTOQUE_ATUAL || 0).toLocaleString('pt-BR')}</td><td class="estoque-td">${(row.ESTOQUE_DATA_CORTE || 0).toLocaleString('pt-BR')}</td></tr>`; 
            });
        }
        tbody.innerHTML = htmlContent;
    } catch (e) {}
}


async function carregarFiltroMotoristas() {
    try {
        const resp = await fetch('/api/motoristas');
        const dados = await resp.json();
        const select = document.getElementById('filtro-motorista-analise');
        if(select) { 
            // Limpa as options fakes
            select.innerHTML = '<option value="TODOS">Visão Geral (Todos)</option>';
            dados.forEach(s => { 
                let opt = document.createElement('option'); 
                opt.value = s.MATRICULA; 
                opt.textContent = `${s.MATRICULA} - ${s.NOME}`; 
                select.appendChild(opt); 
            }); 
        }
    } catch(e) { console.error("Erro ao carregar motoristas:", e); }
}

async function carregarDadosExcesso() {
    marcarIndicadores(KPIS_EXCESSO, 'carregando');
    try {
        const c = document.getElementById('filtro-comprador')?.value || 'TODOS';
        const dados = await pollJobAsync(`/api/start-dashboard-excesso?comprador=${c}`);
        marcarIndicadores(KPIS_EXCESSO, 'pronto');

        setTexto('kpi-estoque-pago', formatarBRL(dados.kpis?.capital_imobilizado_pago)); 
        setTexto('kpi-contas-pagar', formatarBRL(dados.kpis?.contas_a_pagar)); 
        setTexto('kpi-estoque-geral', formatarBRL(dados.kpis?.valor_estoque_custo));
        setTexto('kpi-estoque-venda', formatarBRL(dados.kpis?.valor_estoque_venda));
        setTexto('kpi-perda-venda', formatarBRL(dados.kpis?.perda_venda_ruptura)); 
        setTexto('kpi-valor-estoque', formatarBRL(dados.kpis?.valor_estoque_custo)); 
        setTexto('kpi-limite-seguranca', formatarBRL(dados.kpis?.valor_ideal_custo)); 
        setTexto('kpi-valor-excesso', formatarBRL(dados.kpis?.valor_excesso)); 
        setTexto('kpi-valor-venda-est', formatarBRL(dados.kpis?.valor_estoque_venda)); 
        setTexto('kpi-media-venda', formatarBRL(dados.kpis?.media_venda_mes)); 
        setTexto('kpi-custo-fin-excesso', formatarBRL((dados.kpis?.valor_excesso || 0) * 0.015)); 
        setTexto('kpi-oportunidade-valor', formatarBRL(dados.kpis?.valor_faltante_custo)); 
        setTexto('kpi-qtd-obsoletos', (dados.kpis?.qtd_itens_45d || 0).toLocaleString('pt-BR') + " SKUs"); 
        setTexto('kpi-valor-obsoletos', formatarBRL(dados.kpis?.valor_parado_45d));
        let skusRup = 0; if (dados.alertas_estoque) { const al = dados.alertas_estoque.find(a => a.NOME_ALERTA === '1. Ruptura (Zerado)'); if (al) skusRup = al.QTD_PRODUTOS; } setTexto('kpi-skus-zerados', skusRup.toLocaleString('pt-BR') + " SKUs");
        let margem = dados.kpis?.valor_estoque_custo > 0 ? ((dados.kpis.valor_estoque_venda - dados.kpis.valor_estoque_custo) / dados.kpis.valor_estoque_custo) * 100 : 0; setTexto('kpi-fator-margem', margem.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
        let indRupturaValor = dados.kpis?.valor_ideal_custo > 0 ? (dados.kpis.valor_faltante_custo / dados.kpis.valor_ideal_custo) * 100 : 0; setTexto('kpi-indice-ruptura-valor', indRupturaValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
        let indRupturaQtd = dados.kpis?.itens_com_estoque > 0 ? ((dados.kpis.qtd_itens_zerados || 0) / dados.kpis.itens_com_estoque) * 100 : 0; setTexto('kpi-indice-ruptura-qtd', indRupturaQtd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
        let ind45d = dados.kpis?.itens_com_estoque > 0 ? ((dados.kpis.qtd_itens_45d || 0) / dados.kpis.itens_com_estoque) * 100 : 0; setTexto('kpi-indice-45d', ind45d.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
        setTexto('kpi-oportunidade-compra', (dados.kpis?.oportunidade_compra || 0).toLocaleString('pt-BR') + " SKUs");
        setTexto('kpi-itens-estoque', (dados.kpis?.itens_com_estoque || 0).toLocaleString('pt-BR'));
        desenharGraficoAlertas(dados.alertas_estoque); desenharGraficoDuplo('graficoLimiteExcesso', dados.limite_comprador); desenharGraficoHorizontal('graficoFornecedoresExcesso', dados.top_fornecedores_excesso, 'NOME_FORNECEDOR', COR_AZUL_MARINHO, 'VALOR_EXCESSO'); desenharGraficoHorizontal('graficoProdutosExcesso', dados.top_produtos_excesso, 'NOME_PRODUTO', COR_AMARELO_OURO, 'VALOR_EXCESSO'); desenharGraficoHorizontal('graficoProdutosEstoque', dados.top_produtos_estoque, 'NOME_PRODUTO', COR_AZUL_FORTE, 'VALOR_ESTOQUE'); desenharGraficoHorizontal('graficoFornecedoresFaltante', dados.fornecedores_faltante, 'NOME_FORNECEDOR', COR_AMARELO_CLARO, 'VALOR_FALTANTE'); desenharGraficoHorizontal('graficoProdutosRuptura', dados.top_produtos_ruptura, 'NOME_PRODUTO', COR_AZUL_FORTE, 'VALOR_PERDA_MENSAL'); desenharGraficoHorizontal('graficoProdutosObsoletos', dados.top_produtos_obsoletos, 'NOME_PRODUTO', COR_AMARELO_OURO, 'DIAS_SEM_VENDA');
    } catch (e) {
        console.error('Erro ao carregar Excesso:', e);
        marcarIndicadores(KPIS_EXCESSO, 'erro');
    }
}

async function carregarSupervisores() {
    try {
        const resp = await fetch('/api/supervisores');
        const dados = await resp.json();
        const select = document.getElementById('filtro-supervisor-comercial');
        if(select) { dados.forEach(s => { let opt = document.createElement('option'); opt.value = s.CODSUPERVISOR; opt.textContent = `${s.CODSUPERVISOR} - ${s.NOME}`; select.appendChild(opt); }); }
    } catch(e) {}
}

async function carregarDadosComercial() {
    marcarIndicadores(KPIS_COMERCIAL, 'carregando');
    try {
        const i = document.getElementById('data-inicio-comercial').value;
        const f = document.getElementById('data-fim-comercial').value;
        const c = document.getElementById('filtro-comprador-comercial')?.value || 'TODOS';
        const s = document.getElementById('filtro-supervisor-comercial')?.value || 'TODOS';

        document.getElementById('loading-overlay')?.style.setProperty('display', 'flex');
        
        const dados = await pollJobAsync(`/api/start-dashboard-comercial?data_inicio=${i}&data_fim=${f}&comprador=${c}&supervisor=${s}`);
        
        document.getElementById('loading-overlay')?.style.setProperty('display', 'none');
        marcarIndicadores(KPIS_COMERCIAL, 'pronto');

        // KPIs de Faturamento
        setTexto('kpi-com-fat-total', formatarBRL(dados.cards.fat_liquido));
        setTexto('kpi-com-fat-comp', c === 'TODOS' ? 'Filtrar Comprador' : formatarBRL(dados.cards.fat_comp));
        setTexto('kpi-com-fat-sup', s === 'TODOS' ? 'Filtrar Supervisor' : formatarBRL(dados.cards.fat_sup));
        setTexto('kpi-com-perc-total', dados.cards.perc_sup_total.toFixed(2) + '%');
        setTexto('kpi-com-perc-comp', dados.cards.perc_sup_comp.toFixed(2) + '%');

        // Cards de Destaque
        const objCards = dados.cards;
        if(objCards && objCards.mais_vendido) {
            // Verificação da cor dinâmica do lucro para o Card
            const corLucroCard = objCards.mais_rentavel.valor.includes('-') ? '#D40000' : '#10B981';

            setTextoHTML('kpi-com-mais-vendido', `<h3><i class="fa-solid fa-trophy" aria-hidden="true"></i> Produto Mais Vendido</h3><span class="card-texto-destaque" title="${objCards.mais_vendido.nome}">${objCards.mais_vendido.nome}</span><span class="card-valor-destaque">${objCards.mais_vendido.valor}</span>`);
            setTextoHTML('kpi-com-menos-vendido', `<h3><i class="fa-solid fa-arrow-trend-down" aria-hidden="true"></i> Produto Menos Vendido</h3><span class="card-texto-destaque" title="${objCards.menos_vendido.nome}">${objCards.menos_vendido.nome}</span><span class="card-valor-destaque">${objCards.menos_vendido.valor}</span>`);
            setTextoHTML('kpi-com-mais-rentavel', `<h3><i class="fa-solid fa-sack-dollar" aria-hidden="true"></i> Produto Mais Rentável</h3><span class="card-texto-destaque" title="${objCards.mais_rentavel.nome}">${objCards.mais_rentavel.nome}</span><span class="card-valor-destaque" style="color:${corLucroCard}">${objCards.mais_rentavel.valor}</span>`);
            setTextoHTML('kpi-com-mais-positivou', `<h3><i class="fa-solid fa-handshake" aria-hidden="true"></i> Maior Positivação</h3><span class="card-texto-destaque" title="${objCards.mais_positivou.nome}">${objCards.mais_positivou.nome}</span><span class="card-valor-destaque">${objCards.mais_positivou.valor}</span>`);
            setTextoHTML('kpi-com-consistente', `<h3><i class="fa-solid fa-stopwatch" aria-hidden="true"></i> Relógio Suíço (Consistência)</h3><span class="card-texto-destaque" title="${objCards.mais_consistente.nome}">${objCards.mais_consistente.nome}</span><span class="card-valor-destaque" style="color:#002F6C; font-size: 0.90rem; white-space: normal; overflow: visible;">${objCards.mais_consistente.valor}</span>`);
        } else {
            const z = "Sem vendas"; setTexto('kpi-com-mais-vendido', z); setTexto('kpi-com-menos-vendido', z); setTexto('kpi-com-mais-rentavel', z); setTexto('kpi-com-mais-positivou', z); setTexto('kpi-com-consistente', z);
        }

        // Insights Panel
        const pnl = document.getElementById('painel-insights');
        if(pnl) {
            let htmlIns = '';
            (dados.insights || []).forEach(ins => {
                htmlIns += `<div class="insight-item ${ins.tipo}"><div class="insight-icon">${ins.icone}</div><div class="insight-content"><h4>${ins.titulo}</h4><p>${ins.texto}</p></div></div>`;
            });
            pnl.innerHTML = htmlIns;
        }

        let prods = dados.produtos || [];
        let topProdFat = [...prods].sort((a,b) => b.FATURAMENTO - a.FATURAMENTO).slice(0, 10);
        let topRent = [...prods].sort((a,b) => b.LUCRO - a.LUCRO).slice(0, 10);
        let topPosi = [...prods].sort((a,b) => b.POSITIVACAO - a.POSITIVACAO).slice(0, 10);
        let topCons = [...prods].filter(p => p.CV < 999999).sort((a,b) => a.CV - b.CV).slice(0, 10);
        
        let clientesFat = [...(dados.clientes || [])].slice(0, 10);
        let clientesNotas = [...(dados.clientes || [])].sort((a,b) => b.QTD_NOTAS - a.QTD_NOTAS).slice(0, 10);

        // CAIXA DE FILTRO DO GRÁFICO PEDIDOS POR SEMANA
        const dadosSemanasCom = dados.semanas || [];
        const selectMesCom = document.getElementById('filtro-mes-grafico-comercial');
        if (selectMesCom && dadosSemanasCom.length > 0) {
            const mesesUnicosCom = [...new Set(dadosSemanasCom.map(item => item.MES))].filter(Boolean);
            selectMesCom.innerHTML = '';
            if (mesesUnicosCom.length > 1) {
                selectMesCom.style.display = 'block';
                mesesUnicosCom.forEach(mes => {
                    const opt = document.createElement('option'); opt.value = mes; opt.textContent = "Mês: " + mes; selectMesCom.appendChild(opt);
                });
                selectMesCom.value = mesesUnicosCom[mesesUnicosCom.length - 1];
                selectMesCom.onchange = function() {
                    desenharGraficoLinha('graficoComPedidosSemana', dadosSemanasCom.filter(item => item.MES === this.value), 'SEMANA', COR_AZUL_CLARO, 'QTD_PEDIDOS');
                };
                selectMesCom.onchange();
            } else {
                selectMesCom.style.display = 'none';
                desenharGraficoLinha('graficoComPedidosSemana', dadosSemanasCom, 'SEMANA', COR_AZUL_CLARO, 'QTD_PEDIDOS');
            }
        } else {
            if(selectMesCom) selectMesCom.style.display = 'none';
            desenharGraficoLinha('graficoComPedidosSemana', dadosSemanasCom, 'SEMANA', COR_AZUL_CLARO, 'QTD_PEDIDOS');
        }

        // GALERIA DE GRÁFICOS
        desenharGraficoHorizontal('graficoComFatProduto', topProdFat, 'DESCRICAO', COR_AZUL_FORTE, 'FATURAMENTO');
        desenharGraficoHorizontal('graficoComMaisRentaveis', topRent, 'DESCRICAO', COR_VERDE_BOM, 'LUCRO');
        desenharGraficoHorizontal('graficoComFatCliente', clientesFat, 'NOME_CLIENTE', COR_AZUL_FORTE, 'FATURAMENTO');
        desenharGraficoHorizontal('graficoComFatFornecedor', dados.fornecedores || [], 'NOME_FORNECEDOR', COR_AMARELO_OURO, 'FATURAMENTO');
        desenharGraficoHorizontal('graficoComNotasCliente', clientesNotas, 'NOME_CLIENTE', COR_AZUL_MARINHO, 'QTD_NOTAS');
        desenharGraficoHorizontal('graficoComPositivacao', topPosi, 'DESCRICAO', COR_AZUL_CLARO, 'POSITIVACAO');
        desenharGraficoHorizontal('graficoComConsistentes', topCons, 'DESCRICAO', COR_AZUL_MARINHO, 'CV');

        // Tabela Clientes - Formatação Dinâmica de Cor
        const tbCli = document.querySelector('#tabela-clientes-comercial tbody');
        if(tbCli) {
            tbCli.innerHTML = '';
            (dados.clientes || []).forEach(row => {
                const corLucro = row.LUCRO < 0 ? '#D40000' : '#10B981'; // Vermelho se negativo, Verde se positivo
                tbCli.innerHTML += `<tr><td>${row.CODCLI}</td><td>${row.NOME_CLIENTE}</td><td class="estoque-td">${formatarBRL(row.FATURAMENTO)}</td><td class="valor-td" style="color:${corLucro}">${formatarBRL(row.LUCRO)}</td><td>${row.QTD_NOTAS}</td><td>${row.DIAS_COMPRA} Dias</td></tr>`;
            });
        }

        // Tabela Produtos - Formatação Dinâmica de Cor
        const tbody = document.querySelector('#tabela-comercial tbody');
        if(tbody) {
            let htmlProds = '';
            if (prods.length === 0) { htmlProds = '<tr><td colspan="11" style="text-align:center;">Nenhum produto vendido nestes filtros.</td></tr>'; }
            else {
                prods.forEach(row => {
                    const corLucro = row.LUCRO < 0 ? '#D40000' : '#10B981'; // Vermelho se negativo, Verde se positivo
                    htmlProds += `<tr><td>${row.CODPROD}</td><td>${row.DESCRICAO}</td><td>${row.EMBALAGEM}</td><td>${row.FORNECEDOR}</td><td>${row.COMPRADOR}</td><td>${row.SUPERVISOR_MAIS_VENDEU}</td><td class="estoque-td">${formatarBRL(row.FATURAMENTO)}</td><td class="valor-td" style="color:${corLucro}">${formatarBRL(row.LUCRO)}</td><td style="font-weight:bold">${row.POSITIVACAO} cli.</td><td>${Math.round(row.MEDIA_DIA)} un.</td><td>${Math.round(row.MEDIA_SEMANA)} un.</td></tr>`;
                });
            }
            tbody.innerHTML = htmlProds;
        }

    } catch (e) {
        console.error("Erro Comercial:", e);
        document.getElementById('loading-overlay')?.style.setProperty('display', 'none');
        marcarIndicadores(KPIS_COMERCIAL, 'erro');
    }
}

const chartInstances = {};

// Como ler o valor de cada coluna dos gráficos de barras (moeda, dias, pedidos...)
const COLUNAS_MOEDA = ['VALOR_PERDIDO', 'VALOR_EXCESSO', 'VALOR_ESTOQUE', 'VALOR_FALTANTE', 'VALOR_PERDA_MENSAL', 'VALOR_OBSOLETO', 'VALOR_CORTADO', 'LUCRO', 'FATURAMENTO', 'VENDA'];
function tipoValorGrafico(coluna) {
    if (COLUNAS_MOEDA.includes(coluna) || coluna.includes('VALOR')) return 'moeda';
    if (coluna === 'DIAS_SEM_VENDA') return 'dias';
    if (coluna === 'PESO') return 'kg';
    if (coluna === 'POSITIVACAO') return 'clientes';
    if (coluna === 'CV') return 'cv';
    if (coluna === 'QTD_NOTAS') return 'notas';
    if (['QTD_CORTES', 'PEDIDOS_CORTADOS', 'QTD_PEDIDOS'].includes(coluna)) return 'pedidos';
    return 'unidades';
}
function formatarMoedaCurta(v) {
    const n = Number(v || 0), abs = Math.abs(n);
    if (abs >= 1e6) return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
    if (abs >= 1e3) return 'R$ ' + Math.round(n / 1e3).toLocaleString('pt-BR') + ' mil';
    return 'R$ ' + Math.round(n).toLocaleString('pt-BR');
}
function formatarValorGrafico(v, tipo, curto) {
    const n = Number(v || 0);
    switch (tipo) {
        case 'moeda': return curto ? formatarMoedaCurta(n) : formatarBRL(n);
        case 'dias': return n.toLocaleString('pt-BR') + (n === 1 ? ' dia' : ' dias');
        case 'kg': return n.toLocaleString('pt-BR', { maximumFractionDigits: curto ? 0 : 1 }) + ' kg';
        case 'clientes': return n.toLocaleString('pt-BR') + ' clientes';
        case 'cv': return 'CV ' + Math.round(n) + '%';
        case 'notas': return n.toLocaleString('pt-BR') + ' NF-es';
        case 'pedidos': return n.toLocaleString('pt-BR') + ' pedidos';
        default: return n.toLocaleString('pt-BR') + ' un.';
    }
}

// Escreve o valor na ponta de cada barra (gráficos horizontais de top 10)
const pluginValorNaBarra = {
    id: 'valorNaBarra',
    afterDatasetsDraw(chart, _args, opts) {
        if (!opts || !opts.formatar) return;
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = "600 10px 'Inter', system-ui, sans-serif";
        ctx.fillStyle = '#334155';
        ctx.textBaseline = 'middle';
        meta.data.forEach((barra, i) => {
            ctx.fillText(opts.formatar(chart.data.datasets[0].data[i]), barra.x + 6, barra.y);
        });
        ctx.restore();
    }
};

function desenharGraficoHorizontal(idCanvas, dadosOriginal, colunaNome, corGrafico, colunaValor) {
    const dados = (dadosOriginal || []).slice(0, 10);
    const el = document.getElementById(idCanvas);
    if (!el) return;
    if (chartInstances[idCanvas]) chartInstances[idCanvas].destroy();

    // Altura proporcional ao número de barras: com pouco espaço o Chart.js esconde rótulos do eixo
    const container = el.parentElement;
    if (container) {
        container.style.position = 'relative';
        container.style.height = Math.max(220, dados.length * 30 + 50) + 'px';
    }

    const tipo = tipoValorGrafico(colunaValor);
    const nomes = dados.map(i => String(i[colunaNome] || 'Desconhecido').replace(/\s+/g, ' ').trim());
    const maior = Math.max(0, ...dados.map(i => Number(i[colunaValor] || 0)));

    chartInstances[idCanvas] = new Chart(el.getContext('2d'), {
        type: 'bar',
        data: {
            labels: nomes,
            datasets: [{
                label: 'Valor',
                data: dados.map(i => i[colunaValor] || 0),
                backgroundColor: corGrafico,
                hoverBackgroundColor: corGrafico,
                borderRadius: 4,
                borderSkipped: false,
                barPercentage: 0.8,
                categoryPercentage: 0.85,
                maxBarThickness: 22
            }]
        },
        plugins: [pluginValorNaBarra],
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { left: 4, right: 70, top: 4, bottom: 4 } },
            plugins: {
                legend: { display: false },
                valorNaBarra: { formatar: v => formatarValorGrafico(v, tipo, true) },
                tooltip: {
                    callbacks: {
                        title: itens => nomes[itens[0].dataIndex],
                        label: c => {
                            const item = dados[c.dataIndex];
                            if (tipo === 'cv') return `CV: ${Math.round(c.raw)}% | Média: ${Math.round(item.MEDIA_DIA || 0)} un/dia`;
                            if (tipo === 'dias') {
                                return [
                                    `${formatarValorGrafico(c.raw, 'dias')} sem venda`,
                                    item.NUNCA_VENDEU === 'S' ? `Nunca vendeu (cadastrado em ${item.DESDE})` : `Última venda: ${item.DESDE}`,
                                    `Estoque parado: ${Number(item.QTD_ESTOQUE || 0).toLocaleString('pt-BR')} un. · ${formatarBRL(item.VALOR_OBSOLETO)}`
                                ];
                            }
                            return formatarValorGrafico(c.raw, tipo, false);
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    suggestedMax: maior * 1.08,
                    grid: { color: 'rgba(148, 163, 184, 0.18)', drawTicks: false },
                    border: { display: false },
                    ticks: { font: { size: 10 }, maxTicksLimit: 5, maxRotation: 0, padding: 6, callback: v => formatarValorGrafico(v, tipo, true) }
                },
                y: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        autoSkip: false,
                        font: { size: 10, weight: '600' },
                        color: '#334155',
                        callback: function(v) {
                            const l = this.getLabelForValue(v) || '';
                            return l.length > 30 ? l.substring(0, 29) + '…' : l;
                        }
                    }
                }
            }
        }
    });
}

function desenharGraficoLinha(idCanvas, dadosOriginal, colunaNome, corGrafico, colunaValor) {
    const dados = dadosOriginal || []; const el = document.getElementById(idCanvas); if (!el) return; const ctx = el.getContext('2d');
    if (chartInstances[idCanvas]) chartInstances[idCanvas].destroy();
    const labelDataset = (colunaValor === 'QTD_PEDIDOS' || colunaValor === 'QTD_CORTES') ? 'Quantidade de Pedidos' : 'Valor (R$)';
    chartInstances[idCanvas] = new Chart(ctx, { type: 'line', data: { labels: dados.map(i => i[colunaNome] || 'Desconhecido'), datasets: [{ label: labelDataset, data: dados.map(i => i[colunaValor] || 0), borderColor: corGrafico, backgroundColor: corGrafico, borderWidth: 3, pointRadius: 5, pointHoverRadius: 7, tension: 0.3, fill: false }] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: { bottom: 15 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c) { if(['VALOR_PERDIDO', 'VALOR_EXCESSO', 'VALOR_ESTOQUE', 'LUCRO', 'FATURAMENTO', 'VENDA'].includes(colunaValor) || colunaValor.includes('VALOR')) return formatarBRL(c.raw); if(colunaValor === 'QTD_PEDIDOS' || colunaValor === 'QTD_CORTES') return (c.raw || 0).toLocaleString('pt-BR') + ' Pedidos'; return (c.raw || 0).toLocaleString('pt-BR'); } } } }, scales: { y: { beginAtZero: true, ticks: { font: { weight: 'bold' }, callback: function(v) { if(['VALOR_PERDIDO', 'VALOR_EXCESSO', 'VALOR_ESTOQUE', 'LUCRO', 'FATURAMENTO', 'VENDA'].includes(colunaValor) || colunaValor.includes('VALOR')) { if (v >= 1000000) return 'R$ ' + (v/1000000).toFixed(1) + 'M'; if (v >= 1000) return 'R$ ' + (v/1000).toFixed(0) + 'k'; return 'R$ ' + v; } return (v || 0).toLocaleString('pt-BR'); } } }, x: { ticks: { font: { weight: 'bold' } } } } } });
}
// Escreve o valor em cima de cada coluna (gráfico de colunas agrupadas do Excesso)
const pluginValorNasColunas = {
    id: 'valorNasColunas',
    afterDatasetsDraw(chart, _args, opts) {
        if (!opts || !opts.formatar) return;
        const { ctx } = chart;
        ctx.save();
        ctx.font = "600 9px 'Inter', system-ui, sans-serif";
        ctx.fillStyle = '#334155';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        chart.data.datasets.forEach((ds, d) => {
            const meta = chart.getDatasetMeta(d);
            if (meta.hidden) return;
            meta.data.forEach((barra, i) => {
                const v = Number(ds.data[i] || 0);
                if (v > 0) ctx.fillText(opts.formatar(v), barra.x, barra.y - 3);
            });
        });
        ctx.restore();
    }
};

function desenharGraficoDuplo(idCanvas, dadosOriginal) {
    const dados = dadosOriginal || [];
    const el = document.getElementById(idCanvas);
    if (!el) return;
    if (chartInstances[idCanvas]) chartInstances[idCanvas].destroy();
    if (el.parentElement) el.parentElement.style.height = '340px';

    // Escala logarítmica: compradores com valores pequenos ficam visíveis ao lado dos grandes
    const positivos = dados.flatMap(i => [Number(i.VALOR_EXCESSO || 0), Number(i.VALOR_IDEAL || 0)]).filter(v => v > 0);
    const piso = positivos.length ? Math.pow(10, Math.floor(Math.log10(Math.min(...positivos)))) : 1;
    const tetoLog = positivos.length ? Math.pow(10, Math.ceil(Math.log10(Math.max(...positivos) * 1.6))) : 10;

    chartInstances[idCanvas] = new Chart(el.getContext('2d'), {
        type: 'bar',
        data: {
            labels: dados.map(i => i.NOME_COMPRADOR),
            datasets: [
                { label: 'Excesso (R$)', data: dados.map(i => i.VALOR_EXCESSO), backgroundColor: COR_AMARELO_OURO, borderRadius: 4 },
                { label: 'Limite Máximo Ideal (R$)', data: dados.map(i => i.VALOR_IDEAL), backgroundColor: COR_AZUL_FORTE, borderRadius: 4 }
            ]
        },
        plugins: [pluginValorNasColunas],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 16, bottom: 10 } },
            // Passar o mouse em qualquer ponto da coluna do comprador mostra os dois valores
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { font: { size: 12, weight: 'bold' } } },
                valorNasColunas: { formatar: formatarMoedaCurta },
                tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatarBRL(c.raw)}` } }
            },
            scales: {
                x: { ticks: { font: { weight: 'bold' } }, grid: { display: false } },
                y: {
                    type: 'logarithmic',
                    min: piso,
                    max: tetoLog,
                    ticks: {
                        font: { weight: 'bold' },
                        callback: v => {
                            const base = v / Math.pow(10, Math.floor(Math.log10(v)));
                            return [1, 2, 5].includes(Math.round(base * 10) / 10) ? formatarMoedaCurta(v) : '';
                        }
                    }
                }
            }
        }
    });
}
function desenharGraficoAlertas(dadosOriginal) {
    const dados = dadosOriginal || []; const el = document.getElementById('graficoAlertas'); if (!el) return; const ctx = el.getContext('2d');
    if (chartInstances['graficoAlertas']) chartInstances['graficoAlertas'].destroy();
    const cores = [COR_AZUL_MARINHO, COR_AZUL_FORTE, COR_AMARELO_OURO, COR_AZUL_CLARO, COR_AMARELO_CLARO];
    chartInstances['graficoAlertas'] = new Chart(ctx, { type: 'bar', data: { labels: dados.map(i => i.NOME_ALERTA), datasets: [{ data: dados.map(i => i.QTD_PRODUTOS), backgroundColor: cores, borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: { bottom: 20 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c) { return (c.raw || 0).toLocaleString('pt-BR') + ' SKUs'; } } } }, scales: { y: { beginAtZero: true, ticks: { font: { weight: 'bold' } } }, x: { ticks: { font: { size: 10, weight: 'bold' } } } } } });
}

// ==================== MAPAS TELEMETRIA ====================
let mapsInitialized = false;
// --- VARIÁVEIS DO PAINEL DO MOTORISTA ---
let municipiosGeo = null;
let devolucoesCidades = [];
let chartDevValor = null;
let chartDevPeso = null;
let chartFrotaSiga = null;
let chartGastoTipo = null;

let estadoVisao = 'PE'; // 'PE' ou 'RMR'
let estadoMetrica = 'valor'; // 'valor' ou 'taxa'

const RMR_CIDADES = [
    "Recife", "Jaboatão dos Guararapes", "Olinda", "Paulista", "Abreu e Lima", 
    "Igarassu", "Cabo de Santo Agostinho", "Ipojuca", "Camaragibe", "São Lourenço da Mata", 
    "Araçoiaba", "Ilha de Itamaracá", "Itapissuma", "Moreno"
].map(c => c.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));

function normalizarNome(nome) {
    return nome.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// Inicialização (chamada após autenticação)
async function initMaps() {
    if (chartDevValor) return; // já inicializado

    // 1. Renderizar Gráficos de Devolução
    carregarFiltroMotoristas();
    
    const diTele = document.getElementById('data-inicio-telemetria');
    const dfTele = document.getElementById('data-fim-telemetria');
    if (diTele && dfTele && !diTele.value) {
        const hoje = new Date();
        const priDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        diTele.value = priDia.toISOString().split('T')[0];
        dfTele.value = hoje.toISOString().split('T')[0];
    }

    initChartsMotorista();
    atualizarDadosMotorista();

    // 2. Preencher Tabela de Rotas
    // preencherTabelaRotas();

    // 3. Carregar SVG de Pernambuco
    try {
        const response = await fetch('js/pe-municipios.json');
        municipiosGeo = await response.json();
        // Se a resposta do WinThor chegou antes da malha, aplica agora (nunca exibir dado de exemplo)
        aplicarCidadesTelemetria(window._ultimasCidadesTelemetria || []);
        
    } catch (e) {
        console.error("Erro ao carregar mapa SVG", e);
        document.getElementById('mapa-svg-container').innerHTML = '<p class="text-red-500 text-sm">Erro ao carregar malha municipal.</p>';
    }
}

function initChartsMotorista() {
    const ctxValor = document.getElementById('chart-devolucao-valor');
    const ctxPeso = document.getElementById('chart-devolucao-peso');
    
    if(!ctxValor || !ctxPeso) return;

    // Começa vazio: os valores reais chegam em atualizarDadosMotorista (nunca exibir números de exemplo)
    const dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const valoresNum = [0, 0, 0, 0, 0, 0];
    const pesosNum = [0, 0, 0, 0, 0, 0];
    
    chartDevValor = new Chart(ctxValor, {
        type: 'bar',
        data: {
            labels: dias,
            datasets: [{
                label: 'Valor Devolvido (R$)',
                data: valoresNum,
                backgroundColor: '#ef4444',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { 
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            let val = ctx.parsed.y;
                            let isPct = ctx.dataset.label.includes('%') || ctx.dataset.label.includes('Taxa');
                            if(isPct) return ctx.dataset.label + ': ' + val.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '%';
                            return ctx.dataset.label + ': ' + val.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
                        }
                    }
                }
            },
            scales: { 
                y: { 
                    beginAtZero: true,
                    ticks: {
                        callback: function(val) {
                            return val.toLocaleString('pt-BR', {maximumFractionDigits:1});
                        }
                    }
                } 
            }
        }
    });
    // Salvar dados originais para o toggle
    chartDevValor.originalDataNum = valoresNum;
    chartDevValor.originalDataPct = [0, 0, 0, 0, 0, 0];
    
    chartDevPeso = new Chart(ctxPeso, {
        type: 'line',
        data: {
            labels: dias,
            datasets: [{
                label: 'Peso Devolvido (Kg)',
                data: pesosNum,
                borderColor: '#f59e0b',
                backgroundColor: '#fef3c7',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { 
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            let val = ctx.parsed.y;
                            let isPct = ctx.dataset.label.includes('%') || ctx.dataset.label.includes('Taxa');
                            if(isPct) return ctx.dataset.label + ': ' + val.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '%';
                            return ctx.dataset.label + ': ' + val.toLocaleString('pt-BR', {maximumFractionDigits:1}) + ' Kg';
                        }
                    }
                }
            },
            scales: { 
                y: { 
                    beginAtZero: true,
                    ticks: {
                        callback: function(val) {
                            return val.toLocaleString('pt-BR', {maximumFractionDigits:1});
                        }
                    }
                } 
            }
        }
    });
    chartDevPeso.originalDataNum = pesosNum;
    chartDevPeso.originalDataPct = [0, 0, 0, 0, 0, 0];
}

window.chartOrigem = {
    valor: 'fat',
    peso: 'fat'
};

window.toggleChartOrigem = function(chartType, origem) {
    window.chartOrigem[chartType] = origem;
    const chart = chartType === 'valor' ? chartDevValor : chartDevPeso;
    if (!chart) return;
    
    const btnFat = document.getElementById(`btn-toggle-${chartType === 'valor' ? 'val' : 'peso'}-origem-fat`);
    const btnMov = document.getElementById(`btn-toggle-${chartType === 'valor' ? 'val' : 'peso'}-origem-mov`);
    
    if (origem === 'fat') {
        if (btnFat) {
            btnFat.classList.replace('text-slate-500', 'text-[#2A2C65]');
            btnFat.classList.replace('hover:text-slate-700', 'bg-white');
            btnFat.classList.add('bg-white', 'shadow-sm');
        }
        if (btnMov) {
            btnMov.classList.replace('text-[#2A2C65]', 'text-slate-500');
            btnMov.classList.replace('bg-white', 'hover:text-slate-700');
            btnMov.classList.remove('shadow-sm');
        }
    } else {
        if (btnMov) {
            btnMov.classList.replace('text-slate-500', 'text-[#2A2C65]');
            btnMov.classList.replace('hover:text-slate-700', 'bg-white');
            btnMov.classList.add('bg-white', 'shadow-sm');
        }
        if (btnFat) {
            btnFat.classList.replace('text-[#2A2C65]', 'text-slate-500');
            btnFat.classList.replace('bg-white', 'hover:text-slate-700');
            btnFat.classList.remove('shadow-sm');
        }
    }
    
    const dados = (origem === 'fat' ? chart.dadosFat : chart.dadosMov) || { num: [0,0,0,0,0,0], pct: [0,0,0,0,0,0] };
    chart.originalDataNum = dados.num || [0,0,0,0,0,0];
    chart.originalDataPct = dados.pct || [0,0,0,0,0,0];
    
    const btnPct = document.getElementById(`btn-toggle-${chartType === 'valor' ? 'val' : 'peso'}-pct`);
    const isPct = btnPct?.classList.contains('bg-white');
    chart.data.datasets[0].data = isPct ? chart.originalDataPct : chart.originalDataNum;
    chart.update();
};

window.toggleChartType = function(chartType, mode) {
    const chart = chartType === 'valor' ? chartDevValor : chartDevPeso;
    if (!chart) return;
    
    const btnNum = document.getElementById(`btn-toggle-${chartType === 'valor' ? 'val' : 'peso'}-num`);
    const btnPct = document.getElementById(`btn-toggle-${chartType === 'valor' ? 'val' : 'peso'}-pct`);
    
    if (mode === 'num') {
        btnNum.classList.replace('text-slate-500', 'text-[#2A2C65]');
        btnNum.classList.replace('hover:text-slate-700', 'bg-white');
        btnNum.classList.add('bg-white', 'shadow-sm');
        btnPct.classList.replace('text-[#2A2C65]', 'text-slate-500');
        btnPct.classList.replace('bg-white', 'hover:text-slate-700');
        btnPct.classList.remove('shadow-sm');
        
        chart.data.datasets[0].data = chart.originalDataNum;
        chart.data.datasets[0].label = chartType === 'valor' ? 'Valor (R$)' : 'Peso (Kg)';
    } else {
        btnPct.classList.replace('text-slate-500', 'text-[#2A2C65]');
        btnPct.classList.replace('hover:text-slate-700', 'bg-white');
        btnPct.classList.add('bg-white', 'shadow-sm');
        btnNum.classList.replace('text-[#2A2C65]', 'text-slate-500');
        btnNum.classList.replace('bg-white', 'hover:text-slate-700');
        btnNum.classList.remove('shadow-sm');
        
        chart.data.datasets[0].data = chart.originalDataPct;
        chart.data.datasets[0].label = 'Taxa (%)';
    }
    chart.update();
};

let _dadosRotasCache = [];

function preencherTabelaRotas(rotas = []) {
    const tbody = document.getElementById('tbody-rotas-devolucao');
    if (!tbody) return;

    // Considera apenas as rotas que realmente tiveram devolução (> 0)
    _dadosRotasCache = (rotas || []).filter(r => (Number(r.VLDEVOLUCAO || 0) > 0));

    // Ordena do maior valor de devolução para o menor
    _dadosRotasCache.sort((a, b) => (Number(b.VLDEVOLUCAO || 0) - Number(a.VLDEVOLUCAO || 0)));

    // Popula os selects de filtro
    atualizarFiltrosTabelaRotas(_dadosRotasCache);

    // Renderiza a tabela
    renderizarTabelaRotas();
}

function atualizarFiltrosTabelaRotas(rotas) {
    const selRota = document.getElementById('filtro-tabela-rota');
    const selMot = document.getElementById('filtro-tabela-motorista');
    if (!selRota || !selMot) return;

    const valRotaAtual = selRota.value || 'TODAS';
    const valMotAtual = selMot.value || 'TODOS';

    // Rotas únicas ordenadas
    const rotasUnicas = [...new Set(rotas.map(r => (r.DESTINO || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    let optsRota = `<option value="TODAS">Todas as Rotas (${rotasUnicas.length})</option>`;
    rotasUnicas.forEach(rt => {
        optsRota += `<option value="${rt}">${rt}</option>`;
    });
    selRota.innerHTML = optsRota;
    if (rotasUnicas.includes(valRotaAtual)) {
        selRota.value = valRotaAtual;
    } else {
        selRota.value = 'TODAS';
    }

    // Motoristas únicos ordenados
    const motoristasUnicos = [...new Set(rotas.map(r => (r.NOME_MOTORISTA || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    let optsMot = `<option value="TODOS">Todos os Motoristas (${motoristasUnicos.length})</option>`;
    motoristasUnicos.forEach(mot => {
        optsMot += `<option value="${mot}">${mot}</option>`;
    });
    selMot.innerHTML = optsMot;
    if (motoristasUnicos.includes(valMotAtual)) {
        selMot.value = valMotAtual;
    } else {
        selMot.value = 'TODOS';
    }

    if (!selRota._listenerAttached) {
        selRota.addEventListener('change', renderizarTabelaRotas);
        selRota._listenerAttached = true;
    }
    if (!selMot._listenerAttached) {
        selMot.addEventListener('change', renderizarTabelaRotas);
        selMot._listenerAttached = true;
    }
}

function renderizarTabelaRotas() {
    const tbody = document.getElementById('tbody-rotas-devolucao');
    const contador = document.getElementById('rotas-contador');
    if (!tbody) return;

    const selRota = document.getElementById('filtro-tabela-rota');
    const selMot = document.getElementById('filtro-tabela-motorista');

    const filtroRota = selRota ? selRota.value : 'TODAS';
    const filtroMot = selMot ? selMot.value : 'TODOS';

    let filtradas = _dadosRotasCache;

    if (filtroRota && filtroRota !== 'TODAS') {
        filtradas = filtradas.filter(r => (r.DESTINO || '').trim() === filtroRota);
    }
    if (filtroMot && filtroMot !== 'TODOS') {
        filtradas = filtradas.filter(r => (r.NOME_MOTORISTA || '').trim() === filtroMot);
    }

    if (contador) {
        contador.innerText = `${filtradas.length} rotas com devolução encontradas`;
    }

    if (filtradas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400 py-6 font-medium">Nenhuma rota com devolução encontrada para estes filtros.</td></tr>';
        return;
    }

    let html = '';
    filtradas.forEach(r => {
        const nomeRota = r.DESTINO || 'N/A';
        const nomeMotorista = r.NOME_MOTORISTA || 'N/A';
        const cargas = Math.floor(r.CARGAS || 0);
        const peso = Number(r.PESOFATURADO || 0);
        const faturado = Number(r.VLFATURADO || 0);
        const devolvido = Number(r.VLDEVOLUCAO || 0);
        const taxa = faturado > 0 ? (devolvido / faturado) * 100 : (devolvido > 0 ? 100 : 0);

        html += `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-3 font-bold text-slate-800">${nomeRota}</td>
                <td class="p-3 text-slate-600 text-xs font-semibold whitespace-nowrap">${nomeMotorista}</td>
                <td class="p-3 font-medium text-slate-700">${cargas}</td>
                <td class="p-3 font-medium text-slate-700">${peso.toLocaleString('pt-BR', {maximumFractionDigits: 0})} kg</td>
                <td class="p-3 font-medium text-slate-700">R$ ${faturado.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                <td class="p-3 font-bold text-rose-600">R$ ${devolvido.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                <td class="p-3 font-bold ${taxa > 5 ? 'text-red-600' : 'text-slate-700'}">${taxa.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}%</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

window.alterarVisaoMapa = function(visao) {
    estadoVisao = visao;
    const btnPE = document.getElementById('btn-visao-pe');
    const btnRMR = document.getElementById('btn-visao-rmr');
    
    if (visao === 'PE') {
        btnPE.classList.replace('text-slate-500', 'text-[#2A2C65]');
        btnPE.classList.replace('hover:text-slate-700', 'bg-white');
        btnPE.classList.add('bg-white', 'shadow-sm');
        btnRMR.classList.replace('text-[#2A2C65]', 'text-slate-500');
        btnRMR.classList.replace('bg-white', 'hover:text-slate-700');
        btnRMR.classList.remove('shadow-sm');
    } else {
        btnRMR.classList.replace('text-slate-500', 'text-[#2A2C65]');
        btnRMR.classList.replace('hover:text-slate-700', 'bg-white');
        btnRMR.classList.add('bg-white', 'shadow-sm');
        btnPE.classList.replace('text-[#2A2C65]', 'text-slate-500');
        btnPE.classList.replace('bg-white', 'hover:text-slate-700');
        btnPE.classList.remove('shadow-sm');
    }
    desenharMapaSVG();
};

window.alterarMetricaMapa = function(metrica) {
    estadoMetrica = metrica;
    const btnVal = document.getElementById('btn-metrica-val');
    const btnPct = document.getElementById('btn-metrica-pct');
    
    if (metrica === 'valor') {
        btnVal.classList.replace('text-slate-500', 'text-white');
        btnVal.classList.replace('bg-slate-100', 'bg-[#2A2C65]');
        btnPct.classList.replace('text-white', 'text-slate-500');
        btnPct.classList.replace('bg-[#2A2C65]', 'bg-transparent');
    } else {
        btnPct.classList.replace('text-slate-500', 'text-white');
        btnPct.classList.replace('hover:text-slate-700', 'bg-[#2A2C65]');
        btnPct.classList.add('bg-[#2A2C65]');
        btnVal.classList.replace('text-white', 'text-slate-500');
        btnVal.classList.replace('bg-[#2A2C65]', 'bg-transparent');
    }
    desenharMapaSVG();
};

function getCorRampa(percent) {
    if (percent === 0) return '#cbd5e1'; 
    if (percent < 0.2) return '#fef08a';
    if (percent < 0.4) return '#fde047';
    if (percent < 0.6) return '#f59e0b';
    if (percent < 0.8) return '#ea580c';
    return '#be123c';
}

function formatBRL(v) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function formatPct(v) { return (v * 100).toFixed(2).replace('.', ',') + '%'; }


function calcularViewBox(paths) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const re = /-?\d+(?:\.\d+)?/g;
    for (const p of paths) {
        if(!p.d) continue;
        const nums = p.d.match(re)?.map(Number) ?? [];
        for (let i = 0; i + 1 < nums.length; i += 2) {
            const x = nums[i], y = nums[i + 1];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }
    if (minX === Infinity) return '0 0 1000 341'; // fallback
    const padX = (maxX - minX) * 0.05;
    const padY = (maxY - minY) * 0.05;
    return `${minX - padX} ${minY - padY} ${(maxX - minX) + padX*2} ${(maxY - minY) + padY*2}`;
}

// Dados reais por cidade (resposta de /api/analise-motorista-dados). Guarda para quando a malha terminar de carregar.
function aplicarCidadesTelemetria(cidades) {
    window._ultimasCidadesTelemetria = cidades;
    if (!municipiosGeo) return;
    devolucoesCidades = municipiosGeo.map(m => {
        const c = cidades.find(x => String(x.IBGE || x.ibge) === String(m.ibge));
        const devolvido = c ? Number(c.DEVOLVIDO || c.devolvido) || 0 : 0;
        const faturado = c ? Number(c.FATURAMENTO || c.faturamento || c.FATURADO || c.faturado) || 0 : 0;
        return {
            ibge: m.ibge,
            nome: m.nome,
            isRmr: RMR_CIDADES.includes(normalizarNome(m.nome)),
            faturado,
            devolvido,
            taxa: faturado > 0 ? Math.min(1, devolvido / faturado) : 0
        };
    });
    desenharMapaSVG();
}

function desenharMapaSVG() {
    if (!municipiosGeo) return;
    
    const container = document.getElementById('mapa-svg-container');
    const rankingLista = document.getElementById('lista-cidades-ranking');
    let dadosFiltrados = devolucoesCidades;
    let paths = municipiosGeo;
    let viewBox = '0 0 1000 341';
    
    if (estadoVisao === 'RMR') {
        paths = municipiosGeo.filter(m => RMR_CIDADES.includes(normalizarNome(m.nome)));
        dadosFiltrados = devolucoesCidades.filter(c => c.isRmr);
        viewBox = calcularViewBox(paths);
    }
    
    const teto = Math.max(...dadosFiltrados.map(d => estadoMetrica === 'valor' ? d.devolvido : d.taxa));
    
    let svgInner = paths.map(m => {
        const dados = devolucoesCidades.find(d => d.ibge === m.ibge);
        const val = dados ? (estadoMetrica === 'valor' ? dados.devolvido : dados.taxa) : 0;
        const color = val > 0 ? getCorRampa(val / (teto || 1)) : '#cbd5e1';
        return `<path d="${m.d}" fill="${color}" stroke="#64748b" stroke-width="${estadoVisao==='RMR'?0.25:0.5}" 
                class="map-path cursor-pointer transition-colors hover:opacity-80"
                data-ibge="${m.ibge}" data-nome="${String(m.nome).replace(/"/g, '&quot;')}"
                onclick="abrirDevolucoesCidade(this.dataset.ibge, this.dataset.nome)"
                onmousemove="showTooltip(event, this.dataset.nome, ${dados?.devolvido||0}, ${dados?.taxa||0}, ${dados?.faturado||0})"
                onmouseleave="hideTooltip()"
            ></path>`;
    }).join('');
    
    const svgHTML = `
        <svg viewBox="${viewBox}" class="w-full h-full p-4" style="filter: drop-shadow(0 4px 3px rgb(0 0 0 / 0.07));">
            ${svgInner}
        </svg>
    `;
    
    const tooltipElement = document.getElementById('mapa-tooltip');
    container.innerHTML = svgHTML;
    container.appendChild(tooltipElement);
    
    // Titulo Ranking
    document.getElementById('titulo-ranking-mapa').innerText = estadoMetrica === 'valor' ? 'Maiores Volumes (R$)' : 'Maiores Taxas (%)';
    
    dadosFiltrados.sort((a, b) => {
        const vA = estadoMetrica === 'valor' ? a.devolvido : a.taxa;
        const vB = estadoMetrica === 'valor' ? b.devolvido : b.taxa;
        return vB - vA;
    });
    
    const topRanking = dadosFiltrados.filter(d => (estadoMetrica === 'valor' ? d.devolvido : d.taxa) > 0).slice(0, 10);
    if (topRanking.length === 0) {
        rankingLista.innerHTML = '<li class="text-sm text-slate-400 py-4 text-center">Sem dados no período.</li>';
    } else {
        rankingLista.innerHTML = topRanking.map(c => `
            <li class="flex justify-between items-center py-2 px-1 hover:bg-slate-50 cursor-pointer" title="Ver devoluções de ${String(c.nome).replace(/"/g, '&quot;')}"
                data-ibge="${c.ibge}" data-nome="${String(c.nome).replace(/"/g, '&quot;')}" onclick="abrirDevolucoesCidade(this.dataset.ibge, this.dataset.nome)">
                <span class="text-[11px] text-[#141a4d] truncate font-semibold">${c.nome}</span>
                <span class="text-[11px] text-rose-600 font-bold tabular-nums">${estadoMetrica === 'valor' ? formatBRL(c.devolvido) : formatPct(c.taxa)}</span>
            </li>
        `).join('');
    }
}

window.showTooltip = function(e, cidade, devolvido, taxa, faturado) {
    const tooltip = document.getElementById('mapa-tooltip');
    if (!tooltip) return;
    
    document.getElementById('tooltip-cidade').innerText = cidade;
    document.getElementById('tooltip-dados').innerText = `devolvido ${formatBRL(devolvido)} · taxa ${formatPct(taxa)}`;
    document.getElementById('tooltip-faturado').innerText = `faturado ${formatBRL(faturado)}`;
    
    tooltip.classList.remove('hidden');
    
    const containerElem = document.getElementById('mapa-svg-container');
    const containerRect = containerElem.getBoundingClientRect();
    
    let x = e.clientX - containerRect.left + 15;
    let y = e.clientY - containerRect.top + 15;
    
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    
    if (x + tooltipWidth > containerRect.width) {
        x = e.clientX - containerRect.left - tooltipWidth - 15;
    }
    if (y + tooltipHeight > containerRect.height) {
        y = e.clientY - containerRect.top - tooltipHeight - 15;
    }
    
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
};

window.hideTooltip = function() {
    const tooltip = document.getElementById('mapa-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
};

// ==================== FILTROS DE COMPRADOR ==================== //
// Os nomes vêm do servidor (config local, fora do Git); antes do login a chamada falha e tenta de novo ao abrir o filtro.
let compradoresCarregados = false;
async function carregarCompradores() {
    if (compradoresCarregados) return;
    try {
        const r = await fetch('/api/compradores');
        if (!r.ok) return;
        const lista = await r.json();
        ['filtro-comprador', 'filtro-comprador-comercial'].forEach(id => {
            const sel = document.getElementById(id);
            if (!sel) return;
            const atual = sel.value;
            lista.forEach(c => sel.add(new Option(c.nome, c.id)));
            sel.value = atual;
        });
        compradoresCarregados = true;
    } catch (e) { /* tenta de novo no próximo foco */ }
}
document.addEventListener('DOMContentLoaded', () => {
    carregarCompradores();
    ['filtro-comprador', 'filtro-comprador-comercial'].forEach(id =>
        document.getElementById(id)?.addEventListener('focus', carregarCompradores));
});

// ==================== MODO TV ==================== //
document.addEventListener('DOMContentLoaded', () => {
    // Injeta CSS do Modo TV
    const style = document.createElement('style');
    style.innerHTML = `
        .tv-mode-active {
            background-color: #0f172a !important; /* slate-900 */
            color: #f8fafc !important;
            padding: 2rem !important;
        }
        .tv-mode-active .bg-white {
            background-color: #1e293b !important; /* slate-800 */
            border-color: #334155 !important; /* slate-700 */
        }
        .tv-mode-active .text-slate-800, 
        .tv-mode-active .text-slate-900, 
        .tv-mode-active .text-[#2A2C65] {
            color: #f1f5f9 !important; /* slate-100 */
        }
        .tv-mode-active .text-slate-500, 
        .tv-mode-active .text-slate-400 {
            color: #94a3b8 !important; /* slate-400 */
        }
        /* Ocultar filtros no modo TV para dar espaco aos dados */
        .tv-mode-active > section:first-of-type {
            display: none !important;
        }
    `;
    document.head.appendChild(style);

    const btnTv = document.getElementById('btn-modo-tv');
    if (btnTv) {
        btnTv.addEventListener('click', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                const elem = document.getElementById('conteudo-telemetria');
                if (elem.requestFullscreen) elem.requestFullscreen();
            }
        });
        
        document.addEventListener('fullscreenchange', () => {
            const elem = document.getElementById('conteudo-telemetria');
            if (document.fullscreenElement) {
                elem.classList.add('tv-mode-active');
            } else {
                elem.classList.remove('tv-mode-active');
            }
        });
    }
});

  document.getElementById('btn-filtrar-motorista')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (btn) {
          const originalHtml = btn.innerHTML;
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analisando...';
          btn.disabled = true;
          
          setTimeout(() => {
              atualizarDadosMotorista();
              btn.innerHTML = originalHtml;
              btn.disabled = false;
          }, 600);
      }
  });

  function atualizarDadosMotorista() {
      const motorista = document.getElementById('filtro-motorista-analise')?.value || 'TODOS';
      const dataInicio = document.getElementById('data-inicio-telemetria')?.value || '';
      const dataFim = document.getElementById('data-fim-telemetria')?.value || '';
      
      const url = `/api/analise-motorista-dados?data_inicio=${dataInicio}&data_fim=${dataFim}&motorista=${encodeURIComponent(motorista)}`;
      marcarIndicadores(KPIS_TELEMETRIA, 'carregando');
      fetch(url)
          .then(res => res.json())
          .then(data => {
              marcarIndicadores(KPIS_TELEMETRIA, 'pronto');
              if(data && data.kpis) {
                    const entregasRealizadas = Math.floor(data.kpis.entregas_realizadas || 0);
                      const devolvidasQtd = data.kpis.total_notas_devolvidas !== undefined ? data.kpis.total_notas_devolvidas : 0;
                      
                      const kpiTotal = document.getElementById('kpi-qtd-devolucoes');
                      if(kpiTotal) kpiTotal.innerText = devolvidasQtd.toLocaleString('pt-BR');
                      
                      const kpiRealizadas = document.getElementById('kpi-entregas-qtd');
                      if(kpiRealizadas) kpiRealizadas.innerText = entregasRealizadas.toLocaleString('pt-BR');
                      
                      const badgeRealizadas = kpiRealizadas ? document.getElementById('kpi-entregas-pct') : null;
                      if (badgeRealizadas) {
                          if (entregasRealizadas > 0) {
                              const sucessoPct = Math.round(((entregasRealizadas - devolvidasQtd) / entregasRealizadas) * 100);
                              badgeRealizadas.innerText = sucessoPct + '% de sucesso';
                          } else {
                              badgeRealizadas.innerText = '100% de sucesso';
                          }
                      }
                      const totalEntregasGeral = entregasRealizadas;
                    
                    
                      // Telemetria real do Siga+ (hodômetro coletado pelo backend). Sem dado, mostra "—", nunca estimativa.
                      const tel = data.telemetria_siga || {};
                      const fmtData = iso => iso ? iso.split('-').reverse().join('/') : '';

                    // Diesel estimado: km de cada placa no Siga+ ÷ consumo médio do tipo de caminhão × preço do litro
                    const comb = data.combustivel;
                    const kpiGasto = document.getElementById('kpi-combustivel');
                    const kpiPctCombustivel = document.getElementById('kpi-pct-combustivel');
                    if (comb && comb.gasto_total > 0) {
                        if (kpiGasto) {
                            kpiGasto.innerText = formatarBRL(comb.gasto_total);
                            kpiGasto.title = comb.por_tipo.map(t => `${t.tipo}: ${formatarBRL(t.gasto)} · ${Math.round(t.km).toLocaleString('pt-BR')} km · ${Math.round(t.litros).toLocaleString('pt-BR')} L`).join('\n')
                                + (comb.placas_sem_tipo.length ? `\n${comb.placas_sem_tipo.length} placa(s) fora da planilha não entram na conta` : '');
                        }
                        const fatLiq = Number(data.kpis.faturamento_liquido || 0);
                        if (kpiPctCombustivel) kpiPctCombustivel.innerText = fatLiq > 0
                            ? `${(comb.gasto_total / fatLiq * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do faturamento`
                            : `${Math.round(comb.litros_total).toLocaleString('pt-BR')} L a R$ ${comb.preco_litro.toLocaleString('pt-BR')}`;
                    } else {
                        if (kpiGasto) kpiGasto.innerText = '—';
                        if (kpiPctCombustivel) kpiPctCombustivel.innerText = 'Sem km do Siga+ no período';
                    }

                    const kpiKm = document.getElementById('kpi-km-rodados');
                    const kpiSubKm = document.getElementById('kpi-sub-km-rodados');
                    if (data.kpis.km_total_siga !== null && data.kpis.km_total_siga !== undefined) {
                        if(kpiKm) kpiKm.innerText = Math.round(data.kpis.km_total_siga).toLocaleString('pt-BR') + ' km';
                        const avisoHistorico = tel.historico_pendente ? ' · baixando histórico do Siga+'
                            : (tel.periodo_coberto ? '' : ` · dados desde ${fmtData(tel.inicio_coleta)}`);
                        if (kpiSubKm) kpiSubKm.innerText = `${tel.veiculos_com_km} veículos` + avisoHistorico;
                    } else {
                        if(kpiKm) kpiKm.innerText = '—';
                        if (kpiSubKm) kpiSubKm.innerText = tel.historico_pendente ? 'Baixando histórico do Siga+' : (tel.inicio_coleta ? `Dados desde ${fmtData(tel.inicio_coleta)}` : 'Coleta do Siga+ iniciando');
                    }
                      
                      const pctDevolucoes = entregasRealizadas > 0 ? ((devolvidasQtd / entregasRealizadas) * 100).toFixed(1) : 0;
                      const kpiPctDevolucoes = document.getElementById('kpi-pct-devolucoes');
                      if (kpiPctDevolucoes) kpiPctDevolucoes.innerText = pctDevolucoes + '% das entregas';

                      // Clientes positivados: mesma regra da rotina 111 do WinThor (NF de venda emitida no período)
                      const clientesAtendidos = Math.floor(data.kpis.clientes_positivados ?? data.kpis.clientes_atendidos ?? 0);
                      const clientesDevolveram = Math.floor(data.kpis.clientes_devolveram || 0);

                      const kpiCliAtendidos = document.getElementById('kpi-clientes-atendidos');
                      if(kpiCliAtendidos) kpiCliAtendidos.innerText = clientesAtendidos.toLocaleString('pt-BR');

                      const kpiCliDevolveram = document.getElementById('kpi-clientes-devolveram');
                      if(kpiCliDevolveram) kpiCliDevolveram.innerText = clientesDevolveram.toLocaleString('pt-BR');

                      const kpiPctCliDevolveram = document.getElementById('kpi-pct-clientes-devolveram');
                      if (kpiPctCliDevolveram) {
                          const pctCli = clientesAtendidos > 0 ? ((clientesDevolveram / clientesAtendidos) * 100).toFixed(1) : 0;
                          kpiPctCliDevolveram.innerText = pctCli + '% dos clientes';
                      }
                }
                

                const ctxFrota = document.getElementById('graficoFrotaSiga');
                if (ctxFrota) {
                    if (chartFrotaSiga) { chartFrotaSiga.destroy(); chartFrotaSiga = null; }
                    const frota = data.frota_siga || [];
                    const statusFrota = document.getElementById('frota-siga-status');
                    const resumoFrota = (data.telemetria_siga || {}).frota;
                    if (statusFrota) {
                        statusFrota.innerText = resumoFrota
                            ? `${resumoFrota.comunicando_ultimas_horas} de ${resumoFrota.veiculos_cadastrados} rastreadores comunicaram nas últimas ${resumoFrota.janela_horas}h · ${resumoFrota.em_movimento} em movimento`
                            : 'Siga+ indisponível no momento';
                    }
                    if (frota.length > 0) {
                        chartFrotaSiga = new Chart(ctxFrota, {
                            type: 'bar',
                            data: {
                                labels: frota.map(f => f.placa),
                                datasets: [{ label: 'KM rodados (hodômetro Siga+)', data: frota.map(f => f.km), backgroundColor: '#3b82f6' }]
                            },
                            options: {
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: { legend: { position: 'top' } },
                                scales: { y: { title: { display: true, text: 'Quilometragem (KM)' } } }
                            }
                        });
                    }
                    document.getElementById('frota-siga-vazio')?.classList.toggle('hidden', frota.length > 0);
                }

                // Gasto de diesel por tipo de veículo (mesmo filtro de período e motorista do gráfico de KM)
                const ctxGastoTipo = document.getElementById('graficoGastoTipo');
                if (ctxGastoTipo) {
                    if (chartGastoTipo) { chartGastoTipo.destroy(); chartGastoTipo = null; }
                    const comb = data.combustivel;
                    const tipos = (comb && comb.por_tipo) || [];
                    const statusGasto = document.getElementById('gasto-tipo-status');
                    if (statusGasto) {
                        statusGasto.innerText = comb && comb.gasto_total > 0
                            ? `Total ${formatarBRL(comb.gasto_total)} · ${Math.round(comb.litros_total).toLocaleString('pt-BR')} L a R$ ${comb.preco_litro.toLocaleString('pt-BR')}/L`
                                + (comb.placas_sem_tipo.length ? ` · ${comb.placas_sem_tipo.length} placa(s) fora da planilha da frota não entram` : '')
                            : '';
                    }
                    if (tipos.length > 0) {
                        chartGastoTipo = new Chart(ctxGastoTipo, {
                            type: 'bar',
                            data: {
                                labels: tipos.map(t => t.tipo),
                                datasets: [{ label: 'Gasto estimado com diesel (R$)', data: tipos.map(t => t.gasto), backgroundColor: '#ef4444', borderRadius: 4 }]
                            },
                            options: {
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: {
                                    legend: { position: 'top' },
                                    tooltip: {
                                        callbacks: {
                                            label: ctx => {
                                                const t = tipos[ctx.dataIndex];
                                                return [
                                                    `Gasto: ${formatarBRL(t.gasto)}`,
                                                    `${Math.round(t.km).toLocaleString('pt-BR')} km · ${Math.round(t.litros).toLocaleString('pt-BR')} L`,
                                                    `${t.veiculos} veículo(s)`
                                                ];
                                            }
                                        }
                                    }
                                },
                                scales: { y: { beginAtZero: true, ticks: { callback: v => formatarBRL(v) } } }
                            }
                        });
                    }
                    document.getElementById('gasto-tipo-vazio')?.classList.toggle('hidden', tipos.length > 0);
                }

                // Atualizar Cidades (Mapa) com Dados Reais
              if (data.cidades) aplicarCidadesTelemetria(data.cidades);
                
                if (chartDevValor && chartDevPeso && (data.dias_semana || data.dias_semana_fat || data.dias_semana_mov)) {
                    const idxToDay = {'2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5}; // 2=Seg, 7=Sáb
                    
                    const processarListaDias = (lista) => {
                        let numVal = [0, 0, 0, 0, 0, 0];
                        let numPes = [0, 0, 0, 0, 0, 0];
                        let totVal = 0;
                        let totPes = 0;
                        (lista || []).forEach(d => {
                            let idx = idxToDay[String(d.DIA_SEMANA || d.dia_semana)];
                            if (idx !== undefined) {
                                let val = Number(d.VLDEVOLUCAO || d.vldevolucao || 0);
                                let pes = Number(d.PESODEVOLUCAO || d.pesodevolucao || 0);
                                numVal[idx] = val;
                                numPes[idx] = pes;
                                totVal += val;
                                totPes += pes;
                            }
                        });
                        let pctVal = numVal.map(v => totVal > 0 ? Number(((v / totVal) * 100).toFixed(1)) : 0);
                        let pctPes = numPes.map(p => totPes > 0 ? Number(((p / totPes) * 100).toFixed(1)) : 0);
                        return { numVal, pctVal, numPes, pctPes };
                    };
                    
                    const fatRes = processarListaDias(data.dias_semana_fat || data.dias_semana || []);
                    const movRes = processarListaDias(data.dias_semana_mov || []);
                    
                    chartDevValor.dadosFat = { num: fatRes.numVal, pct: fatRes.pctVal };
                    chartDevValor.dadosMov = { num: movRes.numVal, pct: movRes.pctVal };
                    
                    chartDevPeso.dadosFat = { num: fatRes.numPes, pct: fatRes.pctPes };
                    chartDevPeso.dadosMov = { num: movRes.numPes, pct: movRes.pctPes };
                    
                    // Aplica ao gráfico de Valor de acordo com o toggle selecionado
                    const origemVal = window.chartOrigem?.valor || 'fat';
                    const dadosVal = origemVal === 'fat' ? chartDevValor.dadosFat : chartDevValor.dadosMov;
                    chartDevValor.originalDataNum = dadosVal.num;
                    chartDevValor.originalDataPct = dadosVal.pct;
                    const isPctValor = document.getElementById('btn-toggle-val-pct')?.classList.contains('bg-white');
                    chartDevValor.data.datasets[0].data = isPctValor ? chartDevValor.originalDataPct : chartDevValor.originalDataNum;
                    chartDevValor.update();
                    
                    // Aplica ao gráfico de Peso de acordo com o toggle selecionado
                    const origemPes = window.chartOrigem?.peso || 'fat';
                    const dadosPes = origemPes === 'fat' ? chartDevPeso.dadosFat : chartDevPeso.dadosMov;
                    chartDevPeso.originalDataNum = dadosPes.num;
                    chartDevPeso.originalDataPct = dadosPes.pct;
                    const isPctPeso = document.getElementById('btn-toggle-peso-pct')?.classList.contains('bg-white');
                    chartDevPeso.data.datasets[0].data = isPctPeso ? chartDevPeso.originalDataPct : chartDevPeso.originalDataNum;
                    chartDevPeso.update();
                }

                // Atualizar Tabela de Rotas se existir a funcao
              if (typeof preencherTabelaRotas === 'function') {
                  preencherTabelaRotas(data.rotas);
              }
          })
          .catch(err => {
              console.error("Erro ao analisar motorista:", err);
              marcarIndicadores(KPIS_TELEMETRIA, 'erro');
          });
  }

    
    // Auto-update Cortes tab when filters change
    ['data-inicio', 'data-fim', 'filtro-area-cortes'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            const btn = document.getElementById('btn-filtrar-cortes');
            if (btn) btn.click();
            else if (typeof filtrarDados === 'function') filtrarDados();
        });
    });

    
    // Auto-update Excesso tab when filters change
    ['data-inicio-excesso', 'data-fim-excesso', 'filtro-departamento-excesso', 'filtro-comprador-excesso'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            const btn = document.getElementById('btn-filtrar-excesso');
            if (btn) btn.click();
            else if (typeof filtrarDadosExcesso === 'function') filtrarDadosExcesso();
        });
    });

    // Auto-update Comercial tab when filters change
    ['data-inicio-comercial', 'data-fim-comercial', 'filtro-comprador-comercial'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            const btn = document.getElementById('btn-filtrar-comercial');
            if (btn) btn.click();
            else if (typeof filtrarDadosComercial === 'function') filtrarDadosComercial();
        });
    });

    // Auto-update map when filters change
    ['filtro-motorista-analise', 'data-inicio-telemetria', 'data-fim-telemetria'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            const btn = document.getElementById('btn-filtrar-motorista');
            if (btn) btn.click();
            else atualizarDadosMotorista();
        });
    });

// ==================== EXCESSO: TABELAS ABERTAS PELOS CARDS ====================
// Mesmas tabelas dos botões de exportar (Excesso, ISV >45d, Ruptura), exibidas na própria aba.
const TABELAS_ESTOQUE = {
    excesso: {
        titulo: 'Capital em excesso por produto',
        exportar: 'excesso',
        filtroInicial: r => Number(r.VALOR_EXCESSO) > 0,
        resumo: (linhas) => `${linhas.length.toLocaleString('pt-BR')} produtos acima do estoque ideal de 60 dias · ${formatarBRL(linhas.reduce((s, r) => s + Number(r.VALOR_EXCESSO || 0), 0))} em excesso`,
        ordem: 'VALOR_EXCESSO',
        colunas: [
            ['PRODUTO', 'Produto', 'texto'], ['VALOR_EXCESSO', 'Valor em excesso', 'moeda'], ['QTD_EXCESSO', 'Excesso', 'qtd'],
            ['QTD_ESTOQUE', 'Estoque', 'qtd'], ['QTD_IDEAL', 'Ideal (60 dias)', 'qtd'],
            ['FORNECEDOR', 'Fornecedor', 'texto'], ['COMPRADOR', 'Comprador', 'texto']
        ]
    },
    obsoletos: {
        titulo: 'Produtos obsoletos (sem venda há mais de 45 dias)',
        exportar: 'isv',
        resumo: (linhas) => `${linhas.length.toLocaleString('pt-BR')} produtos com estoque, sem venda há mais de 45 dias e com a última entrada há mais de 30 dias · ${formatarBRL(linhas.reduce((s, r) => s + Number(r.QUANTIDADE_GERAL || 0) * Number(r.PRECO_CUSTO || 0), 0))} parados a preço de custo`,
        ordem: 'DIAS_SEM_VENDA',
        colunas: [
            ['PRODUTO', 'Produto', 'texto'], ['DIAS_SEM_VENDA', 'Dias sem venda', 'dias'], ['DATA_ULTIMA_SAIDA', 'Última venda', 'data'],
            ['DATA_ULTIMA_ENTRADA', 'Última entrada', 'data'], ['QUANTIDADE_GERAL', 'Estoque', 'qtd'], ['VALOR_PARADO_CUSTO', 'Parado (custo)', 'moeda'],
            ['VALOR_ESTOQUE_VENDA', 'Parado (venda)', 'moeda'], ['QUANTIDADE_DISPONIVEL', 'Disponível', 'qtd'], ['QUANTIDADE_AVARIA', 'Avaria', 'qtd'],
            ['FORNECEDOR', 'Fornecedor', 'texto'], ['COMPRADOR', 'Comprador', 'texto']
        ],
        derivar: r => ({ ...r, VALOR_PARADO_CUSTO: Number(r.QUANTIDADE_GERAL || 0) * Number(r.PRECO_CUSTO || 0) })
    },
    ruptura: {
        titulo: 'SKUs em ruptura e cobertura de estoque',
        exportar: 'ruptura',
        campoSituacao: 'SITUACAO',
        situacaoInicial: 'RUPTURA (Zerado)',
        resumo: (linhas) => `${linhas.length.toLocaleString('pt-BR')} SKUs · ${formatarBRL(linhas.reduce((s, r) => s + Number(r.PERDA_COMERCIAL || 0), 0))} de perda comercial estimada por mês`,
        ordem: 'PERDA_COMERCIAL',
        colunas: [
            ['PRODUTO', 'Produto', 'texto'], ['SITUACAO', 'Situação', 'texto'], ['PERDA_COMERCIAL', 'Perda comercial/mês', 'moeda'],
            ['QUANTIDADE_GERAL', 'Estoque', 'qtd'], ['DIAS_DURA_ESTOQUE', 'Dura (dias)', 'qtd'], ['QUANTIDADE_RESERVADA', 'Reservado', 'qtd'],
            ['DATA_ULTIMA_SAIDA', 'Última venda', 'data'], ['DATA_ULTIMA_ENTRADA', 'Última entrada', 'data'],
            ['FORNECEDOR', 'Fornecedor', 'texto'], ['COMPRADOR', 'Comprador', 'texto']
        ]
    }
};
const LIMITE_LINHAS_TABELA = 500;
let tabelaEstoque = { tipo: null, linhas: [], coluna: null, asc: false };

window.abrirTabelaEstoque = async function(tipo) {
    const cfg = TABELAS_ESTOQUE[tipo];
    const secao = document.getElementById('excesso-tabela-detalhe');
    if (!cfg || !secao) return;
    tabelaEstoque = { tipo, linhas: [], coluna: cfg.ordem, asc: false, carregando: true };
    secao.classList.remove('hidden');
    secao.classList.add('flex');
    document.getElementById('excesso-tabela-titulo').innerText = cfg.titulo;
    document.getElementById('excesso-tabela-busca').value = '';
    document.getElementById('excesso-tabela-baixar').onclick = () => {
        window.location.href = `/api/exportar-${cfg.exportar}?comprador=${document.getElementById('filtro-comprador')?.value || 'TODOS'}`;
    };
    renderizarTabelaEstoque();
    secao.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const comprador = document.getElementById('filtro-comprador')?.value || 'TODOS';
    try {
        const res = await fetch(`/api/tabela-estoque?tipo=${tipo}&comprador=${encodeURIComponent(comprador)}`);
        const dados = await res.json();
        if (tabelaEstoque.tipo !== tipo) return;
        if (dados.status !== 'ok') throw new Error(dados.message || 'Falha ao carregar a tabela');
        let linhas = dados.linhas || [];
        if (cfg.derivar) linhas = linhas.map(cfg.derivar);
        if (cfg.filtroInicial) linhas = linhas.filter(cfg.filtroInicial);
        tabelaEstoque.linhas = linhas;
        tabelaEstoque.carregando = false;
        montarFiltroSituacao(cfg, linhas);
    } catch (e) {
        tabelaEstoque.carregando = false;
        tabelaEstoque.erro = e.message;
    }
    renderizarTabelaEstoque();
};

window.fecharTabelaEstoque = function() {
    const secao = document.getElementById('excesso-tabela-detalhe');
    secao?.classList.add('hidden');
    secao?.classList.remove('flex');
    tabelaEstoque = { tipo: null, linhas: [], coluna: null, asc: false };
};

function montarFiltroSituacao(cfg, linhas) {
    const sel = document.getElementById('excesso-tabela-situacao');
    if (!sel) return;
    if (!cfg.campoSituacao) {
        sel.classList.add('hidden');
        sel.innerHTML = '';
        return;
    }
    const situacoes = [...new Set(linhas.map(r => r[cfg.campoSituacao]).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Todas as situações</option>' + situacoes.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
    sel.value = situacoes.includes(cfg.situacaoInicial) ? cfg.situacaoInicial : '';
    sel.classList.remove('hidden');
}

window.ordenarTabelaEstoque = function(coluna) {
    tabelaEstoque.asc = tabelaEstoque.coluna === coluna ? !tabelaEstoque.asc : false;
    tabelaEstoque.coluna = coluna;
    renderizarTabelaEstoque();
};

function formatarCelulaEstoque(valor, tipo) {
    if (valor === null || valor === undefined || valor === '') return '<span class="text-slate-300">—</span>';
    if (tipo === 'moeda') return formatarBRL(Number(valor));
    if (tipo === 'qtd') return Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    if (tipo === 'dias') return Number(valor).toLocaleString('pt-BR') + ' dias';
    return escHtml(valor);
}

function valorOrdenavel(r, coluna, tipo) {
    const v = r[coluna];
    if (tipo === 'data') return v ? String(v).slice(6) + String(v).slice(3, 5) + String(v).slice(0, 2) : '';
    if (tipo === 'texto') return String(v || '').toLowerCase();
    return Number(v || 0);
}

window.renderizarTabelaEstoque = function() {
    const cfg = TABELAS_ESTOQUE[tabelaEstoque.tipo];
    const tabela = document.getElementById('excesso-tabela');
    if (!cfg || !tabela) return;
    const cabecalho = tabela.querySelector('thead');
    const corpo = tabela.querySelector('tbody');
    const rodape = document.getElementById('excesso-tabela-rodape');
    const resumo = document.getElementById('excesso-tabela-resumo');

    cabecalho.innerHTML = '<tr>' + cfg.colunas.map(([campo, rotulo, tipo]) => {
        const ativa = tabelaEstoque.coluna === campo;
        const seta = ativa ? (tabelaEstoque.asc ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short') : 'fa-sort text-slate-300';
        const alinhar = ['moeda', 'qtd', 'dias'].includes(tipo) ? 'text-right' : '';
        return `<th class="${alinhar} cursor-pointer select-none" onclick="ordenarTabelaEstoque('${campo}')" aria-sort="${ativa ? (tabelaEstoque.asc ? 'ascending' : 'descending') : 'none'}">${rotulo} <i class="fa-solid ${seta} ml-1 text-[10px]" aria-hidden="true"></i></th>`;
    }).join('') + '</tr>';

    if (tabelaEstoque.carregando) {
        corpo.innerHTML = `<tr><td colspan="${cfg.colunas.length}" class="text-center py-10 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2" aria-hidden="true"></i>Carregando tabela do WinThor...</td></tr>`;
        resumo.innerText = '';
        rodape.innerText = '';
        return;
    }
    if (tabelaEstoque.erro) {
        corpo.innerHTML = `<tr><td colspan="${cfg.colunas.length}" class="text-center py-8 text-rose-600">Erro ao carregar: ${escHtml(tabelaEstoque.erro)}</td></tr>`;
        return;
    }

    const busca = (document.getElementById('excesso-tabela-busca')?.value || '').toLowerCase().trim();
    const situacao = cfg.campoSituacao ? document.getElementById('excesso-tabela-situacao')?.value : '';
    let linhas = tabelaEstoque.linhas.filter(r =>
        (!situacao || r[cfg.campoSituacao] === situacao) &&
        (!busca || `${r.PRODUTO || ''} ${r.FORNECEDOR || ''} ${r.COMPRADOR || ''}`.toLowerCase().includes(busca)));
    const tipoColuna = (cfg.colunas.find(c => c[0] === tabelaEstoque.coluna) || [])[2];
    linhas = linhas.slice().sort((a, b) => {
        const va = valorOrdenavel(a, tabelaEstoque.coluna, tipoColuna), vb = valorOrdenavel(b, tabelaEstoque.coluna, tipoColuna);
        return (va < vb ? -1 : va > vb ? 1 : 0) * (tabelaEstoque.asc ? 1 : -1);
    });

    resumo.innerText = cfg.resumo(linhas);
    corpo.innerHTML = linhas.length === 0
        ? `<tr><td colspan="${cfg.colunas.length}" class="text-center py-8 text-slate-400">Nenhum produto com esses filtros.</td></tr>`
        : linhas.slice(0, LIMITE_LINHAS_TABELA).map(r => '<tr>' + cfg.colunas.map(([campo, , tipo]) =>
            `<td class="${['moeda', 'qtd', 'dias'].includes(tipo) ? 'text-right' : ''} ${campo === 'PRODUTO' ? 'font-semibold text-[#141a4d] max-w-[320px] truncate' : ''} ${campo === 'FORNECEDOR' ? 'max-w-[260px] truncate' : ''}" ${['PRODUTO', 'FORNECEDOR'].includes(campo) ? `title="${escHtml(r[campo])}"` : ''}>${formatarCelulaEstoque(r[campo], tipo)}</td>`
        ).join('') + '</tr>').join('');
    rodape.innerText = linhas.length > LIMITE_LINHAS_TABELA
        ? `Mostrando os primeiros ${LIMITE_LINHAS_TABELA.toLocaleString('pt-BR')} de ${linhas.length.toLocaleString('pt-BR')}. Use a busca, a ordenação ou baixe a planilha completa.`
        : '';
};

// Cards do Excesso que abrem tabelas (clique ou Enter/Espaço no teclado)
document.addEventListener('click', e => {
    const card = e.target.closest('[data-tabela-estoque]');
    if (card) abrirTabelaEstoque(card.dataset.tabelaEstoque);
});
document.addEventListener('keydown', e => {
    const card = e.target.closest && e.target.closest('[data-tabela-estoque]');
    if (card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        abrirTabelaEstoque(card.dataset.tabelaEstoque);
    }
});
