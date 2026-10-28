// Frontend/js/plataforma_integrada.js
// Lógica para os módulos integrados da nova plataforma:
// - Pedidos a Faturar
// - Consulta de Pedidos (335 turbinada) + Drill-down de itens + DANFE
// - Devoluções Detalhadas (por setor, motivo, cliente, vendedor, motorista)
// - Painel TV
// - Dashboard (Visão Geral)

// A API exige login: um 401 (sessão expirada) volta para a tela de login, e um 403 avisa que o perfil é só leitura.
// Chamadas que falharam por falta de sessão são refeitas com um reload logo após o login.
window.__sessaoExpirada = false;
(function interceptarRespostasApi() {
    const fetchOriginal = window.fetch.bind(window);
    let avisouSomenteLeitura = false;
    window.fetch = async (input, init) => {
        const res = await fetchOriginal(input, init);
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.includes('/api/') && !url.includes('/api/auth/')) {
            if (res.status === 401) {
                window.__sessaoExpirada = true;
                localStorage.removeItem('usuario_logado');
                const telaLogin = document.getElementById('tela-login-dia');
                if (telaLogin) telaLogin.style.display = 'flex';
            } else if (res.status === 403 && !avisouSomenteLeitura) {
                avisouSomenteLeitura = true;
                alert('Seu perfil é somente leitura: alterações não são permitidas.');
            }
        }
        return res;
    };
})();

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v) => Number(v || 0).toLocaleString('pt-BR');
const fmtKg = (v) => `${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`;

function tempoParadoFmt(horas) {
    const h = Math.floor(Number(horas || 0));
    if (h < 24) return `${h}h`;
    const dias = Math.floor(h / 24);
    const resto = h % 24;
    return resto ? `${dias}d ${resto}h` : `${dias}d`;
}

// =============================================================================
// 1. PEDIDOS A FATURAR
// =============================================================================
let pedidosFaturarRaw = [];
let pedidosFaturarFiltrados = [];
let sortFaturarCol = 'horas_parado';
let sortFaturarAsc = false;

async function carregarPedidosAFaturar() {
    const tbody = document.getElementById('tbody-pedidos-a-faturar');
    if (!tbody) return;
    
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando pedidos a faturar do WinThor...</td></tr>`;
    
    try {
        const res = await fetch('/api/pedidos-a-faturar');
        const data = await res.json();
        
        if (data.status !== 'ok') {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-red-500 font-medium">Erro ao carregar pedidos: ${data.message}</td></tr>`;
            return;
        }
        
        pedidosFaturarRaw = data.pedidos || [];
        
        // Atualiza timestamp
        const timeEl = document.getElementById('faturar-atualizado-em');
        if (timeEl) timeEl.innerText = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
        
        // Preenche selects de filtro
        preencherFiltrosFaturar(pedidosFaturarRaw);
        
        // Renderiza
        aplicarFiltrosFaturar();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-red-500 font-medium">Falha de conexão: ${err.message}</td></tr>`;
    }
}

function preencherFiltrosFaturar(pedidos) {
    const rcas = [...new Set(pedidos.map(p => p.nome_rca).filter(Boolean))].sort();
    const cidades = [...new Set(pedidos.map(p => p.cidade_cliente).filter(Boolean))].sort();
    
    const selRca = document.getElementById('filtro-faturar-rca');
    if (selRca) {
        selRca.innerHTML = '<option value="">Todos os Vendedores</option>' + rcas.map(r => `<option value="${r}">${r}</option>`).join('');
    }
    
    const selCidade = document.getElementById('filtro-faturar-cidade');
    if (selCidade) {
        selCidade.innerHTML = '<option value="">Todas as Cidades</option>' + cidades.map(c => `<option value="${c}">${c}</option>`).join('');
    }
}

function aplicarFiltrosFaturar() {
    const busca = (document.getElementById('filtro-faturar-busca')?.value || '').toLowerCase().trim();
    const status = document.getElementById('filtro-faturar-status')?.value || '';
    const rca = document.getElementById('filtro-faturar-rca')?.value || '';
    const cidade = document.getElementById('filtro-faturar-cidade')?.value || '';
    
    pedidosFaturarFiltrados = pedidosFaturarRaw.filter(p => {
        if (status && p.status_winthor !== status) return false;
        if (rca && p.nome_rca !== rca) return false;
        if (cidade && p.cidade_cliente !== cidade) return false;
        if (busca) {
            const texto = `${p.numero_pedido} ${p.nome_cliente} ${p.codigo_cliente}`.toLowerCase();
            if (!texto.includes(busca)) return false;
        }
        return true;
    });
    
    // Ordena
    pedidosFaturarFiltrados.sort((a, b) => {
        let va = a[sortFaturarCol];
        let vb = b[sortFaturarCol];
        if (sortFaturarCol === 'valor_pedido' || sortFaturarCol === 'peso_pedido' || sortFaturarCol === 'horas_parado' || sortFaturarCol === 'numero_pedido') {
            va = Number(va || 0);
            vb = Number(vb || 0);
            return sortFaturarAsc ? va - vb : vb - va;
        } else {
            va = String(va || '').toLowerCase();
            vb = String(vb || '').toLowerCase();
            return sortFaturarAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        }
    });
    
    // Atualiza KPIs
    const totalPeds = pedidosFaturarFiltrados.length;
    const totalVal = pedidosFaturarFiltrados.reduce((s, p) => s + Number(p.valor_pedido || 0), 0);
    const totalPeso = pedidosFaturarFiltrados.reduce((s, p) => s + Number(p.peso_pedido || 0), 0);
    const reentregas = pedidosFaturarFiltrados.filter(p => p.reentrega === 'S').length;
    
    document.getElementById('kpi-faturar-pedidos').innerText = fmtNum(totalPeds);
    document.getElementById('kpi-faturar-valor').innerText = fmtBRL(totalVal);
    document.getElementById('kpi-faturar-peso').innerText = fmtKg(totalPeso);
    document.getElementById('kpi-faturar-reentregas').innerText = fmtNum(reentregas);
    
    // Renderiza linhas
    const tbody = document.getElementById('tbody-pedidos-a-faturar');
    if (!tbody) return;
    
    if (pedidosFaturarFiltrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-slate-400">Nenhum pedido pendente com os filtros selecionados.</td></tr>`;
        return;
    }
    
    const limite = 250;
    const exibidos = pedidosFaturarFiltrados.slice(0, limite);
    
    tbody.innerHTML = exibidos.map(p => {
        const isReentrega = p.reentrega === 'S';
        const statusBadge = p.status_winthor === 'L' 
            ? '<span class="bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded text-[11px]">Liberado (L)</span>'
            : '<span class="bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded text-[11px]">Montado (M)</span>';
            
        const reentregaBadge = isReentrega
            ? '<span class="bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded text-[10px] animate-pulse">REENTREGA</span>'
            : '<span class="text-slate-300">—</span>';
            
        return `
            <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
                <td class="font-bold text-[#141a4d]">
                    <a href="javascript:void(0)" onclick="consultarPedidoDireto(${p.numero_pedido})" class="text-blue-600 hover:underline">
                        ${p.numero_pedido}
                    </a>
                </td>
                <td>
                    <div class="font-semibold text-slate-800">${p.nome_cliente || 'Não Informado'}</div>
                    <div class="text-[11px] text-slate-400">Cód: ${p.codigo_cliente}</div>
                </td>
                <td>${p.cidade_cliente || '—'}<span class="text-slate-400 text-xs ml-1">${p.uf_cliente ? '/' + p.uf_cliente : ''}</span></td>
                <td>${p.nome_rca || '—'}</td>
                <td>${p.nome_supervisor || '—'}</td>
                <td class="text-right font-bold text-slate-800">${fmtBRL(p.valor_pedido)}</td>
                <td class="text-right text-slate-600">${fmtKg(p.peso_pedido)}</td>
                <td class="text-right font-semibold ${p.horas_parado > 72 ? 'text-red-600' : 'text-slate-700'}">
                    ${tempoParadoFmt(p.horas_parado)}
                </td>
                <td>${statusBadge}</td>
                <td class="text-center">${reentregaBadge}</td>
            </tr>
        `;
    }).join('');
    
    if (pedidosFaturarFiltrados.length > limite) {
        tbody.innerHTML += `<tr><td colspan="10" class="text-center py-3 bg-amber-50 text-amber-800 text-xs font-semibold">Exibindo os primeiros ${limite} pedidos de ${pedidosFaturarFiltrados.length}. Use os filtros para refinar.</td></tr>`;
    }
}

function ordenarFaturar(col) {
    if (sortFaturarCol === col) {
        sortFaturarAsc = !sortFaturarAsc;
    } else {
        sortFaturarCol = col;
        sortFaturarAsc = (col === 'nome_cliente' || col === 'cidade_cliente' || col === 'nome_rca');
    }
    aplicarFiltrosFaturar();
}

// =============================================================================
// 2. CONSULTA DE PEDIDOS (335 TURBINADA)
// =============================================================================
async function executarConsulta335() {
    const tbody = document.getElementById('tbody-pedidos-consulta');
    if (!tbody) return;
    
    const numped = document.getElementById('filtro-335-numped')?.value.trim();
    const nf = document.getElementById('filtro-335-nf')?.value.trim();
    const numcar = document.getElementById('filtro-335-numcar')?.value.trim();
    const cliente = document.getElementById('filtro-335-cliente')?.value.trim();
    const rca = document.getElementById('filtro-335-rca')?.value.trim();
    const ini = document.getElementById('filtro-335-ini')?.value;
    const fim = document.getElementById('filtro-335-fim')?.value;
    
    // Status checkboxes
    const checkboxes = document.querySelectorAll('input[name="filtro-335-status"]:checked');
    const status = Array.from(checkboxes).map(c => c.value).join(',');
    
    const params = new URLSearchParams();
    if (numped) params.set('numped', numped);
    if (nf) params.set('nf', nf);
    if (numcar) params.set('numcar', numcar);
    if (cliente) params.set('cliente', cliente);
    if (rca) params.set('rca', rca);
    if (ini) params.set('ini', ini);
    if (fim) params.set('fim', fim);
    if (status) params.set('status', status);
    
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-10 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2 text-lg"></i>Consultando WinThor...</td></tr>`;
    
    try {
        const res = await fetch(`/api/pedidos-consulta?${params.toString()}`);
        const data = await res.json();
        
        if (data.status !== 'ok') {
            tbody.innerHTML = `<tr><td colspan="12" class="text-center py-6 text-red-500 font-medium">Erro na consulta: ${data.message}</td></tr>`;
            return;
        }
        
        const pedidos = data.pedidos || [];
        if (pedidos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-slate-400">Nenhum pedido encontrado para os filtros selecionados.</td></tr>`;
            return;
        }
        
        tbody.innerHTML = pedidos.map(p => {
            const temDev = p.tem_dev === 'S';
            const devBadge = temDev 
                ? `<span class="bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded text-[10px]" title="${p.motivo_dev || 'Devolvido'}">SIM (${p.motivo_dev || 'Devolução'})</span>` 
                : `<span class="text-slate-300">Não</span>`;
                
            const danfeBtn = p.nf 
                ? `<button onclick="abrirDanfe(${p.numped})" class="bg-amber-100 text-amber-800 hover:bg-amber-200 px-2 py-0.5 rounded text-[11px] font-semibold transition" title="Visualizar DANFE da NF ${p.nf}"><i class="fa-solid fa-file-invoice mr-1"></i>NF ${p.nf}</button>`
                : `<span class="text-slate-400 text-xs">Sem NF</span>`;
                
            return `
                <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
                    <td class="font-bold text-[#141a4d]">
                        <button onclick="abrirItensPedido(${p.numped})" class="text-blue-600 hover:underline flex items-center gap-1 font-bold">
                            <i class="fa-solid fa-box-open text-xs"></i> ${p.numped}
                        </button>
                    </td>
                    <td class="text-xs text-slate-600">${p.data_pedido || '—'}</td>
                    <td class="text-xs text-slate-500 text-center">${p.dias || 0}d</td>
                    <td>
                        <div class="font-semibold text-slate-800 text-xs">${p.cliente || '—'}</div>
                        <div class="text-[10px] text-slate-400">${p.cidade || ''} ${p.uf ? '/' + p.uf : ''}</div>
                    </td>
                    <td class="text-xs text-slate-700">${p.rca || '—'}</td>
                    <td><span class="px-2 py-0.5 rounded font-bold text-[10px] bg-slate-100 text-slate-700">${p.posicao || '—'}</span></td>
                    <td class="text-xs text-slate-600">${p.numcar ? '#' + p.numcar : '—'}</td>
                    <td class="text-xs text-slate-600">${p.motorista || '—'}</td>
                    <td class="text-right font-bold text-slate-800">${fmtBRL(p.valor)}</td>
                    <td class="text-right text-slate-600 text-xs">${fmtKg(p.peso)}</td>
                    <td class="text-center">${danfeBtn}</td>
                    <td class="text-center">${devBadge}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="12" class="text-center py-6 text-red-500 font-medium">Falha de rede: ${err.message}</td></tr>`;
    }
}

function consultarPedidoDireto(numped) {
    document.getElementById('aba-pedidos-consulta').click();
    document.getElementById('filtro-335-numped').value = numped;
    executarConsulta335();
}

// Modal de Itens do Pedido
async function abrirItensPedido(numped) {
    const modal = document.getElementById('modal-itens-pedido');
    const container = document.getElementById('modal-itens-conteudo');
    const titulo = document.getElementById('modal-itens-titulo');
    
    titulo.innerText = `Itens do Pedido #${numped}`;
    container.innerHTML = `<div class="text-center py-8 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Carregando itens...</div>`;
    modal.style.display = 'flex';
    
    try {
        const res = await fetch(`/api/pedidos-consulta/itens/${numped}`);
        const data = await res.json();
        
        if (data.status !== 'ok' || !data.itens || data.itens.length === 0) {
            container.innerHTML = `<p class="text-slate-500 text-center py-4">Nenhum item encontrado para o pedido #${numped}.</p>`;
            return;
        }
        
        const totalQtd = data.itens.reduce((s, i) => s + Number(i.quantidade || 0), 0);
        const totalVal = data.itens.reduce((s, i) => s + Number(i.valor || 0), 0);
        
        container.innerHTML = `
            <div class="mb-3 flex justify-between items-center text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                <span>Total de Itens: <b>${data.itens.length} SKUs</b> (${fmtNum(totalQtd)} un)</span>
                <span>Valor Total: <b class="text-[#141a4d]">${fmtBRL(totalVal)}</b></span>
            </div>
            <div class="overflow-y-auto max-h-[420px]">
                <table class="w-full text-xs text-left">
                    <thead class="bg-slate-100 text-slate-700 uppercase font-bold sticky top-0">
                        <tr>
                            <th class="p-2">Cód</th>
                            <th class="p-2">Descrição</th>
                            <th class="p-2 text-right">Qtd</th>
                            <th class="p-2 text-right">Valor Total</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${data.itens.map(i => `
                            <tr class="hover:bg-slate-50">
                                <td class="p-2 font-mono text-slate-500">${i.codprod}</td>
                                <td class="p-2 font-medium text-slate-800">${i.descricao}</td>
                                <td class="p-2 text-right font-semibold">${fmtNum(i.quantidade)}</td>
                                <td class="p-2 text-right font-bold text-[#141a4d]">${fmtBRL(i.valor)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<p class="text-red-500 text-center py-4">Erro ao carregar itens: ${err.message}</p>`;
    }
}

// Modal do DANFE
async function abrirDanfe(numped) {
    const modal = document.getElementById('modal-danfe-viewer');
    const container = document.getElementById('modal-danfe-corpo');
    const numEl = document.getElementById('danfe-numero-nf');
    
    numEl.innerText = `Carregando...`;
    container.innerHTML = `<div class="text-center py-16 text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2 text-xl"></i>Obtendo XML autorizado e montando DANFE...</div>`;
    modal.style.display = 'flex';
    
    try {
        const res = await fetch(`/api/pedidos-consulta/danfe/${numped}`);
        const d = await res.json();
        
        if (d.status === 'error' || d.erro) {
            container.innerHTML = `<div class="p-6 text-center text-red-600 bg-red-50 rounded-xl">${d.message || d.erro}</div>`;
            return;
        }
        
        numEl.innerText = `NF-e Nº ${d.nNF} · Série ${d.serie}`;
        
        // Renderiza layout oficial do DANFE estilo documento fiscal
        container.innerHTML = `
            <div class="border border-slate-300 p-6 bg-white text-slate-900 font-sans text-xs shadow-sm rounded-lg" id="danfe-impressao">
                <!-- Cabeçalho DANFE -->
                <div class="grid grid-cols-12 border-b border-slate-300 pb-4 mb-4 gap-4">
                    <div class="col-span-4 border-r border-slate-300 pr-4">
                        <div class="font-extrabold text-sm text-[#141a4d]">${d.emitente?.xNome || 'DIA DISTRIBUICAO'}</div>
                        <div class="text-[11px] text-slate-600 mt-1">${d.emitente?.logradouro || ''}, ${d.emitente?.numero || ''}</div>
                        <div class="text-[11px] text-slate-600">${d.emitente?.bairro || ''} - ${d.emitente?.municipio || ''}/${d.emitente?.uf || ''}</div>
                        <div class="text-[11px] text-slate-600 font-mono mt-1">CNPJ: ${d.emitente?.cnpj || ''}</div>
                        <div class="text-[11px] text-slate-600 font-mono">IE: ${d.emitente?.ie || ''}</div>
                    </div>
                    <div class="col-span-4 text-center border-r border-slate-300 pr-4 flex flex-col justify-center">
                        <span class="text-xl font-black tracking-widest text-[#141a4d]">DANFE</span>
                        <span class="text-[10px] text-slate-500 uppercase font-semibold">Documento Auxiliar da Nota Fiscal Eletrônica</span>
                        <div class="mt-2 text-xs font-bold">
                            <span>0 - Entrada</span> | <span class="bg-slate-200 px-1.5 py-0.5 rounded font-black">1 - Saída</span>
                        </div>
                        <div class="mt-2 font-bold text-sm">Nº ${d.nNF} · SÉRIE ${d.serie}</div>
                    </div>
                    <div class="col-span-4 pl-2 flex flex-col justify-center">
                        <div class="text-[10px] uppercase font-bold text-slate-500">Chave de Acesso</div>
                        <div class="font-mono text-[10px] font-bold text-slate-800 break-all bg-slate-50 p-1.5 rounded border border-slate-200">${d.chave || '—'}</div>
                        <div class="mt-2 text-[10px] text-slate-500">Protocolo de Autorização:</div>
                        <div class="font-mono text-xs font-semibold text-emerald-700">${d.protocolo || '—'} · ${d.dhRecbto || ''}</div>
                    </div>
                </div>

                <!-- Destinatário -->
                <div class="border border-slate-300 p-3 rounded mb-4 bg-slate-50/50">
                    <div class="text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200 pb-1 mb-2">Destinatário / Remetente</div>
                    <div class="grid grid-cols-12 gap-2">
                        <div class="col-span-8"><span class="text-slate-400">Nome/Razão:</span> <b class="text-slate-800">${d.destinatario?.xNome || ''}</b></div>
                        <div class="col-span-4 font-mono"><span class="text-slate-400">CNPJ/CPF:</span> <b>${d.destinatario?.documento || ''}</b></div>
                        <div class="col-span-8"><span class="text-slate-400">Endereço:</span> ${d.destinatario?.logradouro || ''}, ${d.destinatario?.numero || ''} - ${d.destinatario?.bairro || ''}</div>
                        <div class="col-span-4"><span class="text-slate-400">Município/UF:</span> ${d.destinatario?.municipio || ''}/${d.destinatario?.uf || ''}</div>
                    </div>
                </div>

                <!-- Totais da Nota -->
                <div class="border border-slate-300 p-3 rounded mb-4">
                    <div class="text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200 pb-1 mb-2">Cálculo do Imposto & Totais</div>
                    <div class="grid grid-cols-5 gap-2 text-center">
                        <div class="bg-slate-50 p-1.5 rounded border border-slate-200">
                            <div class="text-[9px] text-slate-400 uppercase font-bold">Valor dos Produtos</div>
                            <div class="font-bold text-slate-800">${fmtBRL(d.totais?.vProd)}</div>
                        </div>
                        <div class="bg-slate-50 p-1.5 rounded border border-slate-200">
                            <div class="text-[9px] text-slate-400 uppercase font-bold">Valor do Frete</div>
                            <div class="font-bold text-slate-800">${fmtBRL(d.totais?.vFrete)}</div>
                        </div>
                        <div class="bg-slate-50 p-1.5 rounded border border-slate-200">
                            <div class="text-[9px] text-slate-400 uppercase font-bold">Base ICMS / ST</div>
                            <div class="font-bold text-slate-800">${fmtBRL(d.totais?.vBC)}</div>
                        </div>
                        <div class="bg-slate-50 p-1.5 rounded border border-slate-200">
                            <div class="text-[9px] text-slate-400 uppercase font-bold">Valor ICMS / ST</div>
                            <div class="font-bold text-slate-800">${fmtBRL(d.totais?.vICMS)}</div>
                        </div>
                        <div class="bg-emerald-50 p-1.5 rounded border border-emerald-200">
                            <div class="text-[9px] text-emerald-800 uppercase font-extrabold">Total da Nota</div>
                            <div class="font-black text-emerald-800 text-sm">${fmtBRL(d.totais?.vNF)}</div>
                        </div>
                    </div>
                </div>

                <!-- Itens da Nota -->
                <div class="border border-slate-300 rounded mb-4 overflow-hidden">
                    <div class="bg-slate-100 p-2 text-[10px] font-bold uppercase text-slate-700 border-b border-slate-300">Dados dos Produtos / Serviços</div>
                    <div class="max-h-[300px] overflow-y-auto">
                        <table class="w-full text-[11px] text-left">
                            <thead class="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold sticky top-0">
                                <tr>
                                    <th class="p-2">Cód</th>
                                    <th class="p-2">Descrição</th>
                                    <th class="p-2">NCM</th>
                                    <th class="p-2">CFOP</th>
                                    <th class="p-2">UN</th>
                                    <th class="p-2 text-right">Qtd</th>
                                    <th class="p-2 text-right">V. Unit</th>
                                    <th class="p-2 text-right">V. Total</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100">
                                ${(d.itens || []).map(i => `
                                    <tr>
                                        <td class="p-2 font-mono text-slate-500">${i.cProd}</td>
                                        <td class="p-2 font-medium text-slate-800">${i.xProd}</td>
                                        <td class="p-2 text-slate-500 font-mono">${i.ncm || '—'}</td>
                                        <td class="p-2 text-slate-500 font-mono">${i.cfop || '—'}</td>
                                        <td class="p-2 text-slate-600 uppercase">${i.uCom || ''}</td>
                                        <td class="p-2 text-right font-semibold">${fmtNum(i.qCom)}</td>
                                        <td class="p-2 text-right">${fmtBRL(i.vUnCom)}</td>
                                        <td class="p-2 text-right font-bold text-slate-900">${fmtBRL(i.vProd)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Informações Adicionais -->
                <div class="border border-slate-300 p-3 rounded bg-slate-50 text-[10px] text-slate-600">
                    <span class="font-bold uppercase text-slate-700">Informações Complementares:</span>
                    <p class="mt-1">${d.infCpl || 'Sem observações adicionais gravadas no XML.'}</p>
                </div>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div class="p-6 text-center text-red-600 bg-red-50 rounded-xl">Falha ao obter DANFE: ${err.message}</div>`;
    }
}

function imprimirDanfe() {
    window.print();
}

// =============================================================================
// 3. DEVOLUÇÕES DETALHADAS (SETOR, MOTIVO, CLIENTE, VENDEDOR, MOTORISTA)
// =============================================================================
let devolucoesData = null;

// Cidade escolhida no mapa (null = Pernambuco inteiro). Filtra cards, setores, tabelas e os gráficos da cidade.
let devCidadeSel = null;
let devRequisicao = 0;
let devGeoPE = null;
let devDetalheCidade = null;
let devChartDias = { valor: null, peso: null };
const devSegmentos = {
    'mapa-metrica': 'valor', 'mapa-visao': 'PE',
    'dias-valor-base': 'fat', 'dias-valor-modo': 'num',
    'dias-peso-base': 'fat', 'dias-peso-modo': 'num',
    'bairros-metrica': 'valor', 'bairros-base': 'fat',
    'clientes-metrica': 'valor', 'clientes-base': 'fat'
};
const DIAS_SEMANA_CURTOS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function carregarDevolucoesDetalhadas() {
    const container = document.getElementById('devolucoes-detalhes-container');
    if (!container) return;

    const di = document.getElementById('filtro-dev-ini')?.value || '';
    const df = document.getElementById('filtro-dev-fim')?.value || '';
    const setor = document.getElementById('filtro-dev-setor')?.value || '';
    const motivo = document.getElementById('filtro-dev-motivo')?.value || '';

    const params = new URLSearchParams();
    if (di) params.set('data_inicio', di);
    if (df) params.set('data_fim', df);
    if (setor) params.set('setor', setor);
    if (motivo) params.set('motivo', motivo);
    if (devCidadeSel) params.set('ibge', devCidadeSel.ibge);

    // Só a resposta mais recente vale (cliques seguidos no mapa ou digitação no filtro)
    const minhaRequisicao = ++devRequisicao;
    atualizarCabecalhoCidadeDev();
    pintarSegmentosDev();
    ligarEventosMapaDev();
    marcarIndicadores(['kpi-dev-valor-total', 'kpi-dev-notas-total'], 'carregando');
    if (devCidadeSel) carregarDetalheCidadeDev(di, df);

    try {
        const res = await fetch(`/api/devolucoes-detalhadas?${params.toString()}`);
        const dados = await res.json();
        if (minhaRequisicao !== devRequisicao) return;
        devolucoesData = dados;

        if (devolucoesData.status !== 'ok') {
            console.error(devolucoesData.message);
            marcarIndicadores(['kpi-dev-valor-total', 'kpi-dev-notas-total'], 'erro');
            return;
        }

        // Atualiza KPIs do topo
        marcarIndicadores(['kpi-dev-valor-total', 'kpi-dev-notas-total'], 'pronto');
        document.getElementById('kpi-dev-valor-total').innerText = fmtBRL(devolucoesData.kpis.valor_total);
        document.getElementById('kpi-dev-notas-total').innerText = fmtNum(devolucoesData.kpis.total_notas);

        // Renderiza Setores
        renderizarDevolucoesSetores(devolucoesData.por_setor || [], devolucoesData.kpis.valor_total);

        // Renderiza aba ativa
        alternarAbaDevolucao('motivos');

        // Mapa de Pernambuco, ou a cidade escolhida no lugar dele
        desenharMapaDevolucoes();
    } catch (err) {
        console.error('Erro ao carregar devoluções:', err);
        if (minhaRequisicao === devRequisicao) marcarIndicadores(['kpi-dev-valor-total', 'kpi-dev-notas-total'], 'erro');
    }
}

// Abre a aba pelo menu: sempre Pernambuco inteiro, a não ser que tenha vindo de um clique no mapa
window.abrirAbaDevolucoes = function() {
    if (!window.__devCidadePendente) devCidadeSel = null;
    window.__devCidadePendente = false;
    carregarDevolucoesDetalhadas();
};

// Clique numa cidade em qualquer mapa (Telemetria ou Devoluções)
window.abrirDevolucoesCidade = function(ibge, nome) {
    const aba = document.getElementById('conteudo-devolucoes-detalhe');
    if (aba && aba.style.display !== 'none') {
        selecionarCidadeDev(ibge, nome);
        return;
    }
    // Vindo da Telemetria: as devoluções abrem no mesmo período escolhido lá
    const di = document.getElementById('data-inicio-telemetria')?.value;
    const df = document.getElementById('data-fim-telemetria')?.value;
    if (di) document.getElementById('filtro-dev-ini').value = di;
    if (df) document.getElementById('filtro-dev-fim').value = df;
    devCidadeSel = { ibge: String(ibge), nome };
    window.__devCidadePendente = true;
    irParaAbaSistema('aba-devolucoes-detalhe');
};

function selecionarCidadeDev(ibge, nome) {
    devCidadeSel = { ibge: String(ibge), nome };
    esconderTooltipDev();
    carregarDevolucoesDetalhadas();
    document.getElementById('dev-mapa-bloco')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

window.voltarDevolucoesPernambuco = function() {
    devCidadeSel = null;
    carregarDevolucoesDetalhadas();
};

function atualizarCabecalhoCidadeDev() {
    const comCidade = !!devCidadeSel;
    const chip = document.getElementById('dev-chip-cidade');
    if (chip) {
        chip.classList.toggle('hidden', !comCidade);
        chip.classList.toggle('inline-flex', comCidade);
        document.getElementById('dev-chip-cidade-nome').innerText = comCidade ? `Cidade: ${devCidadeSel.nome}` : '';
    }
    document.getElementById('dev-mapa-titulo').innerText = comCidade ? devCidadeSel.nome : 'Mapa de Devolução por Cidade';
    document.getElementById('dev-mapa-metrica')?.classList.toggle('hidden', comCidade);
    document.getElementById('dev-mapa-visao')?.classList.toggle('hidden', comCidade);
    const voltar = document.getElementById('dev-btn-voltar-pe');
    voltar?.classList.toggle('hidden', !comCidade);
    voltar?.classList.toggle('inline-flex', comCidade);
    const graficos = document.getElementById('dev-cidade-graficos');
    graficos?.classList.toggle('hidden', !comCidade);
    graficos?.classList.toggle('flex', comCidade);
}

// Botões de alternância (Valor/Taxa, PE/RMR, Dia Faturado/Entrada Dev., Numérico/Porcentagem, Valor/Peso)
window.alternarSegmentoDev = function(botao) {
    const grupo = botao.dataset.grupo;
    devSegmentos[grupo] = botao.dataset.valor;
    pintarSegmentosDev();
    if (grupo.startsWith('mapa-')) desenharMapaDevolucoes();
    else if (grupo.startsWith('dias-valor')) desenharDiasDev('valor');
    else if (grupo.startsWith('dias-peso')) desenharDiasDev('peso');
    else if (grupo.startsWith('bairros')) desenharBarrasDev('bairros');
    else if (grupo.startsWith('clientes')) desenharBarrasDev('clientes');
};

function pintarSegmentosDev() {
    document.querySelectorAll('#conteudo-devolucoes-detalhe [data-grupo]').forEach(b => {
        const ativo = devSegmentos[b.dataset.grupo] === b.dataset.valor;
        b.classList.toggle('bg-white', ativo);
        b.classList.toggle('shadow-sm', ativo);
        b.classList.toggle('text-[#2A2C65]', ativo);
        b.classList.toggle('text-slate-500', !ativo);
        b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
}

// ---- Mapa ---------------------------------------------------------------------
async function obterGeoPE() {
    if (devGeoPE) return devGeoPE;
    if (typeof municipiosGeo !== 'undefined' && municipiosGeo) return (devGeoPE = municipiosGeo);
    const res = await fetch('js/pe-municipios.json');
    devGeoPE = await res.json();
    return devGeoPE;
}

async function desenharMapaDevolucoes() {
    const caixa = document.getElementById('dev-mapa-svg');
    const lateral = document.getElementById('dev-mapa-lateral');
    if (!caixa || !lateral) return;
    let geo;
    try {
        geo = await obterGeoPE();
    } catch (e) {
        caixa.innerHTML = '<p class="text-sm text-rose-600">Não foi possível carregar a malha de municípios.</p>';
        return;
    }
    const cidades = (devolucoesData && devolucoesData.cidades) || [];
    const porIbge = new Map(cidades.map(c => [String(c.ibge), c]));
    const vazio = { devolvido: 0, faturado: 0, taxa: 0, notas_devolvidas: 0, notas_faturadas: 0, motivo_top: null };

    if (devCidadeSel) {
        const municipio = geo.find(g => String(g.ibge) === devCidadeSel.ibge);
        const c = porIbge.get(devCidadeSel.ibge) || vazio;
        const totalPE = cidades.reduce((s, x) => s + Number(x.devolvido || 0), 0);
        caixa.innerHTML = municipio ? `
            <svg viewBox="${calcularViewBox([municipio])}" class="w-full h-full p-6" style="filter: drop-shadow(0 6px 8px rgb(20 26 77 / 0.18));">
                <path d="${municipio.d}" fill="#f5b301" stroke="#141a4d" stroke-width="1.5" vector-effect="non-scaling-stroke" data-ibge="${escHtml(municipio.ibge)}" data-nome="${escHtml(municipio.nome)}"></path>
            </svg>
            <span class="absolute left-4 bottom-3 text-xs font-bold uppercase tracking-wider text-[#141a4d]/70">${escHtml(municipio.nome)}</span>`
            : '<p class="text-sm text-slate-400">Contorno da cidade indisponível.</p>';
        const linha = (rotulo, valor, cor = 'text-[#141a4d]') => `
            <div class="flex items-baseline justify-between gap-3 py-2.5 border-b border-slate-100">
                <dt class="text-xs font-semibold uppercase tracking-wider text-slate-400">${rotulo}</dt>
                <dd class="text-sm font-extrabold tabular-nums ${cor} text-right">${valor}</dd>
            </div>`;
        lateral.innerHTML = `
            <h4 class="text-xs font-bold text-[#2A2C65] uppercase tracking-wider mb-2">Resumo da cidade no período</h4>
            <dl class="flex-1">
                ${linha('Valor devolvido', fmtBRL(c.devolvido), 'text-rose-600')}
                ${linha('Faturado na cidade', fmtBRL(c.faturado))}
                ${linha('Taxa de devolução', (Number(c.taxa || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%', 'text-rose-600')}
                ${linha('Notas devolvidas / faturadas', `${fmtNum(c.notas_devolvidas)} / ${fmtNum(c.notas_faturadas)}`)}
                ${linha('Parte das devoluções de PE', totalPE > 0 ? (c.devolvido / totalPE * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '—')}
                <div class="pt-2.5">
                    <dt class="text-xs font-semibold uppercase tracking-wider text-slate-400">Motivo predominante</dt>
                    <dd class="mt-1 text-sm font-bold text-amber-700">${escHtml(c.motivo_top || 'Sem devolução no período')}</dd>
                </div>
            </dl>`;
        return;
    }

    const metrica = devSegmentos['mapa-metrica'];
    const visao = devSegmentos['mapa-visao'];
    const paths = visao === 'RMR' ? geo.filter(m => RMR_CIDADES.includes(normalizarNome(m.nome))) : geo;
    const viewBox = visao === 'RMR' ? calcularViewBox(paths) : '0 0 1000 341';
    const valorDe = c => metrica === 'valor' ? Number(c.devolvido || 0) : Number(c.taxa || 0);
    const teto = Math.max(0, ...paths.map(m => valorDe(porIbge.get(String(m.ibge)) || vazio)));

    caixa.innerHTML = `
        <svg viewBox="${viewBox}" class="w-full h-full p-4" style="filter: drop-shadow(0 4px 3px rgb(0 0 0 / 0.07));">
            ${paths.map(m => {
                const v = valorDe(porIbge.get(String(m.ibge)) || vazio);
                const cor = v > 0 ? getCorRampa(v / (teto || 1)) : '#cbd5e1';
                return `<path d="${m.d}" fill="${cor}" stroke="#64748b" stroke-width="${visao === 'RMR' ? 0.25 : 0.5}" class="map-path cursor-pointer transition-opacity hover:opacity-80" data-ibge="${escHtml(m.ibge)}" data-nome="${escHtml(m.nome)}"></path>`;
            }).join('')}
        </svg>
        <span class="pointer-events-none absolute left-3 bottom-2 text-[11px] text-slate-400">Clique numa cidade para ver o detalhe</span>`;

    const nomes = new Map(paths.map(m => [String(m.ibge), m.nome]));
    const ranking = cidades.filter(c => nomes.has(String(c.ibge)) && valorDe(c) > 0)
        .sort((a, b) => valorDe(b) - valorDe(a)).slice(0, 10);
    lateral.innerHTML = `
        <h4 class="text-xs font-bold text-[#2A2C65] uppercase tracking-wider mb-2">${metrica === 'valor' ? 'Maiores volumes (R$)' : 'Maiores taxas (%)'}</h4>
        <div class="overflow-y-auto flex-1 pr-2">
            ${ranking.length === 0 ? '<p class="text-sm text-slate-400 py-4 text-center">Sem devoluções no período.</p>' : `
            <ul class="divide-y divide-slate-100">
                ${ranking.map(c => `
                    <li>
                        <button type="button" onclick="selecionarCidadeDev('${escHtml(c.ibge)}', this.dataset.nome)" data-nome="${escHtml(nomes.get(String(c.ibge)))}" class="w-full flex justify-between items-center gap-3 py-2 px-1 text-left rounded hover:bg-slate-50 transition">
                            <span class="text-[11px] text-[#141a4d] truncate font-semibold">${escHtml(nomes.get(String(c.ibge)))}</span>
                            <span class="text-[11px] text-rose-600 font-bold tabular-nums">${metrica === 'valor' ? fmtBRL(c.devolvido) : (c.taxa * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'}</span>
                        </button>
                    </li>`).join('')}
            </ul>`}
        </div>`;
}

function ligarEventosMapaDev() {
    const caixa = document.getElementById('dev-mapa-svg');
    if (!caixa || caixa.dataset.ligado) return;
    caixa.dataset.ligado = '1';
    caixa.addEventListener('mousemove', e => {
        const p = e.target.closest('path[data-ibge]');
        if (!p) return esconderTooltipDev();
        mostrarTooltipDev(e, p.dataset.ibge, p.dataset.nome);
    });
    caixa.addEventListener('mouseleave', esconderTooltipDev);
    caixa.addEventListener('click', e => {
        const p = e.target.closest('path[data-ibge]');
        if (p && !devCidadeSel) selecionarCidadeDev(p.dataset.ibge, p.dataset.nome);
    });
}

function mostrarTooltipDev(e, ibge, nome) {
    const tip = document.getElementById('dev-mapa-tooltip');
    if (!tip) return;
    const c = ((devolucoesData && devolucoesData.cidades) || []).find(x => String(x.ibge) === String(ibge));
    document.getElementById('dev-tooltip-cidade').innerText = nome;
    document.getElementById('dev-tooltip-dados').innerText = c
        ? `devolvido ${fmtBRL(c.devolvido)} · taxa ${(c.taxa * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
        : 'sem devolução no período';
    document.getElementById('dev-tooltip-extra').innerText = c ? `faturado ${fmtBRL(c.faturado)}` : '';
    tip.classList.remove('hidden');
    const largura = tip.offsetWidth, altura = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + largura > window.innerWidth - 8) x = e.clientX - largura - 14;
    if (y + altura > window.innerHeight - 8) y = e.clientY - altura - 14;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
}

function esconderTooltipDev() {
    document.getElementById('dev-mapa-tooltip')?.classList.add('hidden');
}

// ---- Gráficos da cidade --------------------------------------------------------
async function carregarDetalheCidadeDev(di, df) {
    const chave = `${devCidadeSel.ibge}|${di}|${df}`;
    if (devDetalheCidade && devDetalheCidade.chave === chave) {
        renderizarGraficosCidadeDev();
        return;
    }
    devDetalheCidade = { chave, carregando: true };
    renderizarGraficosCidadeDev();
    const params = new URLSearchParams({ ibge: devCidadeSel.ibge });
    if (di) params.set('data_inicio', di);
    if (df) params.set('data_fim', df);
    try {
        const res = await fetch(`/api/devolucoes-cidade?${params.toString()}`);
        const dados = await res.json();
        if (!devDetalheCidade || devDetalheCidade.chave !== chave) return;
        devDetalheCidade = dados.status === 'ok' ? { chave, ...dados } : { chave, erro: dados.message || 'Falha ao carregar' };
    } catch (e) {
        if (devDetalheCidade && devDetalheCidade.chave === chave) devDetalheCidade = { chave, erro: e.message };
    }
    if (devCidadeSel && devDetalheCidade.chave === `${devCidadeSel.ibge}|${di}|${df}`) renderizarGraficosCidadeDev();
}

function renderizarGraficosCidadeDev() {
    desenharDiasDev('valor');
    desenharDiasDev('peso');
    desenharBarrasDev('bairros');
    desenharBarrasDev('clientes');
}

function serieDiasDev(base, campo) {
    const num = [0, 0, 0, 0, 0, 0];
    ((devDetalheCidade && devDetalheCidade[base] && devDetalheCidade[base].dias_semana) || []).forEach(d => {
        const i = Number(d.dia_semana) - 2; // 2 = segunda ... 7 = sábado
        if (i >= 0 && i < 6) num[i] = Number(d[campo] || 0);
    });
    const total = num.reduce((a, b) => a + b, 0);
    return { num, pct: num.map(v => total > 0 ? Number((v / total * 100).toFixed(1)) : 0) };
}

function desenharDiasDev(campo) {
    const canvas = document.getElementById(campo === 'valor' ? 'dev-cidade-chart-valor' : 'dev-cidade-chart-peso');
    if (!canvas) return;
    const base = devSegmentos[`dias-${campo}-base`];
    const emPct = devSegmentos[`dias-${campo}-modo`] === 'pct';
    const serie = serieDiasDev(base, campo);
    const dados = emPct ? serie.pct : serie.num;
    const formatar = v => emPct
        ? `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
        : (campo === 'valor' ? fmtBRL(v) : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`);
    if (devChartDias[campo]) devChartDias[campo].destroy();
    const ehValor = campo === 'valor';
    devChartDias[campo] = new Chart(canvas, {
        type: ehValor ? 'bar' : 'line',
        data: {
            labels: DIAS_SEMANA_CURTOS,
            datasets: [{
                label: emPct ? 'Participação (%)' : (ehValor ? 'Valor devolvido (R$)' : 'Peso devolvido (kg)'),
                data: dados,
                backgroundColor: ehValor ? '#ef4444' : '#fef3c7',
                borderColor: ehValor ? '#ef4444' : '#f59e0b',
                borderRadius: ehValor ? 4 : 0,
                fill: !ehValor,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => formatar(c.raw) } } },
            scales: { y: { beginAtZero: true, ticks: { callback: v => emPct ? `${v}%` : (ehValor ? formatarMoedaCurta(v) : `${Number(v).toLocaleString('pt-BR')} kg`) } } }
        }
    });
}

function desenharBarrasDev(tipo) {
    const idCanvas = `dev-cidade-chart-${tipo}`;
    const canvas = document.getElementById(idCanvas);
    const aviso = document.getElementById(`dev-cidade-${tipo}-vazio`);
    if (!canvas || !aviso) return;
    const metrica = devSegmentos[`${tipo}-metrica`];
    const base = devSegmentos[`${tipo}-base`];
    const carregando = devDetalheCidade && devDetalheCidade.carregando;
    const lista = ((devDetalheCidade && devDetalheCidade[base] && devDetalheCidade[base][tipo]) || [])
        .filter(x => Number(x[metrica]) > 0)
        .sort((a, b) => Number(b[metrica]) - Number(a[metrica]))
        .slice(0, 10)
        .map(x => ({
            NOME: tipo === 'bairros' ? x.bairro : `${x.codcli} - ${String(x.cliente || '').trim()}`,
            VALOR: x.valor,
            PESO: x.peso
        }));
    const semDados = !carregando && lista.length === 0;
    canvas.parentElement.classList.toggle('hidden', semDados);
    aviso.classList.toggle('hidden', !semDados);
    if (devDetalheCidade && devDetalheCidade.erro) aviso.innerText = `Erro ao carregar: ${devDetalheCidade.erro}`;
    else aviso.innerText = tipo === 'bairros' ? 'Sem devoluções por bairro neste período.' : 'Sem devoluções de clientes neste período.';
    if (semDados && chartInstances[idCanvas]) {
        chartInstances[idCanvas].destroy();
        delete chartInstances[idCanvas];
    }
    if (!semDados) desenharGraficoHorizontal(idCanvas, lista, 'NOME', metrica === 'valor' ? '#ef4444' : '#f59e0b', metrica === 'valor' ? 'VALOR' : 'PESO');
}

function renderizarDevolucoesSetores(setores, totalValor) {
    const el = document.getElementById('devolucoes-setores-barras');
    if (!el) return;
    
    const cores = {
        'Logística': { bg: 'bg-[#1b2168]', text: 'text-[#1b2168]', light: 'bg-indigo-50' },
        'Comercial': { bg: 'bg-amber-400', text: 'text-amber-800', light: 'bg-amber-50' },
        'Faturamento': { bg: 'bg-rose-500', text: 'text-rose-800', light: 'bg-rose-50' },
        'Não classificado': { bg: 'bg-slate-400', text: 'text-slate-700', light: 'bg-slate-50' }
    };
    
    el.innerHTML = setores.map(s => {
        const c = cores[s.setor] || cores['Não classificado'];
        const pct = totalValor > 0 ? (s.valor / totalValor) * 100 : 0;
        return `
            <div class="border border-slate-200 bg-white p-4 rounded-xl shadow-sm flex flex-col justify-between">
                <div class="flex justify-between items-center mb-2">
                    <span class="font-bold text-xs uppercase tracking-wider ${c.text}">${s.setor}</span>
                    <span class="text-xs font-semibold text-slate-500">${fmtNum(s.notas)} NFs</span>
                </div>
                <div class="text-lg font-black text-slate-900 mb-2">${fmtBRL(s.valor)}</div>
                <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden mb-1">
                    <div class="${c.bg} h-full rounded-full transition-all duration-500" style="width: ${pct.toFixed(1)}%"></div>
                </div>
                <div class="text-[10px] text-slate-400 font-semibold text-right">${pct.toFixed(1)}% do total</div>
            </div>
        `;
    }).join('');
}

function alternarAbaDevolucao(aba) {
    document.querySelectorAll('.tab-dev-btn').forEach(b => b.classList.remove('bg-[#141a4d]', 'text-white'));
    document.querySelectorAll('.tab-dev-btn').forEach(b => b.classList.add('bg-white', 'text-slate-600'));
    
    const btnAtivo = document.getElementById(`btn-dev-tab-${aba}`);
    if (btnAtivo) {
        btnAtivo.classList.remove('bg-white', 'text-slate-600');
        btnAtivo.classList.add('bg-[#141a4d]', 'text-white');
    }
    
    const conteudo = document.getElementById('devolucoes-subtab-conteudo');
    if (!conteudo || !devolucoesData) return;
    
    if (aba === 'motivos') {
        const motivos = devolucoesData.por_motivo || [];
        conteudo.innerHTML = `
            <table class="w-full text-xs text-left">
                <thead class="bg-slate-50 text-slate-700 uppercase font-bold border-b border-slate-200">
                    <tr>
                        <th class="p-3">Motivo da Devolução</th>
                        <th class="p-3">Setor Responsável</th>
                        <th class="p-3 text-right">Qtd Notas</th>
                        <th class="p-3 text-right">Valor Devolvido</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${motivos.map(m => `
                        <tr class="hover:bg-slate-50">
                            <td class="p-3 font-semibold text-slate-800">${m.motivo}</td>
                            <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">${m.setor}</span></td>
                            <td class="p-3 text-right font-medium text-slate-600">${fmtNum(m.notas)}</td>
                            <td class="p-3 text-right font-bold text-red-600">${fmtBRL(m.valor)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else if (aba === 'clientes') {
        const clientes = devolucoesData.clientes || [];
        conteudo.innerHTML = `
            <table class="w-full text-xs text-left">
                <thead class="bg-slate-50 text-slate-700 uppercase font-bold border-b border-slate-200">
                    <tr>
                        <th class="p-3">Cód</th>
                        <th class="p-3">Cliente</th>
                        <th class="p-3 text-right">NFs Devolvidas</th>
                        <th class="p-3 text-right">Valor Total Devolvido</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${clientes.map(c => `
                        <tr class="hover:bg-slate-50">
                            <td class="p-3 font-mono text-slate-500">${c.codcli}</td>
                            <td class="p-3 font-semibold text-slate-800">${c.nome}</td>
                            <td class="p-3 text-right font-medium text-slate-600">${fmtNum(c.notas)}</td>
                            <td class="p-3 text-right font-bold text-red-600">${fmtBRL(c.valor)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else if (aba === 'vendedores') {
        const vendedores = devolucoesData.vendedores || [];
        conteudo.innerHTML = `
            <table class="w-full text-xs text-left">
                <thead class="bg-slate-50 text-slate-700 uppercase font-bold border-b border-slate-200">
                    <tr>
                        <th class="p-3">Cód</th>
                        <th class="p-3">Vendedor (RCA)</th>
                        <th class="p-3 text-right">NFs Devolvidas</th>
                        <th class="p-3 text-right">Valor Devolvido</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${vendedores.map(v => `
                        <tr class="hover:bg-slate-50">
                            <td class="p-3 font-mono text-slate-500">${v.codusur}</td>
                            <td class="p-3 font-semibold text-slate-800">${v.nome}</td>
                            <td class="p-3 text-right font-medium text-slate-600">${fmtNum(v.notas)}</td>
                            <td class="p-3 text-right font-bold text-red-600">${fmtBRL(v.valor)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else if (aba === 'motoristas') {
        const motoristas = devolucoesData.motoristas || [];
        conteudo.innerHTML = `
            <table class="w-full text-xs text-left">
                <thead class="bg-slate-50 text-slate-700 uppercase font-bold border-b border-slate-200">
                    <tr>
                        <th class="p-3">Motorista</th>
                        <th class="p-3">Tipo</th>
                        <th class="p-3 text-right">Expedidas</th>
                        <th class="p-3 text-right">Devolvidas</th>
                        <th class="p-3 text-right">Taxa (%)</th>
                        <th class="p-3 text-right">Valor Expedido</th>
                        <th class="p-3 text-right">Valor Devolvido</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    ${motoristas.map(m => `
                        <tr class="hover:bg-slate-50">
                            <td class="p-3 font-semibold text-slate-800">${m.nome || 'Não Informado'}</td>
                            <td class="p-3">${Number(m.codmotorista) === 0 ? '' : `<span class="px-2 py-0.5 rounded text-[10px] font-bold ${m.tipo_motorista === 'F' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}">${m.tipo_motorista === 'F' ? 'Casa' : 'Terceiro'}</span>`}</td>
                            <td class="p-3 text-right text-slate-600 font-medium">${fmtNum(m.expedidas)}</td>
                            <td class="p-3 text-right text-red-600 font-semibold">${fmtNum(m.devolvidas)}</td>
                            <td class="p-3 text-right font-bold ${m.taxa > 5 ? 'text-red-600' : 'text-slate-800'}" ${m.taxa == null ? 'title="Sem notas expedidas por este motorista no período: as devoluções são de vendas anteriores"' : ''}>${m.taxa == null ? '—' : m.taxa + '%'}</td>
                            <td class="p-3 text-right text-slate-700">${fmtBRL(m.valor_expedido)}</td>
                            <td class="p-3 text-right font-bold text-red-600">${fmtBRL(m.valor_devolvido)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }
}

// =============================================================================
// 6. PAINEL TV (MODO OPERAÇÃO & CENTRO DE CONTROLE LOGÍSTICO)
// =============================================================================
let tvInterval = null;
let tvRefreshInterval = null;
const TV_AUTO_REFRESH_MS = 10 * 60 * 1000; // 10 minutos
let tvSlideIndex = 0;
let tvPausado = false;
let tvMesOffset = 0;

let tvDadosCompletos = null;
let geoDataPE = null;
let tvMapaPeInterval = null;
let tvMapaPeIndex = 0;
let tvMapaPeHoverIbge = null;
let tvRankingCidadesPE = [];

let tvMapaRmrInterval = null;
let tvMapaRmrIndex = 0;
let tvMapaRmrHoverIbge = null;
let tvListaBairrosRMR = [];

const RAMPA_CORES_TV = [
    "#fde68a",
    "#fcd34d",
    "#fbbf24",
    "#f59e0b",
    "#fb923c",
    "#f97316",
    "#ea580c",
    "#dc2626"
];
const COR_NEUTRA_TV = "#475569";

const RMR_IBGES = new Set([
    "2600054", "2601052", "2602902", "2603454", "2606804", "2607208", 
    "2607604", "2607752", "2607901", "2609402", "2609600", "2610707", 
    "2611606", "2613701"
]);

function corDaEscalaTV(valor, teto) {
    if (!valor || valor <= 0 || !teto || teto <= 0) return COR_NEUTRA_TV;
    const razao = Math.min(1, Math.max(0, valor / teto));
    const i = Math.min(RAMPA_CORES_TV.length - 1, Math.floor(razao * RAMPA_CORES_TV.length));
    return RAMPA_CORES_TV[i];
}

function calcularViewBoxRMR(paths) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const re = /-?\d+(?:\.\d+)?/g;
    for (const p of paths) {
        const nums = (p.d || '').match(re)?.map(Number) ?? [];
        for (let i = 0; i + 1 < nums.length; i += 2) {
            const x = nums[i], y = nums[i + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    if (!Number.isFinite(minX)) return "920 60 80 120";
    const pad = Math.max((maxX - minX), (maxY - minY)) * 0.05;
    return `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
}

async function carregarGeoDataPE() {
    if (geoDataPE) return geoDataPE;
    try {
        const res = await fetch('/data/pe-municipios.json');
        geoDataPE = await res.json();
        return geoDataPE;
    } catch (e) {
        console.error('Erro ao carregar pe-municipios.json:', e);
        return null;
    }
}

async function abrirModoTV() {
    const overlay = document.getElementById('painel-tv-overlay');
    if (!overlay) return;
    
    overlay.style.display = 'flex';
    document.documentElement.requestFullscreen?.().catch(() => {});
    
    tvSlideIndex = 0;
    tvPausado = false;
    tvMesOffset = 0;
    atualizarControlesPausaTV();
    mostrarSlideTV(0);
    
    await carregarGeoDataPE();
    await atualizarDadosTV(true);
    iniciarRotacaoTV();
    
    // Auto-atualização a cada 10 minutos
    if (tvRefreshInterval) clearInterval(tvRefreshInterval);
    tvRefreshInterval = setInterval(() => {
        const ov = document.getElementById('painel-tv-overlay');
        if (ov && ov.style.display !== 'none') {
            atualizarDadosTV(true);
        }
    }, TV_AUTO_REFRESH_MS);
}

function fecharModoTV() {
    const overlay = document.getElementById('painel-tv-overlay');
    if (overlay) overlay.style.display = 'none';
    if (tvInterval) clearTimeout(tvInterval);
    if (tvRefreshInterval) {
        clearInterval(tvRefreshInterval);
        tvRefreshInterval = null;
    }
    if (tvMapaPeInterval) clearInterval(tvMapaPeInterval);
    if (tvMapaRmrInterval) clearInterval(tvMapaRmrInterval);
    if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
    }
}

function iniciarRotacaoTV() {
    if (tvInterval) clearTimeout(tvInterval);
    
    const agendarProximo = () => {
        // Slides de mapa ficam 32s (dando tempo do card rotativo passar por 7-8 cidades/bairros)
        const dwell = (tvSlideIndex === 0 || tvSlideIndex === 1) ? 32000 : 14000;
        
        tvInterval = setTimeout(() => {
            if (!tvPausado) {
                trocarSlideTV(1);
            }
            agendarProximo();
        }, dwell);
    };
    
    agendarProximo();
}

function togglePausarTV() {
    tvPausado = !tvPausado;
    atualizarControlesPausaTV();
}

function atualizarControlesPausaTV() {
    const btn = document.getElementById('tv-btn-pause');
    const ico = document.getElementById('tv-ico-pause');
    const badge = document.getElementById('tv-badge-pausado');
    
    if (tvPausado) {
        if (ico) ico.className = 'fa-solid fa-play';
        if (btn) {
            btn.className = 'flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 text-[#0a1650] ring-1 ring-amber-300 transition';
            btn.title = 'Retomar rotação automática (Espaço)';
        }
        if (badge) badge.classList.remove('hidden');
    } else {
        if (ico) ico.className = 'fa-solid fa-pause';
        if (btn) {
            btn.className = 'flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white/80 hover:bg-white/15 ring-1 ring-white/15 transition';
            btn.title = 'Travar nesta página (Espaço)';
        }
        if (badge) badge.classList.add('hidden');
    }
}

function toggleFullscreenTV() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
        document.exitFullscreen?.().catch(() => {});
    }
}

function trocarSlideTV(delta) {
    const slides = document.querySelectorAll('.tv-slide');
    if (!slides.length) return;
    const novoIdx = (tvSlideIndex + delta + slides.length) % slides.length;
    mostrarSlideTV(novoIdx);
}

function irParaSlideTV(idx) {
    mostrarSlideTV(idx);
}

function mostrarSlideTV(idx) {
    const slides = document.querySelectorAll('.tv-slide');
    if (!slides.length) return;
    
    slides.forEach((s, i) => {
        if (i === idx) {
            s.classList.remove('hidden');
        } else {
            s.classList.add('hidden');
        }
    });
    
    tvSlideIndex = idx;
    
    // Atualizar dots
    const dots = document.querySelectorAll('.tv-dot');
    dots.forEach((dot, i) => {
        if (i === idx) {
            dot.className = 'tv-dot h-1.5 rounded-full transition-all w-10 bg-amber-400';
        } else {
            dot.className = 'tv-dot h-1.5 rounded-full transition-all w-4 bg-white/20 hover:bg-white/40';
        }
    });
    
    // Dispara atualizações de cards e rotações específicas dos mapas
    if (typeof esconderTooltipTVPE === 'function') esconderTooltipTVPE();
    if (typeof esconderTooltipTVRMR === 'function') esconderTooltipTVRMR();
    if (idx === 0) {
        atualizarCardCidadePE();
        iniciarRotacaoCardPE();
    } else if (idx === 1) {
        atualizarCardBairroRMR();
        iniciarRotacaoCardRMR();
    }
    
    if (document.body.classList.contains('role-tv-blurred')) {
        aplicarMascaraMonetariaGlobal();
    }
}

let tvCarregandoDados = false;

function trocarMesTV(delta) {
    if (tvCarregandoDados) return;
    const novoOffset = tvMesOffset + delta;
    if (novoOffset > 0) return; // Não permite avançar para meses futuros
    
    tvMesOffset = novoOffset;
    
    // Feedback visual imediato no label do mês
    const mesLabelEl = document.getElementById('tv-mes-label');
    if (mesLabelEl) {
        mesLabelEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1 text-amber-300"></i> Carregando...`;
    }
    
    // Reinicia índices de rotação dos cards nos mapas para o novo mês
    tvMapaPeIndex = 0;
    tvMapaRmrIndex = 0;
    
    atualizarDadosTV();
}

function voltarMesAtualTV() {
    if (tvCarregandoDados || tvMesOffset === 0) return;
    tvMesOffset = 0;
    const mesLabelEl = document.getElementById('tv-mes-label');
    if (mesLabelEl) {
        mesLabelEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1 text-amber-300"></i> Carregando...`;
    }
    tvMapaPeIndex = 0;
    tvMapaRmrIndex = 0;
    atualizarDadosTV();
}

window.trocarMesTV = trocarMesTV;
window.voltarMesAtualTV = voltarMesAtualTV;

// -----------------------------------------------------------------------------
// MAPA 1: PERNAMBUCO POR MUNICÍPIO
// -----------------------------------------------------------------------------
async function renderizarMapaPE(cidades) {
    const svg = document.getElementById('tv-mapa-pe-svg');
    if (!svg) return;
    
    const geo = await carregarGeoDataPE();
    if (!geo) {
        svg.innerHTML = `<text x="500" y="170" fill="rgba(255,255,255,0.4)" text-anchor="middle" font-size="16">Carregando mapa de Pernambuco...</text>`;
        return;
    }
    
    const porIbge = new Map((cidades || []).map(c => [String(c.ibge), c]));
    tvRankingCidadesPE = (cidades || []).filter(c => (c.devolvido || 0) > 0).sort((a,b) => (b.devolvido || 0) - (a.devolvido || 0));
    if (tvRankingCidadesPE.length === 0 && cidades && cidades.length > 0) {
        tvRankingCidadesPE = [...cidades].sort((a,b) => (b.faturado || 0) - (a.faturado || 0));
    }
    
    const teto = tvRankingCidadesPE.reduce((m, c) => Math.max(m, c.devolvido || 0), 0);
    
    svg.innerHTML = geo.map(g => {
        const d = porIbge.get(String(g.ibge));
        const fill = (d && d.devolvido > 0) ? corDaEscalaTV(d.devolvido, teto) : COR_NEUTRA_TV;
        return `<path id="path-pe-${g.ibge}" d="${g.d}" fill="${fill}" stroke="#0a1650" stroke-width="0.4" class="pe-municipio-path" data-ibge="${g.ibge}" data-nome="${g.nome}" onmousemove="hoverCidadePE(event, '${g.ibge}')" onmouseleave="unhoverCidadePE()"></path>`;
    }).join('');
    
    atualizarCardCidadePE();
    iniciarRotacaoCardPE();
}

function iniciarRotacaoCardPE() {
    if (tvMapaPeInterval) clearInterval(tvMapaPeInterval);
    if (!tvRankingCidadesPE || tvRankingCidadesPE.length <= 1) return;
    
    tvMapaPeInterval = setInterval(() => {
        if (!tvMapaPeHoverIbge && tvSlideIndex === 0 && !tvPausado) {
            tvMapaPeIndex = (tvMapaPeIndex + 1) % tvRankingCidadesPE.length;
            atualizarCardCidadePE();
        }
    }, 4200);
}

function hoverCidadePE(event, ibge) {
    tvMapaPeHoverIbge = ibge;
    atualizarCardCidadePE();
    mostrarTooltipTVPE(event, ibge);
}

function unhoverCidadePE() {
    tvMapaPeHoverIbge = null;
    esconderTooltipTVPE();
    atualizarCardCidadePE();
}

function mostrarTooltipTVPE(e, ibge) {
    const tooltip = document.getElementById('tv-mapa-pe-tooltip');
    if (!tooltip) return;
    
    let cidadeSel = null;
    if (tvDadosCompletos?.cidades) {
        cidadeSel = tvDadosCompletos.cidades.find(c => String(c.ibge) === String(ibge));
    }
    if (!cidadeSel && geoDataPE) {
        const g = geoDataPE.find(x => String(x.ibge) === String(ibge));
        if (g) {
            cidadeSel = { cidade: g.nome, faturado: 0, devolvido: 0, taxa: 0, notasEntregues: 0, notasDevolvidas: 0, motivo: 'Sem devolução' };
        }
    }
    if (!cidadeSel) return;
    
    const isTvBlurred = document.body.classList.contains('role-tv-blurred');
    const elCidade = document.getElementById('tv-tooltip-pe-cidade');
    const elDados = document.getElementById('tv-tooltip-pe-dados');
    const elFat = document.getElementById('tv-tooltip-pe-faturado');
    const elExtra = document.getElementById('tv-tooltip-pe-extra');
    
    if (elCidade) elCidade.innerText = cidadeSel.cidade;
    if (elDados) {
        const devTxt = fmtBRL(cidadeSel.devolvido || 0);
        const taxaTxt = `${(cidadeSel.taxa || 0).toFixed(1)}%`;
        elDados.innerHTML = `devolvido <span class="${isTvBlurred ? 'monetary-blur' : ''}">${devTxt}</span> · taxa ${taxaTxt}`;
    }
    if (elFat) {
        const fatTxt = fmtBRL(cidadeSel.faturado || 0);
        elFat.innerHTML = `faturado <span class="${isTvBlurred ? 'monetary-blur' : ''}">${fatTxt}</span>`;
    }
    if (elExtra) {
        const ent = fmtNum(cidadeSel.notasEntregues || 0);
        const dev = fmtNum(cidadeSel.notasDevolvidas || 0);
        const mot = cidadeSel.motivo || '—';
        elExtra.innerText = `${ent} entregues · ${dev} devolvidas · motivo: ${mot}`;
    }
    
    tooltip.classList.remove('hidden');
    
    const containerElem = document.getElementById('tv-mapa-pe-container');
    if (containerElem) {
        const rect = containerElem.getBoundingClientRect();
        let x = e.clientX - rect.left + 15;
        let y = e.clientY - rect.top + 15;
        const tw = tooltip.offsetWidth || 210;
        const th = tooltip.offsetHeight || 90;
        if (x + tw > rect.width) x = e.clientX - rect.left - tw - 15;
        if (y + th > rect.height) y = e.clientY - rect.top - th - 15;
        tooltip.style.left = `${Math.max(5, x)}px`;
        tooltip.style.top = `${Math.max(5, y)}px`;
    }
}

function esconderTooltipTVPE() {
    const tooltip = document.getElementById('tv-mapa-pe-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
}

function atualizarCardCidadePE() {
    if (!tvRankingCidadesPE || tvRankingCidadesPE.length === 0) return;
    
    document.querySelectorAll('#tv-mapa-pe-svg .pe-municipio-path.foco').forEach(p => p.classList.remove('foco'));
    
    let cidadeSel = null;
    let contadorTexto = '';
    
    if (tvMapaPeHoverIbge) {
        const porIbge = new Map((tvDadosCompletos?.cidades || []).map(c => [String(c.ibge), c]));
        cidadeSel = porIbge.get(String(tvMapaPeHoverIbge));
        if (!cidadeSel && geoDataPE) {
            const g = geoDataPE.find(x => String(x.ibge) === String(tvMapaPeHoverIbge));
            if (g) cidadeSel = { cidade: g.nome, faturado: 0, devolvido: 0, taxa: 0, notasEntregues: 0, notasDevolvidas: 0, partFaturamento: 0, motivo: 'Sem devolução' };
        }
        contadorTexto = 'sob o cursor';
    } else {
        cidadeSel = tvRankingCidadesPE[tvMapaPeIndex % tvRankingCidadesPE.length];
        contadorTexto = `Cidade ${(tvMapaPeIndex % tvRankingCidadesPE.length) + 1} de ${tvRankingCidadesPE.length} · por volume`;
    }
    
    if (!cidadeSel) return;
    
    if (cidadeSel.ibge) {
        const pathEl = document.getElementById(`path-pe-${cidadeSel.ibge}`);
        if (pathEl) {
            pathEl.classList.add('foco');
            if (!tvMapaPeHoverIbge) {
                pathEl.parentNode.appendChild(pathEl);
            }
        }
    }
    
    const cardEl = document.getElementById('tv-mapa-pe-card');
    if (cardEl) {
        cardEl.classList.remove('card-fade');
        void cardEl.offsetWidth;
        cardEl.classList.add('card-fade');
    }
    
    const elContador = document.getElementById('tv-mapa-pe-card-contador');
    if (elContador) elContador.innerText = contadorTexto;
    
    const elCidade = document.getElementById('tv-mapa-pe-card-cidade');
    if (elCidade) elCidade.innerText = cidadeSel.cidade;
    
    const elFat = document.getElementById('tv-mapa-pe-card-faturado');
    if (elFat) elFat.innerText = fmtBRL(cidadeSel.faturado || 0);
    
    const elDev = document.getElementById('tv-mapa-pe-card-devolvido');
    if (elDev) elDev.innerText = fmtBRL(cidadeSel.devolvido || 0);
    
    const elTaxa = document.getElementById('tv-mapa-pe-card-taxa');
    if (elTaxa) elTaxa.innerText = `${(cidadeSel.taxa || 0).toFixed(1)}%`;
    
    const elNotas = document.getElementById('tv-mapa-pe-card-notas');
    if (elNotas) elNotas.innerHTML = `${fmtNum(cidadeSel.notasEntregues || 0)} / <span class="text-rose-300 font-extrabold">${fmtNum(cidadeSel.notasDevolvidas || 0)}</span>`;
    
    const elPart = document.getElementById('tv-mapa-pe-card-part');
    if (elPart) elPart.innerText = `${(cidadeSel.partFaturamento || 0).toFixed(1)}%`;
    
    const elMotivo = document.getElementById('tv-mapa-pe-card-motivo');
    if (elMotivo) elMotivo.innerText = cidadeSel.motivo || 'Não informado';
    
    if (document.body.classList.contains('role-tv-blurred')) {
        aplicarMascaraMonetariaGlobal();
    }
}

// -----------------------------------------------------------------------------
// MAPA 2: RMR POR BAIRRO
// -----------------------------------------------------------------------------
async function renderizarMapaRMR(cidades, bairros) {
    const svg = document.getElementById('tv-mapa-rmr-svg');
    if (!svg) return;
    
    const geo = await carregarGeoDataPE();
    if (!geo) return;
    
    const geoRMR = geo.filter(g => RMR_IBGES.has(String(g.ibge)));
    svg.setAttribute('viewBox', calcularViewBoxRMR(geoRMR));
    
    const porIbge = new Map((cidades || []).map(c => [String(c.ibge), c]));
    tvListaBairrosRMR = bairros || [];
    
    const tetoRmr = geoRMR.reduce((m, g) => Math.max(m, porIbge.get(String(g.ibge))?.devolvido || 0), 0);
    
    svg.innerHTML = geoRMR.map(g => {
        const d = porIbge.get(String(g.ibge));
        const fill = (d && d.devolvido > 0) ? corDaEscalaTV(d.devolvido, tetoRmr) : COR_NEUTRA_TV;
        return `<path id="path-rmr-${g.ibge}" d="${g.d}" fill="${fill}" stroke="#0a1650" stroke-width="0.8" class="pe-municipio-path" data-ibge="${g.ibge}" data-nome="${g.nome}" onmousemove="hoverMunicipioRMR(event, '${g.ibge}')" onmouseleave="unhoverMunicipioRMR()"></path>`;
    }).join('');
    
    atualizarCardBairroRMR();
    iniciarRotacaoCardRMR();
}

function iniciarRotacaoCardRMR() {
    if (tvMapaRmrInterval) clearInterval(tvMapaRmrInterval);
    if (!tvListaBairrosRMR || tvListaBairrosRMR.length <= 1) return;
    
    tvMapaRmrInterval = setInterval(() => {
        if (!tvMapaRmrHoverIbge && tvSlideIndex === 1 && !tvPausado) {
            tvMapaRmrIndex = (tvMapaRmrIndex + 1) % tvListaBairrosRMR.length;
            atualizarCardBairroRMR();
        }
    }, 4200);
}

function hoverMunicipioRMR(event, ibge) {
    tvMapaRmrHoverIbge = ibge;
    atualizarCardBairroRMR();
    mostrarTooltipTVRMR(event, ibge);
}

function unhoverMunicipioRMR() {
    tvMapaRmrHoverIbge = null;
    esconderTooltipTVRMR();
    atualizarCardBairroRMR();
}

function mostrarTooltipTVRMR(e, ibge) {
    const tooltip = document.getElementById('tv-mapa-rmr-tooltip');
    if (!tooltip) return;
    
    let cidadeSel = null;
    if (tvDadosCompletos?.cidades) {
        cidadeSel = tvDadosCompletos.cidades.find(c => String(c.ibge) === String(ibge));
    }
    if (!cidadeSel && geoDataPE) {
        const g = geoDataPE.find(x => String(x.ibge) === String(ibge));
        if (g) {
            cidadeSel = { cidade: g.nome, faturado: 0, devolvido: 0, taxa: 0, notasEntregues: 0, notasDevolvidas: 0, motivo: 'Sem devolução' };
        }
    }
    if (!cidadeSel) return;
    
    const isTvBlurred = document.body.classList.contains('role-tv-blurred');
    const elCidade = document.getElementById('tv-tooltip-rmr-cidade');
    const elDados = document.getElementById('tv-tooltip-rmr-dados');
    const elFat = document.getElementById('tv-tooltip-rmr-faturado');
    const elExtra = document.getElementById('tv-tooltip-rmr-extra');
    
    if (elCidade) elCidade.innerText = cidadeSel.cidade;
    if (elDados) {
        const devTxt = fmtBRL(cidadeSel.devolvido || 0);
        const taxaTxt = `${(cidadeSel.taxa || 0).toFixed(1)}%`;
        elDados.innerHTML = `devolvido <span class="${isTvBlurred ? 'monetary-blur' : ''}">${devTxt}</span> · taxa ${taxaTxt}`;
    }
    if (elFat) {
        const fatTxt = fmtBRL(cidadeSel.faturado || 0);
        elFat.innerHTML = `faturado <span class="${isTvBlurred ? 'monetary-blur' : ''}">${fatTxt}</span>`;
    }
    if (elExtra) {
        const ent = fmtNum(cidadeSel.notasEntregues || 0);
        const dev = fmtNum(cidadeSel.notasDevolvidas || 0);
        const mot = cidadeSel.motivo || '—';
        elExtra.innerText = `${ent} entregues · ${dev} devolvidas · motivo: ${mot}`;
    }
    
    tooltip.classList.remove('hidden');
    
    const containerElem = document.getElementById('tv-mapa-rmr-container');
    if (containerElem) {
        const rect = containerElem.getBoundingClientRect();
        let x = e.clientX - rect.left + 15;
        let y = e.clientY - rect.top + 15;
        const tw = tooltip.offsetWidth || 210;
        const th = tooltip.offsetHeight || 90;
        if (x + tw > rect.width) x = e.clientX - rect.left - tw - 15;
        if (y + th > rect.height) y = e.clientY - rect.top - th - 15;
        tooltip.style.left = `${Math.max(5, x)}px`;
        tooltip.style.top = `${Math.max(5, y)}px`;
    }
}

function esconderTooltipTVRMR() {
    const tooltip = document.getElementById('tv-mapa-rmr-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
}

function atualizarCardBairroRMR() {
    if (!tvListaBairrosRMR) return;
    
    document.querySelectorAll('#tv-mapa-rmr-svg .pe-municipio-path.foco').forEach(p => p.classList.remove('foco'));
    
    let focoIbge = null;
    const cardEl = document.getElementById('tv-mapa-rmr-card');
    if (cardEl) {
        cardEl.classList.remove('card-fade');
        void cardEl.offsetWidth;
        cardEl.classList.add('card-fade');
    }
    
    if (tvMapaRmrHoverIbge) {
        focoIbge = tvMapaRmrHoverIbge;
        const porIbge = new Map((tvDadosCompletos?.cidades || []).map(c => [String(c.ibge), c]));
        const c = porIbge.get(String(tvMapaRmrHoverIbge));
        const nomeCid = c ? c.cidade : (geoDataPE?.find(x => String(x.ibge) === String(tvMapaRmrHoverIbge))?.nome || 'Município');
        
        document.getElementById('tv-mapa-rmr-card-contador').innerText = 'sob o cursor (município)';
        document.getElementById('tv-mapa-rmr-card-bairro').innerText = nomeCid;
        document.getElementById('tv-mapa-rmr-card-cidade').innerText = 'Região Metropolitana do Recife';
        document.getElementById('tv-mapa-rmr-card-faturado').innerText = fmtBRL(c?.faturado || 0);
        document.getElementById('tv-mapa-rmr-card-devolvido').innerText = fmtBRL(c?.devolvido || 0);
        document.getElementById('tv-mapa-rmr-card-taxa').innerText = `${(c?.taxa || 0).toFixed(1)}%`;
        document.getElementById('tv-mapa-rmr-card-notas').innerHTML = `${fmtNum(c?.notasEntregues || 0)} / <span class="text-rose-300 font-extrabold">${fmtNum(c?.notasDevolvidas || 0)}</span>`;
        document.getElementById('tv-mapa-rmr-card-motivo').innerText = c?.motivo || 'Não informado';
    } else if (tvListaBairrosRMR.length > 0) {
        const b = tvListaBairrosRMR[tvMapaRmrIndex % tvListaBairrosRMR.length];
        if (b) {
            document.getElementById('tv-mapa-rmr-card-contador').innerText = `Bairro ${(tvMapaRmrIndex % tvListaBairrosRMR.length) + 1} de ${tvListaBairrosRMR.length} · por devolução`;
            document.getElementById('tv-mapa-rmr-card-bairro').innerText = b.bairro;
            document.getElementById('tv-mapa-rmr-card-cidade').innerText = b.cidade;
            document.getElementById('tv-mapa-rmr-card-faturado').innerText = fmtBRL(b.faturado || 0);
            document.getElementById('tv-mapa-rmr-card-devolvido').innerText = fmtBRL(b.devolvido || 0);
            document.getElementById('tv-mapa-rmr-card-taxa').innerText = `${(b.taxa || 0).toFixed(1)}%`;
            document.getElementById('tv-mapa-rmr-card-notas').innerHTML = `${fmtNum(b.notasFaturadas || 0)} / <span class="text-rose-300 font-extrabold">${fmtNum(b.notas || 0)}</span>`;
            document.getElementById('tv-mapa-rmr-card-motivo').innerText = b.motivo || 'Não informado';
            
            if (geoDataPE) {
                const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
                const g = geoDataPE.find(x => norm(x.nome) === norm(b.cidade));
                if (g) focoIbge = g.ibge;
            }
        }
    }
    
    if (focoIbge) {
        const pathEl = document.getElementById(`path-rmr-${focoIbge}`);
        if (pathEl) {
            pathEl.classList.add('foco');
            if (!tvMapaRmrHoverIbge) {
                pathEl.parentNode.appendChild(pathEl);
            }
        }
    }
    
    if (document.body.classList.contains('role-tv-blurred')) {
        aplicarMascaraMonetariaGlobal();
    }
}

// -----------------------------------------------------------------------------
// DADOS GERAIS DO PAINEL TV
// -----------------------------------------------------------------------------
async function atualizarDadosTV(forcarRefresh = false) {
    if (tvCarregandoDados) return;
    tvCarregandoDados = true;

    const icoRefresh = document.getElementById('tv-ico-refresh');
    if (icoRefresh) icoRefresh.classList.add('fa-spin');
    
    const btnNext = document.getElementById('tv-btn-mes-next');
    const btnPrev = document.getElementById('tv-btn-mes-prev');
    const btnMesAtual = document.getElementById('tv-btn-mes-atual');
    
    if (btnNext) {
        if (tvMesOffset >= 0) {
            btnNext.classList.add('opacity-30', 'cursor-not-allowed');
            btnNext.disabled = true;
        } else {
            btnNext.classList.remove('opacity-30', 'cursor-not-allowed');
            btnNext.disabled = false;
        }
    }
    
    if (btnMesAtual) {
        if (tvMesOffset < 0) {
            btnMesAtual.classList.remove('hidden');
        } else {
            btnMesAtual.classList.add('hidden');
        }
    }
    
    try {
        const queryParams = new URLSearchParams();
        if (tvMesOffset !== 0) queryParams.set('offset', tvMesOffset);
        if (forcarRefresh) queryParams.set('refresh', '1');
        
        const qs = queryParams.toString();
        const url = qs ? `/api/painel-tv?${qs}` : '/api/painel-tv';
        const res = await fetch(url);
        const data = await res.json();
        if (data.status !== 'ok') {
            console.error('Erro na resposta do painel-tv:', data);
            return;
        }
        
        tvDadosCompletos = data;
        
        // Relógio e Mês
        const relogioEl = document.getElementById('tv-relogio');
        if (relogioEl) relogioEl.innerText = data.atualizado_em || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const mesLabelEl = document.getElementById('tv-mes-label');
        if (mesLabelEl) mesLabelEl.innerText = data.mes_label || 'Mês Atual';
        
        // 1. Placar Topo (6 KPIs)
        const p = data.placar || {};
        const elPos = document.getElementById('tv-kpi-positivados');
        if (elPos) elPos.innerText = fmtNum(p.positivados || 0);
        
        const elEnt = document.getElementById('tv-kpi-entregas');
        if (elEnt) elEnt.innerText = fmtNum(p.entregas || 0);
        
        const elPeso = document.getElementById('tv-kpi-peso');
        if (elPeso) elPeso.innerText = `${(p.peso_faturado_ton || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t`;
        
        const elTaxa = document.getElementById('tv-kpi-taxa-dev');
        if (elTaxa) elTaxa.innerText = `${(p.taxa_devolucao || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
        
        const elCart = document.getElementById('tv-kpi-carteira');
        if (elCart) elCart.innerText = fmtNum(p.carteira_pedidos || 0);
        const elCartHint = document.getElementById('tv-kpi-carteira-hint');
        if (elCartHint) elCartHint.innerText = `${fmtBRL(p.carteira_valor || 0)} a faturar`;
        
        // 2. SetorBar
        const porSetor = data.por_setor || [];
        const totSetor = porSetor.reduce((s, it) => s + (it.valor || 0), 0) || 1;
        const barColors = {
            'Logística': '#4b57c4',
            'Comercial': '#f5b301',
            'Faturamento': '#fb7185',
            'Não classificado': '#64748b'
        };
        const chipClasses = {
            'Logística': 'bg-[#2a327f] text-indigo-100',
            'Comercial': 'bg-amber-400/20 text-amber-200',
            'Faturamento': 'bg-rose-400/20 text-rose-200',
            'Não classificado': 'bg-slate-400/20 text-slate-200'
        };
        
        const track = document.getElementById('tv-setorbar-track');
        const chipsContainer = document.getElementById('tv-setorbar-chips');
        if (track && porSetor.length > 0) {
            track.innerHTML = porSetor.map(s => {
                const cor = barColors[s.setor] || '#64748b';
                const pct = ((s.valor / totSetor) * 100).toFixed(1);
                return `<div style="width: ${pct}%; background: ${cor};" title="${s.setor}: ${pct}%"></div>`;
            }).join('');
        }
        if (chipsContainer && porSetor.length > 0) {
            chipsContainer.innerHTML = porSetor.map(s => {
                const chipCls = chipClasses[s.setor] || 'bg-slate-400/20 text-slate-200';
                const pct = ((s.valor / totSetor) * 100).toFixed(1);
                return `
                    <span class="inline-flex items-center gap-1.5 text-white/70">
                        <span class="rounded-full px-2 py-0.5 text-[10px] font-bold ${chipCls}">${s.setor}</span>
                        <span class="font-bold text-white">${pct}%</span>
                        <span class="text-white/40">(${fmtBRL(s.valor)})</span>
                    </span>
                `;
            }).join('');
        }
        
        // 3. Taxa PE Geral (Headline do Slide 0)
        const elTaxaPe = document.getElementById('tv-mapa-pe-taxa-geral');
        if (elTaxaPe) elTaxaPe.innerText = `${(data.taxa_pe_geral || 0).toFixed(1)}%`;
        
        // 4. Renderiza Mapas (Slide 0 e Slide 1)
        await renderizarMapaPE(data.cidades || []);
        await renderizarMapaRMR(data.cidades || [], data.bairros_rmr || []);
        
        // 5. Slide 2: Motoristas (Dual Column Top 10)
        const motLista = data.motoristas || [];
        const elMotContainer = document.getElementById('tv-motoristas-duas-colunas');
        if (elMotContainer) {
            if (motLista.length === 0) {
                elMotContainer.innerHTML = `<div class="col-span-2 py-10 text-center text-white/40">Nenhuma ocorrência de devolução por motorista registrada no período.</div>`;
            } else {
                const colEsq = motLista.slice(0, 5);
                const colDir = motLista.slice(5, 10);
                
                const renderCardMotorista = (m, i, offset) => {
                    const idxReal = offset + i;
                    const ehDaCasa = (m.tipo || '').toUpperCase().includes('FROTA') || (m.tipo || '').toUpperCase() === 'F';
                    const tagTipo = ehDaCasa 
                        ? `<span class="rounded-full bg-[#2a327f] px-2 py-0.5 text-[10px] font-bold text-indigo-100">Da casa</span>`
                        : `<span class="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-200">Terceirizado</span>`;
                    return `
                        <div class="flex items-center justify-between py-3 border-b border-white/10">
                            <div class="flex items-center gap-3 min-w-0">
                                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${idxReal === 0 ? 'bg-amber-400 text-[#0a1650]' : 'bg-white/10 text-white/60'}">${idxReal + 1}</span>
                                <div class="truncate">
                                    <div class="text-sm font-bold text-white truncate" title="${m.nome}">${m.nome}</div>
                                    <div class="flex items-center gap-2 mt-0.5">
                                        ${tagTipo}
                                        <span class="text-[11px] text-white/45">${m.devolvidas || 0} de ${m.expedidas || 0} entregas</span>
                                    </div>
                                </div>
                            </div>
                            <div class="text-right shrink-0 ml-3">
                                <div class="text-sm font-extrabold text-rose-300 tabular-nums">${fmtBRL(m.valor || 0)}</div>
                                <div class="text-[11px] text-white/50">${(m.taxa || 0).toFixed(1)}% taxa</div>
                            </div>
                        </div>
                    `;
                };
                
                elMotContainer.innerHTML = `
                    <div class="flex flex-col pr-0 lg:pr-6">
                        ${colEsq.map((m, i) => renderCardMotorista(m, i, 0)).join('')}
                    </div>
                    <div class="flex flex-col border-t border-white/10 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                        ${colDir.map((m, i) => renderCardMotorista(m, i, 5)).join('')}
                    </div>
                `;
            }
        }
        
        // 6. Slide 3: Devoluções & Motivos
        const dev = data.devolucoes || {};
        const elDevSetores = document.getElementById('tv-devolucoes-setores-cards');
        if (elDevSetores) {
            elDevSetores.innerHTML = (dev.por_setor || []).map(s => {
                const cor = barColors[s.setor] || '#64748b';
                const chipCls = chipClasses[s.setor] || 'bg-slate-400/20 text-slate-200';
                return `
                    <div class="p-3.5 rounded-2xl bg-white/[0.05] ring-1 ring-white/10 flex flex-col gap-2">
                        <div class="flex justify-between items-center">
                            <span class="rounded-full px-2.5 py-0.5 text-xs font-bold ${chipCls}">${s.setor}</span>
                            <span class="font-extrabold text-base text-rose-300 tabular-nums">${fmtBRL(s.valor)}</span>
                        </div>
                        <div class="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                            <div class="h-full rounded-full" style="width: ${s.perc}%; background: ${cor};"></div>
                        </div>
                        <div class="flex justify-between text-[11px] text-white/40">
                            <span>Participação no retorno</span>
                            <span class="font-bold text-white/80">${s.perc}%</span>
                        </div>
                    </div>
                `;
            }).join('');
        }
        
        const elDevMotivos = document.getElementById('tv-devolucoes-motivos-ranking');
        if (elDevMotivos) {
            const motivos = dev.top_motivos || [];
            if (motivos.length === 0) {
                elDevMotivos.innerHTML = `<div class="py-6 text-center text-white/40 text-xs">Sem motivos no período</div>`;
            } else {
                elDevMotivos.innerHTML = motivos.slice(0, 6).map((m, i) => {
                    const chipCls = chipClasses[m.setor] || 'bg-slate-400/20 text-slate-200';
                    return `
                        <div class="flex items-center justify-between py-2.5">
                            <div class="flex items-center gap-2.5 min-w-0">
                                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? 'bg-amber-400 text-[#0a1650]' : 'bg-white/10 text-white/60'}">${i + 1}</span>
                                <div class="truncate">
                                    <div class="text-xs font-bold text-white truncate" title="${m.motivo}">${m.motivo}</div>
                                    <span class="rounded-full px-2 py-0.2 text-[9px] font-bold ${chipCls}">${m.setor}</span>
                                </div>
                            </div>
                            <div class="text-right shrink-0 ml-3">
                                <div class="text-xs font-extrabold text-rose-300">${fmtBRL(m.valor)}</div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // 7. Slide 4: A Faturar
        const af = data.a_faturar || {};
        const elAfPed = document.getElementById('tv-afaturar-pedidos');
        if (elAfPed) elAfPed.innerText = `${fmtNum(af.total_pedidos || 0)} pedidos`;
        const elAfPeso = document.getElementById('tv-afaturar-peso');
        if (elAfPeso) elAfPeso.innerText = `${fmtKg(af.peso_total || 0)} · ${fmtBRL(af.valor_total || 0)}`;
        
        const cidadesMap = {};
        (af.top_parados || []).forEach(p => {
            const c = p.cidade_cliente || 'Recife';
            cidadesMap[c] = (cidadesMap[c] || 0) + 1;
        });
        const cidadesLista = Object.entries(cidadesMap).sort((a,b) => b[1] - a[1]);
        const elAfCidades = document.getElementById('tv-afaturar-cidades');
        if (elAfCidades) {
            if (cidadesLista.length === 0) {
                elAfCidades.innerHTML = `<div class="py-6 text-center text-white/40 text-xs">Sem cidades pendentes</div>`;
            } else {
                elAfCidades.innerHTML = cidadesLista.slice(0, 6).map(([cid, qtd], i) => `
                    <div class="flex items-center justify-between py-2.5">
                        <div class="flex items-center gap-3">
                            <span class="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? 'bg-amber-400 text-[#0a1650]' : 'bg-white/10 text-white/70'}">${i + 1}</span>
                            <span class="text-sm font-semibold text-white">${cid}</span>
                        </div>
                        <div class="text-right">
                            <span class="text-sm font-bold text-amber-300">${qtd} pedidos</span>
                        </div>
                    </div>
                `).join('');
            }
        }
        
        const elAfParados = document.getElementById('tv-afaturar-parados');
        if (elAfParados) {
            const parados = af.top_parados || [];
            if (parados.length === 0) {
                elAfParados.innerHTML = `<div class="py-6 text-center text-white/40 text-xs">Nenhum pedido retido</div>`;
            } else {
                elAfParados.innerHTML = parados.slice(0, 5).map((p, i) => `
                    <div class="flex items-center justify-between py-2">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? 'bg-rose-500 text-white' : 'bg-white/10 text-white/60'}">${i + 1}</span>
                            <div class="truncate">
                                <div class="text-xs font-bold text-white truncate">#${p.numero_pedido} · ${p.nome_cliente || 'Cliente'}</div>
                                <div class="text-[10px] text-white/40 truncate">${p.cidade_cliente || ''} · RCA: ${p.nome_rca || ''}</div>
                            </div>
                        </div>
                        <div class="text-right shrink-0 ml-3">
                            <div class="text-xs font-bold text-amber-300">${fmtBRL(p.valor_pedido || 0)}</div>
                            <div class="text-[10px] font-semibold ${p.horas_parado > 72 ? 'text-rose-400' : 'text-white/50'}">${tempoParadoFmt(p.horas_parado || 0)} parado</div>
                        </div>
                    </div>
                `).join('');
            }
        }
        
        if (document.body.classList.contains('role-tv-blurred')) {
            aplicarMascaraMonetariaGlobal();
        }
        
    } catch (err) {
        console.error('Erro ao atualizar TV:', err);
    } finally {
        tvCarregandoDados = false;
        if (icoRefresh) icoRefresh.classList.remove('fa-spin');
    }
}


// Atalhos globais de teclado no Modo TV
document.addEventListener('keydown', function(e) {
    const overlay = document.getElementById('painel-tv-overlay');
    if (!overlay || overlay.style.display === 'none') return;
    
    if (e.key === 'ArrowRight') {
        trocarSlideTV(1);
    } else if (e.key === 'ArrowLeft') {
        trocarSlideTV(-1);
    } else if (e.key === ' ') {
        e.preventDefault();
        togglePausarTV();
    } else if (e.key.toLowerCase() === 'f') {
        toggleFullscreenTV();
    } else if (e.key === 'Escape') {
        fecharModoTV();
    }
});

// =============================================================================
// 7. SISTEMA DE AUTENTICAÇÃO E PERFIS DE USUÁRIO (DIA DISTRIBUIÇÃO)
// =============================================================================
let usuarioAtual = null;

function toggleMostrarSenha() {
    const input = document.getElementById('login-senha');
    const btn = document.getElementById('btn-toggle-senha');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerText = 'ocultar';
    } else {
        input.type = 'password';
        btn.innerText = 'mostrar';
    }
}

async function verificarAutenticacao() {
    const telaLogin = document.getElementById('tela-login-dia');
    
    // 1. Tenta recuperar usuário do localStorage primeiro para carregamento instantâneo
    const cachedUser = localStorage.getItem('usuario_logado');
    if (cachedUser) {
        try {
            usuarioAtual = JSON.parse(cachedUser);
            atualizarUIPerfil(usuarioAtual);
            if (telaLogin) telaLogin.style.display = 'none';
        } catch (e) {
            localStorage.removeItem('usuario_logado');
        }
    } else {
        if (telaLogin) telaLogin.style.display = 'flex';
    }
    
    // 2. Valida com a API /api/auth/me
    try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.status === 'ok' && data.user) {
            usuarioAtual = data.user;
            localStorage.setItem('usuario_logado', JSON.stringify(usuarioAtual));
            atualizarUIPerfil(usuarioAtual);
            if (telaLogin) telaLogin.style.display = 'none';
        } else {
            // Sem sessão no servidor, o usuário guardado no navegador não vale mais.
            usuarioAtual = null;
            localStorage.removeItem('usuario_logado');
            window.__sessaoExpirada = true;
            if (telaLogin) telaLogin.style.display = 'flex';
        }
    } catch (err) {
        console.warn('Erro ao verificar sessão com o servidor:', err);
        if (!cachedUser && telaLogin) {
            telaLogin.style.display = 'flex';
        }
    }
}

async function realizarLogin(event) {
    if (event) event.preventDefault();
    
    const identInput = document.getElementById('login-identificador');
    const senhaInput = document.getElementById('login-senha');
    const alertaErro = document.getElementById('login-erro-alerta');
    const textoErro = document.getElementById('login-erro-texto');
    const btnSubmit = document.getElementById('btn-login-submit');
    const labelSubmit = document.getElementById('btn-login-label');
    const iconSubmit = document.getElementById('btn-login-icon');
    
    if (alertaErro) alertaErro.classList.add('hidden');
    
    const identificador = (identInput?.value || '').trim();
    const senha = (senhaInput?.value || '').trim();
    
    if (!identificador || !senha) {
        if (alertaErro && textoErro) {
            textoErro.innerText = 'Preencha o e-mail/usuário e a senha.';
            alertaErro.classList.remove('hidden');
        }
        return;
    }
    
    // Estado de carregamento
    if (btnSubmit) btnSubmit.disabled = true;
    if (labelSubmit) labelSubmit.innerText = 'Autenticando...';
    if (iconSubmit) iconSubmit.className = 'fa-solid fa-spinner fa-spin text-xs';
    
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identificador, senha })
        });
        const data = await res.json();
        
        if (data.status === 'ok' && data.user) {
            usuarioAtual = data.user;
            localStorage.setItem('usuario_logado', JSON.stringify(usuarioAtual));
            // Dados pedidos antes do login voltaram 401: recarrega para buscá-los já autenticado.
            if (window.__sessaoExpirada) {
                location.reload();
                return;
            }
            atualizarUIPerfil(usuarioAtual);

            // Oculta tela de login
            const telaLogin = document.getElementById('tela-login-dia');
            if (telaLogin) telaLogin.style.display = 'none';
            
            // Limpa senha
            if (senhaInput) senhaInput.value = '';
            
            // Redimensiona mapa caso esteja visível
            if (window.mapaTelemetria) {
                setTimeout(() => window.mapaTelemetria.invalidateSize(), 200);
            }
        } else {
            if (alertaErro && textoErro) {
                textoErro.innerText = data.message || 'Credenciais inválidas.';
                alertaErro.classList.remove('hidden');
            }
        }
    } catch (err) {
        if (alertaErro && textoErro) {
            textoErro.innerText = 'Falha ao conectar com o servidor.';
            alertaErro.classList.remove('hidden');
        }
    } finally {
        if (btnSubmit) btnSubmit.disabled = false;
        if (labelSubmit) labelSubmit.innerText = 'Entrar no painel';
        if (iconSubmit) iconSubmit.className = 'fa-solid fa-arrow-right text-xs transition-transform group-hover:translate-x-1';
    }
}

async function fazerLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    localStorage.removeItem('usuario_logado');
    usuarioAtual = null;
    document.body.classList.remove('role-tv-blurred');
    document.documentElement.classList.remove('role-tv-blurred');
    
    if (typeof fecharModoTV === 'function') {
        try { fecharModoTV(); } catch (e) {}
    }
    
    // Exibe tela de login
    const telaLogin = document.getElementById('tela-login-dia');
    if (telaLogin) {
        telaLogin.style.display = 'flex';
        const alertaErro = document.getElementById('login-erro-alerta');
        if (alertaErro) alertaErro.classList.add('hidden');
        const senhaInput = document.getElementById('login-senha');
        if (senhaInput) senhaInput.value = '';
        const identInput = document.getElementById('login-identificador');
        if (identInput) {
            identInput.value = '';
            identInput.focus();
        }
    }
}
window.fazerLogout = fazerLogout;

// Vincula evento de clique no botão de logout da sidebar
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-logout-sidebar');
    if (btn) {
        btn.onclick = (e) => {
            if (e) e.preventDefault();
            fazerLogout();
        };
    }
});

function atualizarUIPerfil(user) {
    if (!user) return;
    
    const roleBadge = document.getElementById('user-role-badge');
    const nomeDisplay = document.getElementById('user-nome-display');
    const emailDisplay = document.getElementById('user-email-display');
    
    const isAdmin = user.role === 'admin';
    const isTvBlurred = user.role === 'tv_blurred' || user.usuario === 'tv.geral';
    
    if (isTvBlurred) {
        document.body.classList.add('role-tv-blurred');
        document.documentElement.classList.add('role-tv-blurred');
    } else {
        document.body.classList.remove('role-tv-blurred');
        document.documentElement.classList.remove('role-tv-blurred');
    }
    
    if (roleBadge) {
        if (isAdmin) {
            roleBadge.innerText = 'ADMIN';
            roleBadge.className = 'bg-amber-400/90 text-[#141a4d] text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider';
        } else if (isTvBlurred) {
            roleBadge.innerText = 'TV (APENAS QUANTITATIVOS)';
            roleBadge.className = 'bg-sky-500/80 text-white text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider';
        } else {
            roleBadge.innerText = 'SOMENTE LEITURA';
            roleBadge.className = 'bg-white/10 text-white/70 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider';
        }
    }
    
    if (nomeDisplay) {
        nomeDisplay.innerText = user.nome || user.usuario || 'Usuário DIA';
    }
    
    if (emailDisplay) {
        emailDisplay.innerText = user.email || user.usuario || '';
        emailDisplay.title = user.email || user.usuario || '';
    }
    
    if (isTvBlurred) {
        aplicarMascaraMonetariaGlobal();
    }
}

function aplicarMascaraMonetariaGlobal() {
    if (!document.body.classList.contains('role-tv-blurred')) return;
    
    const idsMonetarios = [
        'kpi-faturar-valor', 'tv-placar-carteira',
        'kpi-dev-valor-total', 'tv-afaturar-peso',
        'tv-mapa-pe-card-faturado', 'tv-mapa-pe-card-devolvido',
        'tv-mapa-rmr-card-faturado', 'tv-mapa-rmr-card-devolvido',
        'tv-kpi-carteira-hint'
    ];
    idsMonetarios.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('monetary-blur');
    });
    
    const todos = document.querySelectorAll('td, span, div, p, h1, h2, h3, h4, strong, b');
    todos.forEach(el => {
        if (el.children.length === 0 && el.textContent && el.textContent.includes('R$')) {
            el.classList.add('monetary-blur');
        }
    });
}

// Observer para re-aplicar o blur caso novas tabelas ou modais sejam renderizados
let mascaraObserverTimeout = null;
const observerMascara = new MutationObserver(() => {
    if (document.body.classList.contains('role-tv-blurred')) {
        if (mascaraObserverTimeout) clearTimeout(mascaraObserverTimeout);
        mascaraObserverTimeout = setTimeout(aplicarMascaraMonetariaGlobal, 150);
    }
});
observerMascara.observe(document.body, { childList: true, subtree: true });

// Inicializa verificação de sessão assim que o DOM carregar
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', verificarAutenticacao);
} else {
    verificarAutenticacao();
}

// =============================================================================
// 8. UTILITÁRIOS DE DATA (NAVEGAÇÃO POR MÊS DO DASHBOARD)
// =============================================================================
const MESES_NOMES_PT = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function mesAtualISO() {
    return new Date().toISOString().slice(0, 7);
}

function formatarMesAnoLongo(mesIso) {
    if (!mesIso || mesIso.length < 7) return '—';
    const [a, m] = mesIso.slice(0, 7).split('-').map(Number);
    return `${MESES_NOMES_PT[(m || 1) - 1]} de ${a}`;
}

function deslocarMesISO(mesIso, delta) {
    const [a, m] = mesIso.slice(0, 7).split('-').map(Number);
    const dt = new Date(a, (m - 1) + delta, 1);
    const novoAno = dt.getFullYear();
    const novoMes = String(dt.getMonth() + 1).padStart(2, '0');
    const res = `${novoAno}-${novoMes}`;
    if (res < '2026-07') return '2026-07';
    const lim = mesAtualISO();
    if (res > lim) return lim;
    return res;
}

function renderMesNavHTML(mesIso, fnTrocarStr) {
    const atual = mesAtualISO();
    const noInicio = mesIso <= '2026-07';
    const noFim = mesIso >= atual;
    return `
        <div class="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <button type="button" aria-label="Mês anterior" onclick="${fnTrocarStr}('${deslocarMesISO(mesIso, -1)}')" ${noInicio ? 'disabled' : ''} class="h-8 w-8 flex items-center justify-center text-xs rounded-lg transition ${noInicio ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-slate-100 cursor-pointer'}"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
            <span class="px-3 py-1 text-xs font-bold text-[#141a4d] min-w-[130px] text-center" aria-live="polite">${formatarMesAnoLongo(mesIso)}</span>
            <button type="button" aria-label="Próximo mês" onclick="${fnTrocarStr}('${deslocarMesISO(mesIso, 1)}')" ${noFim ? 'disabled' : ''} class="h-8 w-8 flex items-center justify-center text-xs rounded-lg transition ${noFim ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-slate-100 cursor-pointer'}"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
            ${mesIso !== atual ? `<button type="button" onclick="${fnTrocarStr}('${atual}')" class="ml-1 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200 transition cursor-pointer">Atual</button>` : ''}
        </div>
    `;
}

// =============================================================================
// 9. ABA 1: DASHBOARD (VISÃO GERAL)
// =============================================================================
let estadoDashboardMes = mesAtualISO();

async function carregarDashboardVisaoGeral(mesOpcional) {
    if (mesOpcional) estadoDashboardMes = mesOpcional;
    const container = document.getElementById('conteudo-dashboard');
    if (!container) return;

    // Esqueleto com o mesmo desenho da tela final, para nada "pular" quando os dados chegam
    const cartaoEsqueleto = `
        <div class="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
            <div class="esqueleto h-3 w-28"></div>
            <div class="esqueleto h-7 w-40 mt-3"></div>
            <div class="esqueleto h-3 w-24 mt-3"></div>
        </div>`;
    container.innerHTML = `
        <div class="flex items-center justify-between gap-3" aria-busy="true">
            <p class="text-sm text-slate-500">Carregando <span class="font-semibold text-[#141a4d]">${formatarMesAnoLongo(estadoDashboardMes)}</span>…</p>
            <div class="esqueleto h-10 w-56 rounded-xl"></div>
        </div>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div class="esqueleto h-[136px] rounded-2xl lg:col-span-2"></div>
            ${cartaoEsqueleto}
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${cartaoEsqueleto.repeat(6)}
        </div>
    `;

    try {
        const res = await fetch(`/api/dashboard-visao-geral?mes=${estadoDashboardMes}`);
        const data = await res.json();
        if (data.status !== 'ok') throw new Error(data.message || 'Erro ao carregar dashboard');
        renderizarDashboardVisaoGeral(data);
    } catch (e) {
        container.innerHTML = `<div class="bg-rose-50 border border-rose-200 text-rose-700 p-5 rounded-2xl text-sm">Erro ao carregar Visão Geral: ${e.message}</div>`;
    }
}

function mudarMesDashboard(novoMes) {
    estadoDashboardMes = novoMes;
    carregarDashboardVisaoGeral(novoMes);
}

function renderizarDashboardVisaoGeral(data) {
    window._ultimosDadosDashboard = data;
    const container = document.getElementById('conteudo-dashboard');
    if (!container) return;

    const fat = data.faturamento;
    const rotuloPeriodo = `${formatarMesAnoLongo(data.mes)}${data.ehMesAtual ? ' · em andamento' : ' · mês fechado'}`;

    // Bloco Faturamento (WinThor)
    let htmlFaturamento = '';
    if (!fat || !fat.disponivel) {
        htmlFaturamento = `
            <div class="rounded-2xl border border-amber-200 bg-amber-50/70 px-5 py-4 text-sm text-amber-900">
                <span class="font-semibold">Faturamento (WinThor) indisponível</span> — verifique a conexão com o Oracle para exibir os dados fiscais de ${rotuloPeriodo}.
            </div>
        `;
    } else {
        const taxaDevPerc = (Number(fat.taxaDevolucao || 0) * 100).toFixed(2).replace('.', ',') + '%';
        const taxaNotasPerc = (Number(fat.taxaDevolucaoNotas || 0) * 100).toFixed(2).replace('.', ',') + '%';
        const pesoTons = (Number(fat.pesoFaturado || 0) / 1000).toFixed(1).replace('.', ',') + ' t';

        htmlFaturamento = `
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                        <span class="h-4 w-1 rounded-full bg-amber-400"></span>
                        <h2 class="text-xs font-bold uppercase tracking-[0.18em] text-[#141a4d]">Faturamento</h2>
                    </div>
                    <span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> WinThor ao vivo
                    </span>
                </div>

                <!-- Hero Venda Faturada (2/3) + Devolução (1/3) -->
                <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <div class="relative overflow-hidden rounded-2xl p-6 text-white shadow-lg lg:col-span-2" style="background: linear-gradient(125deg, #141a4d 0%, #1f266c 55%, #2a327f 100%);">
                        <div class="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full opacity-25 blur-2xl" style="background: radial-gradient(circle, #f5b301 0%, transparent 70%);"></div>
                        <div class="relative flex items-start justify-between gap-4">
                            <div>
                                <div class="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Venda faturada</div>
                                <div class="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl tabular-nums">${fmtBRL(fat.vendaFaturada)}</div>
                                <div class="mt-2 text-xs text-white/60">Filiais 1 e 11 consolidadas · líquido de ST, IPI e bonificação</div>
                            </div>
                            <span class="shrink-0 whitespace-nowrap rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-amber-200 ring-1 ring-white/15">Rotina 111</span>
                        </div>
                    </div>

                    <div onclick="irParaAbaSistema('aba-devolucoes-detalhe')" class="group cursor-pointer relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                        <div class="absolute inset-x-0 top-0 h-1 bg-rose-500"></div>
                        <div class="flex items-center justify-between">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-400">Valor devolução</div>
                            <span class="text-xs font-semibold text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[#141a4d]">detalhar →</span>
                        </div>
                        <div class="mt-2 text-3xl font-bold tracking-tight text-[#141a4d] tabular-nums">${fmtBRL(fat.valorDevolucao)}</div>
                        <div class="mt-2 flex items-center gap-2 text-xs text-slate-400">
                            <span>líquido · rotina 111</span>
                            <span class="rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-600">${taxaDevPerc} da faturada</span>
                        </div>
                    </div>
                </div>

                <!-- 6 KPIs Secundários (3x2) -->
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div class="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm border-t-4 border-t-emerald-500">
                        <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Venda líquida</span>
                        <div class="mt-2 text-2xl font-extrabold text-[#141a4d] tabular-nums">${fmtBRL(fat.vendaLiquida)}</div>
                        <div class="mt-1 text-xs text-slate-400">${fat.valorDevolucaoAvulsa > 0 ? 'faturada − devolução − avulsa' : 'faturada − devolução'}</div>
                    </div>
                    <div class="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm border-t-4 border-t-amber-400">
                        <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Entregas realizadas</span>
                        <div class="mt-2 text-2xl font-extrabold text-[#141a4d] tabular-nums">${fmtNum(fat.atendimentos)}</div>
                        <div class="mt-1 text-xs text-slate-400">clientes atendidos no mês</div>
                    </div>
                    <div class="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm border-t-4 border-t-[#141a4d]">
                        <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Peso faturado</span>
                        <div class="mt-2 text-2xl font-extrabold text-[#141a4d] tabular-nums">${fmtKg(fat.pesoFaturado)}</div>
                        <div class="mt-1 text-xs text-slate-400">${pesoTons}</div>
                    </div>
                    <div onclick="irParaAbaSistema('aba-pedidos-consulta')" class="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm cursor-pointer hover:border-slate-300 transition">
                        <span class="text-xs font-bold uppercase tracking-wider text-slate-400">NFs emitidas</span>
                        <div class="mt-2 text-2xl font-extrabold text-[#141a4d] tabular-nums">${fmtNum(fat.emitidas)}</div>
                        <div class="mt-1 text-xs text-slate-400">consultar rotina 335 →</div>
                    </div>
                    <div onclick="irParaAbaSistema('aba-devolucoes-detalhe')" class="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm border-t-4 border-t-rose-500 cursor-pointer hover:border-slate-300 transition">
                        <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Taxa de devolução</span>
                        <div class="mt-2 text-2xl font-extrabold text-[#141a4d] tabular-nums">${taxaDevPerc}</div>
                        <div class="mt-1 text-xs text-slate-400">NFs: ${taxaNotasPerc} (${fmtNum(fat.devolvidas)})</div>
                    </div>
                    <div class="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm border-t-4 border-t-amber-400">
                        <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Clientes positivados</span>
                        <div class="mt-2 text-2xl font-extrabold text-[#141a4d] tabular-nums">${fmtNum(fat.positivados)}</div>
                        <div class="mt-1 text-xs text-slate-400">clientes com NF no mês</div>
                    </div>
                </div>
            </div>
        `;
    }

    // Rodapé — Detalhamento do mês · WinThor
    let htmlRodapeWinthor = '';
    if (fat && fat.disponivel) {
        const pesoFatTons = (Number(fat.pesoFaturado || 0) / 1000).toFixed(1).replace('.', ',');
        const pesoDevTons = (Number(fat.pesoDevolucao || 0) / 1000).toFixed(1).replace('.', ',');
        htmlRodapeWinthor = `
            <div class="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm">
                <div class="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                    <div class="flex items-center gap-2.5">
                        <span class="h-4 w-1 rounded-full bg-amber-400"></span>
                        <h2 class="text-sm font-bold uppercase tracking-wider text-[#141a4d]">Detalhamento do mês · WinThor</h2>
                    </div>
                </div>
                <dl class="grid grid-cols-1 gap-x-8 divide-y divide-slate-100 text-sm sm:grid-cols-2">
                    <div class="flex justify-between py-2.5">
                        <dt class="text-slate-500">NFs emitidas</dt>
                        <dd class="font-semibold text-slate-800 tabular-nums">${fmtNum(fat.emitidas)}</dd>
                    </div>
                    <div class="flex justify-between py-2.5">
                        <dt class="text-slate-500">NFs devolvidas</dt>
                        <dd class="font-semibold text-slate-800 tabular-nums">${fmtNum(fat.devolvidas)} (${(Number(fat.taxaDevolucaoNotas || 0) * 100).toFixed(2).replace('.', ',')}%)</dd>
                    </div>
                    <div class="flex justify-between py-2.5">
                        <dt class="text-slate-500">Devolução avulsa</dt>
                        <dd class="font-semibold text-slate-800 tabular-nums">${fmtBRL(fat.valorDevolucaoAvulsa)} · ${fmtNum(fat.devolvidasAvulsas)} NFs</dd>
                    </div>
                    <div class="flex justify-between py-2.5">
                        <dt class="text-slate-500">Clientes positivados</dt>
                        <dd class="font-semibold text-slate-800 tabular-nums">${fmtNum(fat.positivados)}</dd>
                    </div>
                    <div class="flex justify-between py-2.5">
                        <dt class="text-slate-500">Peso faturado</dt>
                        <dd class="font-semibold text-slate-800 tabular-nums">${fmtKg(fat.pesoFaturado)} (${pesoFatTons} t)</dd>
                    </div>
                    <div class="flex justify-between py-2.5">
                        <dt class="text-slate-500">Peso devolvido</dt>
                        <dd class="font-semibold text-slate-800 tabular-nums">${fmtKg(fat.pesoDevolucao)} (${pesoDevTons} t)</dd>
                    </div>
                </dl>
            </div>
        `;
    }

    container.innerHTML = `
        <!-- Período da Visão Geral -->
        <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm text-slate-500">Período: <span class="font-semibold text-[#141a4d]">${rotuloPeriodo}</span></p>
            ${renderMesNavHTML(data.mes, 'mudarMesDashboard')}
        </div>

        ${htmlFaturamento}

        ${htmlRodapeWinthor}
    `;
}


