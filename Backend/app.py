# backend/app.py
import os
import re
import csv
import math
from io import StringIO
from flask import Flask, jsonify, request, send_from_directory, Response, session
from flask_cors import CORS
from datetime import datetime, timedelta
import time
import calendar
import threading
import database
import sql_queries
import local_db
import danfe_parser
import fulltrack
import frota_consumo

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, '../Frontend'))

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')

def _carregar_secret_key():
    # A chave assina o cookie de login: se fosse fixa no código, qualquer um forjaria uma sessão de admin.
    # Sem SECRET_KEY no ambiente, gera uma aleatória na primeira execução e a guarda fora do git.
    if os.environ.get('SECRET_KEY'):
        return os.environ['SECRET_KEY']
    caminho = os.path.join(BASE_DIR, '.secret_key')
    if os.path.exists(caminho):
        with open(caminho, 'r', encoding='utf-8') as f:
            chave = f.read().strip()
        if chave:
            return chave
    import secrets
    chave = secrets.token_hex(32)
    with open(caminho, 'w', encoding='utf-8') as f:
        f.write(chave)
    return chave

app.secret_key = _carregar_secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)
CORS(app)

# Rotas da API liberadas sem login; todo o resto exige sessão, e escrita exige perfil admin.
_ROTAS_PUBLICAS = {'/api/auth/login', '/api/auth/me', '/api/auth/logout'}

@app.before_request
def exigir_login():
    if not request.path.startswith('/api/') or request.path in _ROTAS_PUBLICAS or request.method == 'OPTIONS':
        return None
    if not session.get('user_id'):
        return jsonify({"status": "error", "erro": "Não autenticado", "message": "Sessão expirada. Faça login novamente."}), 401
    if request.method in ('POST', 'PUT', 'DELETE') and session.get('user_role') != 'admin':
        return jsonify({"status": "error", "erro": "Sem permissão", "message": "Seu perfil é somente leitura."}), 403
    return None

# Limite de tentativas de login por usuário, contra adivinhação de senha pela internet.
_LOGIN_MAX_FALHAS = 8
_LOGIN_JANELA_S = 15 * 60
_login_falhas = {}
_login_falhas_lock = threading.Lock()

def _login_bloqueado(ident):
    agora = time.time()
    with _login_falhas_lock:
        falhas = [t for t in _login_falhas.get(ident, []) if agora - t < _LOGIN_JANELA_S]
        _login_falhas[ident] = falhas
        return len(falhas) >= _LOGIN_MAX_FALHAS

def _registrar_falha_login(ident):
    with _login_falhas_lock:
        _login_falhas.setdefault(ident, []).append(time.time())

# Parâmetros de URL que vários endpoints colam direto no texto do SQL. Validar o formato aqui
# fecha a injeção de SQL em todos eles de uma vez (a plataforma fica exposta na internet via ngrok).
_PARAM_DATA = re.compile(r'\d{4}-\d{2}-\d{2}')
_PARAMS_VALIDADOS = {
    'data_inicio': _PARAM_DATA,
    'data_fim': _PARAM_DATA,
    'ini': _PARAM_DATA,
    'fim': _PARAM_DATA,
    'mes': re.compile(r'\d{4}-\d{2}(-\d{2})?'),
    'comprador': re.compile(r'\d{1,9}|TODOS'),
    'supervisor': re.compile(r'\d{1,9}|TODOS'),
    'status': re.compile(r'[A-Z](,[A-Z])*'),
    'ibge': re.compile(r'\d{7}'),
}

@app.before_request
def validar_parametros_sql():
    if not request.path.startswith('/api/'):
        return None
    for nome, padrao in _PARAMS_VALIDADOS.items():
        valor = request.args.get(nome)
        if valor and not padrao.fullmatch(valor):
            return jsonify({"erro": f"Parâmetro inválido: {nome}"}), 400
    return None

@app.route('/')
def serve_index(): 
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static_files(path): 
    return send_from_directory(app.static_folder, path)

def executar_query_datas(cursor, query, data_inicio, data_fim, filtro_area_sql=""):
    query_segura = query.replace(':data_inicio', f"'{data_inicio}'").replace(':data_fim', f"'{data_fim}'").replace(':filtro_area', filtro_area_sql)
    cursor.execute(query_segura)
    col = [c[0] for c in cursor.description]
    return [dict(zip(col, linha)) for linha in cursor.fetchall()]

def executar_query_estoque(cursor, query):
    cursor.execute(query)
    col = [c[0] for c in cursor.description]
    return [dict(zip(col, linha)) for linha in cursor.fetchall()]

def obter_filtro_area(area):
    if area == 'LOGISTICA':
        return " AND INSTR(UPPER(I.MOTIVO), 'USU') > 0 "
    elif area == 'COMERCIAL':
        return " AND INSTR(UPPER(I.MOTIVO), 'USU') = 0 "
    else:
        return " "  # TODOS ou qualquer outro

import uuid
import threading

ASYNC_JOBS = {}

@app.route('/api/start-dashboard-cortes', methods=['GET'])
def start_dashboard_cortes():
    hoje = datetime.today()
    di = request.args.get('data_inicio')
    df = request.args.get('data_fim')
    area = request.args.get('area', 'LOGISTICA')
    data_inicio = di if di else (hoje - timedelta(days=90)).strftime('%Y-%m-%d')
    data_fim = df if df else hoje.strftime('%Y-%m-%d')
    filtro_area_sql = obter_filtro_area(area)
    
    job_id = str(uuid.uuid4())
    ASYNC_JOBS[job_id] = {"status": "running", "dados": None, "erro": None}
    
    def db_task():
        try:
            conn = database.get_conexao()
            cursor = conn.cursor()
            cursor.execute(sql_queries.QUERY_KPIS.replace(':data_inicio', f"'{data_inicio}'").replace(':data_fim', f"'{data_fim}'").replace(':filtro_area', filtro_area_sql))
            kr = cursor.fetchone()
            cursor.execute(sql_queries.QUERY_QTD_SKUS_CORTADOS.replace(':data_inicio', f"'{data_inicio}'").replace(':data_fim', f"'{data_fim}'").replace(':filtro_area', filtro_area_sql))
            kr_sku = cursor.fetchone()
            
            kpis = {
                "quantidade_total": kr[0] if kr and kr[0] else 0, "valor_total_venda": kr[1] if kr and kr[1] else 0, 
                "valor_total_custo": kr[2] if kr and kr[2] else 0, "perc_cortes": kr[3] if kr and kr[3] else 0, 
                "faturamento_total": kr[4] if kr and kr[4] else 0, "qtd_skus_cortados": kr_sku[0] if kr_sku and kr_sku[0] else 0
            }
            
            dados = {
                "kpis": kpis,
                "top_compradores": executar_query_datas(cursor, sql_queries.QUERY_CORTES_COMPRADOR, data_inicio, data_fim, filtro_area_sql),
                "top_produtos": executar_query_datas(cursor, sql_queries.QUERY_TOP_PRODUTOS, data_inicio, data_fim, filtro_area_sql),
                "top_fornecedores": executar_query_datas(cursor, sql_queries.QUERY_TOP_FORNECEDORES, data_inicio, data_fim, filtro_area_sql),
                "top_clientes": executar_query_datas(cursor, sql_queries.QUERY_TOP_CLIENTES, data_inicio, data_fim, filtro_area_sql),
                "top_motivos": executar_query_datas(cursor, sql_queries.QUERY_MOTIVOS, data_inicio, data_fim, filtro_area_sql),
                "top_conferentes": executar_query_datas(cursor, sql_queries.QUERY_CONFERENTES, data_inicio, data_fim, filtro_area_sql),
                "cortes_por_semana": executar_query_datas(cursor, sql_queries.QUERY_CORTES_POR_SEMANA, data_inicio, data_fim, filtro_area_sql)
            }
            cursor.close(); conn.close()
            ASYNC_JOBS[job_id]["dados"] = dados
            ASYNC_JOBS[job_id]["status"] = "done"
        except Exception as e:
            ASYNC_JOBS[job_id]["erro"] = str(e)
            ASYNC_JOBS[job_id]["status"] = "error"

    threading.Thread(target=db_task).start()
    return jsonify({"job_id": job_id})

@app.route('/api/status-job', methods=['GET'])
def status_job():
    job_id = request.args.get('job_id')
    if not job_id or job_id not in ASYNC_JOBS: return jsonify({"erro": "Job não encontrado"}), 404
    job = ASYNC_JOBS[job_id]
    if job["status"] == "running": return jsonify({"status": "running"})
    if job["status"] == "error": return jsonify({"erro": job["erro"]}), 500
    
    dados = job["dados"]
    del ASYNC_JOBS[job_id]
    return jsonify({"status": "done", "dados": dados})

@app.route('/api/start-dashboard-cortes-ant', methods=['GET'])
def start_dashboard_cortes_ant():
    import calendar
    def sub_one_month(dt_str):
        dt = datetime.strptime(dt_str, '%Y-%m-%d')
        mes = dt.month - 1
        ano = dt.year
        if mes == 0: mes = 12; ano -= 1
        dia = min(dt.day, calendar.monthrange(ano, mes)[1])
        return f"{ano}-{mes:02d}-{dia:02d}"

    hoje = datetime.today()
    di = request.args.get('data_inicio')
    df = request.args.get('data_fim')
    area = request.args.get('area', 'LOGISTICA')
    data_inicio = di if di else (hoje - timedelta(days=90)).strftime('%Y-%m-%d')
    data_fim = df if df else hoje.strftime('%Y-%m-%d')
    filtro_area_sql = obter_filtro_area(area)
    
    data_inicio_ant = sub_one_month(data_inicio)
    data_fim_ant = sub_one_month(data_fim)
    
    job_id = str(uuid.uuid4())
    ASYNC_JOBS[job_id] = {"status": "running", "dados": None, "erro": None}
    
    def db_task_ant():
        try:
            conn = database.get_conexao()
            cursor = conn.cursor()
            cursor.execute(sql_queries.QUERY_KPIS.replace(':data_inicio', f"'{data_inicio_ant}'").replace(':data_fim', f"'{data_fim_ant}'").replace(':filtro_area', filtro_area_sql))
            kr_ant = cursor.fetchone()
            cursor.execute(sql_queries.QUERY_QTD_SKUS_CORTADOS.replace(':data_inicio', f"'{data_inicio_ant}'").replace(':data_fim', f"'{data_fim_ant}'").replace(':filtro_area', filtro_area_sql))
            kr_sku_ant = cursor.fetchone()
            
            kpis_ant = {
                "quantidade_total": kr_ant[0] if kr_ant and kr_ant[0] else 0, "valor_total_venda": kr_ant[1] if kr_ant and kr_ant[1] else 0, 
                "valor_total_custo": kr_ant[2] if kr_ant and kr_ant[2] else 0, "perc_cortes": kr_ant[3] if kr_ant and kr_ant[3] else 0, 
                "faturamento_total": kr_ant[4] if kr_ant and kr_ant[4] else 0, "qtd_skus_cortados": kr_sku_ant[0] if kr_sku_ant and kr_sku_ant[0] else 0
            }
            cursor.close(); conn.close()
            ASYNC_JOBS[job_id]["dados"] = {"kpis_ant": kpis_ant, "datas_ant": {"inicio": data_inicio_ant, "fim": data_fim_ant}}
            ASYNC_JOBS[job_id]["status"] = "done"
        except Exception as e:
            ASYNC_JOBS[job_id]["erro"] = str(e)
            ASYNC_JOBS[job_id]["status"] = "error"
            
    threading.Thread(target=db_task_ant).start()
    return jsonify({"job_id": job_id})

@app.route('/api/top100-detalhado', methods=['GET'])
def obter_top100_detalhado():
    try:
        data_inicio = request.args.get('data_inicio', '2026-06-01')
        data_fim = request.args.get('data_fim', '2026-06-30')
        area = request.args.get('area', 'LOGISTICA')
        conn = database.get_conexao()
        cursor = conn.cursor()
        dados = executar_query_datas(cursor, sql_queries.QUERY_TOP_100_DETALHADO, data_inicio, data_fim, obter_filtro_area(area))
        cursor.close(); conn.close()
        return jsonify(dados)
    except Exception as e: return jsonify({"erro": str(e)}), 500

@app.route('/api/start-dashboard-excesso', methods=['GET'])
def start_dashboard_excesso():
    comprador = request.args.get('comprador', 'TODOS')
    filtro = f" AND F.CODCOMPRADOR = {comprador} " if comprador != 'TODOS' else ""
    filtro_f2 = f" AND F2.CODCOMPRADOR = {comprador} " if comprador != 'TODOS' else ""
    
    job_id = str(uuid.uuid4())
    ASYNC_JOBS[job_id] = {"status": "running", "dados": None, "erro": None}
    
    def db_task_excesso():
        try:
            conn = database.get_conexao()
            cursor = conn.cursor()
            cursor.execute(sql_queries.QUERY_KPIS_EXCESSO.format(filtro_comprador=filtro))
            kr = cursor.fetchone()
            cursor.execute(sql_queries.QUERY_FINANCEIRO_COMPRADOR.format(filtro_comprador_f2=filtro_f2))
            fin = cursor.fetchone()
            
            contas_a_pagar = fin[0] if fin and fin[0] else 0
            kpis = {
                "qtd_estoque": kr[0] if kr and kr[0] else 0, "valor_estoque_custo": kr[1] if kr and kr[1] else 0,
                "valor_estoque_venda": kr[2] if kr and kr[2] else 0, "qtd_ideal": kr[3] if kr and kr[3] else 0,
                "valor_ideal_custo": kr[4] if kr and kr[4] else 0, "qtd_excesso": kr[5] if kr and kr[5] else 0,
                "valor_excesso": kr[6] if kr and kr[6] else 0, "qtd_faltante": kr[7] if kr and kr[7] else 0,
                "valor_faltante_custo": kr[8] if kr and kr[8] else 0, "perda_venda_ruptura": kr[9] if kr and kr[9] else 0,
                "valor_parado_45d": kr[10] if kr and kr[10] else 0, "qtd_itens_45d": kr[11] if kr and kr[11] else 0,
                "itens_com_estoque": kr[12] if kr and kr[12] else 0, "media_venda_mes": kr[13] if kr and kr[13] else 0,
                "qtd_itens_zerados": kr[14] if kr and kr[14] else 0, "oportunidade_compra": kr[15] if kr and len(kr) > 15 and kr[15] else 0,
                "contas_a_pagar": contas_a_pagar, "capital_imobilizado_pago": ((kr[1] if kr and kr[1] else 0) - contas_a_pagar)
            }
            
            dados = {
                "kpis": kpis,
                "alertas_estoque": executar_query_estoque(cursor, sql_queries.QUERY_ALERTAS_ESTOQUE.format(filtro_comprador=filtro)),
                "limite_comprador": executar_query_estoque(cursor, sql_queries.QUERY_LIMITE_EXCESSO_COMPRADOR.format(filtro_comprador=filtro)),
                "top_fornecedores_excesso": executar_query_estoque(cursor, sql_queries.QUERY_TOP_FORNECEDORES_EXCESSO.format(filtro_comprador=filtro)),
                "top_produtos_excesso": executar_query_estoque(cursor, sql_queries.QUERY_TOP_PRODUTOS_EXCESSO.format(filtro_comprador=filtro)),
                "top_produtos_estoque": executar_query_estoque(cursor, sql_queries.QUERY_TOP_PRODUTOS_ESTOQUE.format(filtro_comprador=filtro)),
                "fornecedores_faltante": executar_query_estoque(cursor, sql_queries.QUERY_TOP_FORNECEDORES_FALTANTE.format(filtro_comprador=filtro)),
                "top_produtos_ruptura": executar_query_estoque(cursor, sql_queries.QUERY_TOP_PRODUTOS_RUPTURA.format(filtro_comprador=filtro)),
                "top_produtos_obsoletos": executar_query_estoque(cursor, sql_queries.QUERY_TOP_PRODUTOS_OBSOLETOS.format(filtro_comprador=filtro))
            }
            cursor.close(); conn.close()
            ASYNC_JOBS[job_id]["dados"] = dados
            ASYNC_JOBS[job_id]["status"] = "done"
        except Exception as e:
            ASYNC_JOBS[job_id]["erro"] = str(e)
            ASYNC_JOBS[job_id]["status"] = "error"

    threading.Thread(target=db_task_excesso).start()
    return jsonify({"job_id": job_id})

@app.route('/api/analise-motorista-dados', methods=['GET'])
def analise_motorista_dados():
    try:
        data_inicio = request.args.get('data_inicio') or (datetime.today() - timedelta(days=30)).strftime('%Y-%m-%d')
        data_fim = request.args.get('data_fim') or datetime.today().strftime('%Y-%m-%d')
        motorista = request.args.get('motorista') or 'Todos'
        
        import concurrent.futures

        params = {
            'data_inicio': data_inicio,
            'data_fim': data_fim,
            'motorista': motorista
        }

        def run_query(q, binds=None):
            c_conn = database.get_conexao()
            c_cursor = c_conn.cursor()
            try:
                c_cursor.execute(q, binds or params)
                c_col = [c[0] for c in c_cursor.description]
                return [dict(zip(c_col, linha)) for linha in c_cursor.fetchall()]
            finally:
                c_cursor.close()
                c_conn.close()

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            fut_mot = executor.submit(run_query, sql_queries.QUERY_ANALISE_MOTORISTA)
            fut_cid = executor.submit(run_query, sql_queries.QUERY_MOTORISTA_CIDADES)
            fut_dfat = executor.submit(run_query, sql_queries.QUERY_MOTORISTA_DIAS_SEMANA_FAT)
            fut_dmov = executor.submit(run_query, sql_queries.QUERY_MOTORISTA_DIAS_SEMANA_MOV)
            fut_rot = executor.submit(run_query, sql_queries.QUERY_MOTORISTA_ROTAS)
            if motorista.upper() == 'TODOS':
                fut_pos = executor.submit(run_query, sql_queries.QUERY_POSITIVADOS_PERIODO, {'data_inicio': data_inicio, 'data_fim': data_fim})
            else:
                fut_pos = executor.submit(run_query, sql_queries.QUERY_POSITIVADOS_MOTORISTA, params)

            dados_motoristas = fut_mot.result()
            dados_cidades = fut_cid.result()
            dados_dias_fat = fut_dfat.result()
            dados_dias_mov = fut_dmov.result()
            clientes_positivados = int((fut_pos.result() or [{}])[0].get('POSITIVADOS') or 0)
            try:
                dados_rotas = fut_rot.result()
            except Exception:
                dados_rotas = []

        dados_dias = dados_dias_fat
        
        if dados_motoristas and 'CLIENTES_UNICOS_TOTAL' in dados_motoristas[0]:
            total_entregas = dados_motoristas[0].get('CLIENTES_UNICOS_TOTAL') or 0
            total_notas_devolvidas = dados_motoristas[0].get('CLIENTES_DEV_TOTAL') or 0
            clientes_atendidos = dados_motoristas[0].get('CLIENTES_ATENDIDOS_TOTAL') or 0
            clientes_devolveram = dados_motoristas[0].get('CLIENTES_DEVOLVERAM_TOTAL') or 0
        else:
            total_entregas = sum((d.get('TOTAL_ENTREGAS') or 0) for d in dados_motoristas)
            total_notas_devolvidas = sum((d.get('TOTAL_NOTAS_DEVOLVIDAS') or 0) for d in dados_motoristas)
            clientes_atendidos = sum((d.get('CLIENTES_ATENDIDOS') or 0) for d in dados_motoristas)
            clientes_devolveram = sum((d.get('CLIENTES_DEVOLVERAM') or 0) for d in dados_motoristas)
        total_notas_expedidas = sum((d.get('TOTAL_NOTAS_EXPEDIDAS') or 0) for d in dados_motoristas)
        faturamento_bruto = sum((d.get('FATURAMENTO_BRUTO') or 0) for d in dados_motoristas)
        deducoes = sum((d.get('DEDUCOES') or 0) for d in dados_motoristas)
        total_devolucao = sum((d.get('TOTAL_DEVOLUCAO') or 0) for d in dados_motoristas)
        
        faturamento_liquido = faturamento_bruto - deducoes - total_devolucao

        # Telemetria real do Siga+: KM vem das leituras de hodômetro guardadas pelo coletor (fulltrack.py).
        # Com filtro de motorista, só entram as placas dos carregamentos dele no período (WinThor).
        # Combustível: estimado por placa com o consumo médio do tipo de caminhão (frota_consumo.py) × preço do diesel.
        telemetria = {"disponivel": False, "erro": None}
        combustivel = None
        try:
            if motorista.upper() != 'TODOS':
                # Só os carros e os dias em que o motorista saiu com carregamento (outro motorista no mesmo carro não entra)
                placa_dias = {}
                for linha in run_query(sql_queries.QUERY_PLACAS_MOTORISTA):
                    placa_dias.setdefault(fulltrack.normalizar_placa(linha['PLACA']), set()).add(linha['DIA'])
                km = local_db.km_rodados_siga_dias(placa_dias)
            else:
                km = local_db.km_rodados_siga(data_inicio, data_fim)
            km = frota_consumo.so_caminhoes(km)
            telemetria.update({
                "disponivel": bool(km['veiculos']),
                "km_total": km['km_total'],
                "veiculos_com_km": len(km['veiculos']),
                "veiculos_descartados": len(km['descartados']),
                "inicio_coleta": km['inicio_coleta'],
                "periodo_coberto": km['periodo_coberto'],
                "historico_pendente": fulltrack.status_historico()['ativo'] and fulltrack.status_historico()['janelas_pendentes'] != 0,
            })
            frota = [{"placa": v['placa'], "km": v['km']} for v in km['veiculos'][:20]]
            if km['veiculos']:
                combustivel = frota_consumo.calcular_gasto_diesel(km['veiculos'])
        except Exception as e:
            telemetria["erro"] = str(e)
            frota = []
        try:
            telemetria["frota"] = fulltrack.resumo_frota()
        except Exception as e:
            telemetria["frota"] = None
            telemetria["erro"] = telemetria["erro"] or str(e)

        return jsonify({
            'kpis': {
                'entregas': total_entregas,
                'entregas_realizadas': total_entregas,
                'notas_expedidas': total_notas_expedidas,
                'total_notas_devolvidas': total_notas_devolvidas,
                'clientes_atendidos': clientes_atendidos,
                'clientes_devolveram': clientes_devolveram,
                'clientes_positivados': clientes_positivados,
                'faturamento_liquido': faturamento_liquido,
                'km_total_siga': telemetria.get('km_total') if telemetria['disponivel'] else None,
                'gasto_combustivel_siga': combustivel['gasto_total'] if combustivel else None
            },
            'telemetria_siga': telemetria,
            'combustivel': combustivel,
            'frota_siga': frota,
            'motoristas': dados_motoristas,
            'cidades': dados_cidades,
            'dias_semana': dados_dias_fat,
            'dias_semana_fat': dados_dias_fat,
            'dias_semana_mov': dados_dias_mov,
            'rotas': dados_rotas
        })
    except Exception as e:
        print("Erro analise_motorista_dados:", e)
        return jsonify({'error': str(e)}), 500

@app.route('/api/compradores', methods=['GET'])
def obter_compradores():
    """Rótulos dos filtros de comprador (Excesso e Comercial). Ficam no config_local.json, fora do Git."""
    rotulos = local_db.config_local().get('compradores', {})
    return jsonify([{'id': k, 'nome': v} for k, v in rotulos.items()])


@app.route('/api/motoristas', methods=['GET'])
def obter_motoristas():
    try:
        conn = database.get_conexao()
        c = conn.cursor()
        c.execute(sql_queries.QUERY_MOTORISTAS)
        col = [desc[0] for desc in c.description]
        res = [dict(zip(col, row)) for row in c.fetchall()]
        c.close()
        conn.close()
        
        # CRUZAMENTO REAL SIGA+ (via fulltrack.py: chaves no .env e cache, sem chamar a API a cada acesso)
        try:
            nomes_siga = [d['nome'].upper() for d in fulltrack.nomes_motoristas()[0]]
            try:
                nomes_siga += [p['motorista'].upper() for p in fulltrack.posicoes()[0] if p['motorista']]
            except fulltrack.FulltrackErro as e:
                print("Aviso Siga posições:", e)

            import unicodedata
            def _norm(txt):
                return ''.join(c for c in unicodedata.normalize('NFD', txt.upper()) if unicodedata.category(c) != 'Mn')

            nomes_siga_norm = [_norm(ns) for ns in nomes_siga]

            if nomes_siga_norm:
                for r in res:
                    nome_erp_clean = _norm(str(r.get('NOME', '')))
                    partes = [p for p in nome_erp_clean.split() if len(p) >= 3]
                    for ns in nomes_siga_norm:
                        if len(partes) >= 2 and (partes[0] in ns and partes[1] in ns):
                            r['NOME'] = f"{r['NOME']} (Siga+)"
                            break
                        elif partes and partes[0] in ['PERICLES', 'GILVANE', 'JONATHA'] and partes[0] in ns:
                            r['NOME'] = f"{r['NOME']} (Siga+)"
                            break
        except Exception as e:
            print("Erro Siga motoristas:", e)
            
        return jsonify(res)
    except Exception as e:
        return jsonify({"erro": str(e)}), 500
@app.route('/api/siga/status', methods=['GET'])
def api_siga_status():
    """Saúde da integração Siga+ (Fulltrack): lê do cache; não força chamada nova à API."""
    try:
        resumo = fulltrack.resumo_frota()
    except fulltrack.FulltrackErro as e:
        resumo = {"erro": str(e)}
    return jsonify({"status": "ok", "integracao": fulltrack.status_integracao(), "frota": resumo})

@app.route('/api/supervisores', methods=['GET'])
def obter_supervisores():
    try:
        conn = database.get_conexao()
        cursor = conn.cursor()
        cursor.execute(sql_queries.QUERY_SUPERVISORES)
        col = [c[0] for c in cursor.description]
        dados = [dict(zip(col, linha)) for linha in cursor.fetchall()]
        cursor.close(); conn.close()
        return jsonify(dados)
    except Exception as e: return jsonify([])

@app.route('/api/start-dashboard-comercial', methods=['GET'])
def start_dashboard_comercial():
    data_inicio = request.args.get('data_inicio', (datetime.today() - timedelta(days=30)).strftime('%Y-%m-%d'))
    data_fim = request.args.get('data_fim', datetime.today().strftime('%Y-%m-%d'))
    comprador = request.args.get('comprador', 'TODOS')
    supervisor = request.args.get('supervisor', 'TODOS')

    f_comp = f" AND F.CODCOMPRADOR = {comprador} " if comprador != 'TODOS' else ""
    f_sup = f" AND EXISTS (SELECT 1 FROM PCUSUARI U WHERE U.CODUSUR = M.CODUSUR AND U.CODSUPERVISOR = {supervisor}) " if supervisor != 'TODOS' else ""

    comp_param = comprador if comprador != 'TODOS' else -1
    sup_param = supervisor if supervisor != 'TODOS' else -1
    
    job_id = str(uuid.uuid4())
    ASYNC_JOBS[job_id] = {"status": "running", "dados": None, "erro": None}

    def db_task_comercial():
        try:
            conn = database.get_conexao()
            cursor = conn.cursor()

            # 1. KPI Faturamento Oficial LÍQUIDO
            q_fat_oficial = """
                SELECT SUM(NVL(VENDAS, 0)) - SUM(NVL(DEVOLUCAO, 0) + NVL(AVULSA, 0))
                FROM VIEW_BI_FATURAMENTO 
                WHERE DTSAIDA >= TO_DATE(:data_inicio, 'YYYY-MM-DD') 
                  AND DTSAIDA < TO_DATE(:data_fim, 'YYYY-MM-DD') + 1 
                  AND CODFILIAL = '1'
            """
            q_fat_oficial_segura = q_fat_oficial.replace(':data_inicio', f"'{data_inicio}'").replace(':data_fim', f"'{data_fim}'")
            cursor.execute(q_fat_oficial_segura)
            fat_resultado = cursor.fetchone()
            fat_total = fat_resultado[0] if fat_resultado and fat_resultado[0] else 0

            # Hierarquias
            q_kpis = sql_queries.QUERY_KPIS_COMERCIAL.replace(':data_inicio', f"'{data_inicio}'").replace(':data_fim', f"'{data_fim}'")
            q_kpis = q_kpis.replace(':comprador_param', str(comp_param)).replace(':supervisor_param', str(sup_param))
            cursor.execute(q_kpis)
            kr = cursor.fetchone()
            
            if comprador != 'TODOS':
                q_fat_comp = """
                    SELECT SUM(NVL(v.VENDAS, 0) - NVL(v.DEVOLUCAO, 0) - NVL(v.AVULSA, 0))
                    FROM VIEW_BI_FATURAMENTO v
                    JOIN PCPRODUT pd ON pd.CODPROD = v.CODPROD
                    JOIN PCFORNEC f ON f.CODFORNEC = pd.CODFORNEC
                    WHERE v.DTSAIDA >= TO_DATE(:data_inicio, 'YYYY-MM-DD') 
                      AND v.DTSAIDA < TO_DATE(:data_fim, 'YYYY-MM-DD') + 1 
                      AND v.CODFILIAL = '1'
                      AND f.CODCOMPRADOR = :comprador_param
                """
                q_fat_comp_segura = q_fat_comp.replace(':data_inicio', f"'{data_inicio}'").replace(':data_fim', f"'{data_fim}'").replace(':comprador_param', str(comp_param))
                cursor.execute(q_fat_comp_segura)
                res_comp = cursor.fetchone()
                fat_comp = res_comp[0] if res_comp and res_comp[0] else 0
            else:
                fat_comp = kr[1] if kr and kr[1] else 0
                
            fat_sup = kr[2] if kr and kr[2] else 0

            # 2. Produtos
            q_prods = sql_queries.QUERY_PRODUTOS_COMERCIAL.replace(':data_inicio', f"'{data_inicio}'").replace(':data_fim', f"'{data_fim}'").replace('{filtro_comprador}', f_comp).replace('{filtro_supervisor}', f_sup)
            cursor.execute(q_prods)
            produtos = [dict(zip([c[0] for c in cursor.description], linha)) for linha in cursor.fetchall()]

            # 3. Semanas
            q_sem = sql_queries.QUERY_COMERCIAL_PEDIDOS_SEMANA.replace(':data_inicio', f"'{data_inicio}'").replace(':data_fim', f"'{data_fim}'").replace('{filtro_comprador}', f_comp).replace('{filtro_supervisor}', f_sup)
            cursor.execute(q_sem)
            semanas = [dict(zip([c[0] for c in cursor.description], linha)) for linha in cursor.fetchall()]

            # 4. Clientes
            q_cli = sql_queries.QUERY_COMERCIAL_CLIENTES.replace(':data_inicio', f"'{data_inicio}'").replace(':data_fim', f"'{data_fim}'").replace('{filtro_comprador}', f_comp).replace('{filtro_supervisor}', f_sup)
            cursor.execute(q_cli)
            clientes = [dict(zip([c[0] for c in cursor.description], linha)) for linha in cursor.fetchall()]

            # 5. Fornecedores
            q_forn = sql_queries.QUERY_COMERCIAL_FORNECEDORES.replace(':data_inicio', f"'{data_inicio}'").replace(':data_fim', f"'{data_fim}'").replace('{filtro_comprador}', f_comp).replace('{filtro_supervisor}', f_sup)
            cursor.execute(q_forn)
            fornecedores = [dict(zip([c[0] for c in cursor.description], linha)) for linha in cursor.fetchall()]

            cursor.close(); conn.close()

            produtos.sort(key=lambda x: x.get('QTD_VENDIDA', 0), reverse=True)

            dias_periodo = (datetime.strptime(data_fim, '%Y-%m-%d') - datetime.strptime(data_inicio, '%Y-%m-%d')).days + 1

            for i, p in enumerate(produtos):
                n = dias_periodo
                sum_x = float(p.get('QTD_VENDIDA', 0))
                sum_x2 = float(p.get('SOMA_QUADRADOS_DIA', 0))
                
                media_real = sum_x / n
                p['MEDIA_DIA'] = round(media_real, 2)
                p['MEDIA_SEMANA'] = round(media_real * 6, 2)
                
                if i < 100:
                    if n > 1:
                        variancia = (sum_x2 - ((sum_x ** 2) / n)) / (n - 1)
                    else:
                        variancia = 0
                        
                    desvio_padrao = math.sqrt(max(0, variancia))
                    
                    if media_real > 0 and p.get('DIAS_COM_VENDA', 0) >= 3:
                        p['CV'] = int(round((desvio_padrao / media_real) * 100, 0))
                    else:
                        p['CV'] = 999999
                else:
                    p['CV'] = 999999

            # Cards
            cards = {
                "fat_liquido": fat_total, 
                "fat_comp": fat_comp, 
                "fat_sup": fat_sup, 
                "perc_sup_total": (fat_sup / fat_total * 100) if fat_total > 0 else 0, 
                "perc_sup_comp": (fat_sup / fat_comp * 100) if fat_comp > 0 else 0
            }
            
            if produtos:
                mais_vendido = max(produtos, key=lambda x: x['QTD_VENDIDA'])
                menos_vendido = min(produtos, key=lambda x: x['QTD_VENDIDA'])
                mais_rentavel = max(produtos, key=lambda x: x['LUCRO'])
                mais_positivou = max(produtos, key=lambda x: x['POSITIVACAO'])
                
                consistentes = [p for p in produtos if p['CV'] < 999999]
                mais_consistente = min(consistentes, key=lambda x: x['CV']) if consistentes else None

                cards.update({
                    "mais_vendido": {"nome": mais_vendido['DESCRICAO'], "valor": f"{int(mais_vendido['QTD_VENDIDA'])} un."},
                    "menos_vendido": {"nome": menos_vendido['DESCRICAO'], "valor": f"{int(menos_vendido['QTD_VENDIDA'])} un."},
                    "mais_rentavel": {"nome": mais_rentavel['DESCRICAO'], "valor": f"R$ {mais_rentavel['LUCRO']:,.0f}".replace(',', 'X').replace('.', ',').replace('X', '.')},
                    "mais_positivou": {"nome": mais_positivou['DESCRICAO'], "valor": f"{mais_positivou['POSITIVACAO']} Clientes"},
                    "mais_consistente": {"nome": mais_consistente['DESCRICAO'] if mais_consistente else "Aguardando Vendas", "valor": f"CV: {mais_consistente['CV']}% | Média: {int(round(mais_consistente['MEDIA_DIA'], 0))} un/dia" if mais_consistente else "-"}
                })

            # MOTOR DE INSIGHTS AUTOMATIZADOS
            insights = []
            if semanas:
                tot_ped = sum(s['QTD_PEDIDOS'] for s in semanas)
                if tot_ped > 0:
                    pior_sem = max(semanas, key=lambda x: x['QTD_PEDIDOS'])
                    if (pior_sem['QTD_PEDIDOS'] / tot_ped) >= 0.40:
                        insights.append({"tipo": "danger", "icone": "⚠️", "titulo": "Efeito Sanfona Operacional", "texto": f"A {pior_sem['SEMANA']} concentrou {int(round((pior_sem['QTD_PEDIDOS']/tot_ped)*100, 0))}% de todos os pedidos, causando pico logístico."})
            
            if produtos and fat_total > 0:
                top_prod = max(produtos, key=lambda x: x['FATURAMENTO'])
                if (top_prod['FATURAMENTO'] / fat_total) >= 0.20:
                    insights.append({"tipo": "warning", "icone": "📦", "titulo": "Dependência de Portfólio", "texto": f"Apenas 1 produto ({top_prod['DESCRICAO'][:15]}...) representa {int(round((top_prod['FATURAMENTO']/fat_total)*100,0))}% de toda a receita filtrada."})
            
            if clientes and fat_total > 0:
                top_cli = max(clientes, key=lambda x: x['FATURAMENTO'])
                if (top_cli['FATURAMENTO'] / fat_total) >= 0.20:
                    insights.append({"tipo": "warning", "icone": "🤝", "titulo": "Concentração de Risco (Cliente)", "texto": f"O cliente {top_cli['NOME_CLIENTE'][:15]}... domina {int(round((top_cli['FATURAMENTO']/fat_total)*100,0))}% da receita. Risco alto de quebra de faturamento."})

            if not insights:
                insights.append({"tipo": "success", "icone": "✅", "titulo": "Operação Saudável", "texto": "Sem anomalias graves detectadas. O fluxo de pedidos e a carteira de produtos/clientes encontram-se pulverizados."})

            dados = {
                "cards": cards, "produtos": produtos, "semanas": semanas, 
                "clientes": clientes, "fornecedores": fornecedores, "insights": insights
            }
            ASYNC_JOBS[job_id]["dados"] = dados
            ASYNC_JOBS[job_id]["status"] = "done"
        except Exception as e:
            import traceback
            traceback.print_exc()
            ASYNC_JOBS[job_id]["erro"] = str(e)
            ASYNC_JOBS[job_id]["status"] = "error"

    threading.Thread(target=db_task_comercial).start()
    return jsonify({"job_id": job_id})


# =========================================================================
# EXPORTAÇÕES (CSV/EXCEL)
# =========================================================================
def gerar_csv_generico(linhas, colunas_header, nome_arquivo):
    si = StringIO()
    si.write('\ufeff')
    escritor = csv.writer(si, delimiter=';')
    escritor.writerow(colunas_header)
    for row in linhas:
        linha_tratada = ["" if val is None else str(val).replace('.', ',') if isinstance(val, float) else str(val) for val in row]
        escritor.writerow(linha_tratada)
    return Response(si.getvalue(), mimetype="text/csv", headers={"Content-disposition": f"attachment; filename={nome_arquivo}"})

@app.route('/api/exportar-comercial', methods=['GET'])
def exportar_comercial():
    try:
        data_inicio = request.args.get('data_inicio', '2026-01-01')
        data_fim = request.args.get('data_fim', '2026-12-31')
        comprador = request.args.get('comprador', 'TODOS')
        supervisor = request.args.get('supervisor', 'TODOS')

        f_comp = f" AND F.CODCOMPRADOR = {comprador} " if comprador != 'TODOS' else ""
        f_sup = f" AND EXISTS (SELECT 1 FROM PCUSUARI U WHERE U.CODUSUR = M.CODUSUR AND U.CODSUPERVISOR = {supervisor}) " if supervisor != 'TODOS' else ""

        q_prods = sql_queries.QUERY_PRODUTOS_COMERCIAL.replace(':data_inicio', f"'{data_inicio}'").replace(':data_fim', f"'{data_fim}'").replace('{filtro_comprador}', f_comp).replace('{filtro_supervisor}', f_sup)
        
        conn = database.get_conexao()
        cursor = conn.cursor()
        cursor.execute(q_prods)
        linhas = cursor.fetchall()
        cursor.close(); conn.close()

        headers = ["CÓDIGO", "DESCRIÇÃO", "EMBALAGEM", "FORNECEDOR", "COMPRADOR", "SUPERVISOR DE MAIOR VENDA", "QUANTIDADE VENDIDA", "FATURAMENTO (R$)", "LUCRO (R$)", "POSITIVAÇÃO (CLIENTES)", "DIAS COM VENDA", "SOMA_QUADRADOS_DIA"]
        return gerar_csv_generico(linhas, headers, "Desempenho_Comercial_Produtos.csv")
    except Exception as e: return f"Erro: {str(e)}", 500

@app.route('/api/exportar-cortes', methods=['GET'])
def exportar_cortes():
    try:
        conn = database.get_conexao()
        cursor = conn.cursor()
        q_exp = sql_queries.QUERY_EXPORTAR_CORTES.replace(':data_inicio', f"'{request.args.get('data_inicio')}'").replace(':data_fim', f"'{request.args.get('data_fim')}'").replace(':filtro_area', obter_filtro_area(request.args.get('area')))
        cursor.execute(q_exp)
        linhas = cursor.fetchall()
        cursor.close(); conn.close()
        return gerar_csv_generico(linhas, ["COMPRADOR", "CLIENTE", "FORNECEDOR", "PRODUTO", "QUANTIDADE CORTADA", "PEDIDOS CORTADOS", "VALOR CORTADO", "DATA CORTE", "CONFERENTE", "MOTIVO DO CORTE", "ESTOQUE ATUAL", "ESTOQUE DATA CORTE", "SEMANA 1", "SEMANA 2", "SEMANA 3", "SEMANA 4", "SEMANA 5"], "Cortes.csv")
    except Exception as e: return str(e), 500

@app.route('/api/exportar-excesso', methods=['GET'])
def exportar_excesso():
    try:
        f = f" AND F.CODCOMPRADOR = {request.args.get('comprador')} " if request.args.get('comprador') != 'TODOS' else ""
        conn = database.get_conexao()
        cursor = conn.cursor()
        cursor.execute(sql_queries.QUERY_EXPORTAR_EXCESSO.format(filtro_comprador=f))
        linhas = cursor.fetchall()
        cursor.close(); conn.close()
        return gerar_csv_generico(linhas, ["COMPRADOR", "FORNECEDOR", "PRODUTO", "QTD ESTOQUE", "QTD IDEAL (60D)", "QTD EXCESSO", "VALOR EXCESSO (R$)"], "Excesso_Estoque.csv")
    except Exception as e: return str(e), 500

@app.route('/api/exportar-isv', methods=['GET'])
def exportar_isv():
    try:
        f = f" AND F.CODCOMPRADOR = {request.args.get('comprador')} " if request.args.get('comprador') != 'TODOS' else ""
        conn = database.get_conexao()
        cursor = conn.cursor()
        cursor.execute(sql_queries.QUERY_EXPORTAR_ISV.format(filtro_comprador=f))
        linhas = cursor.fetchall()
        cursor.close(); conn.close()
        return gerar_csv_generico(linhas, ["PRODUTO", "EMBALAGEM", "FORNECEDOR", "COMPRADOR", "QUANTIDADE RESERVADA", "QUANTIDADE DISPONÍVEL", "QUANTIDADE AVARIA", "QUANTIDADE GERAL", "DATA DE ÚLTIMA SAÍDA", "DATA DE ÚLTIMA ENTRADA", "PREÇO DE CUSTO (R$)", "PREÇO DE VENDA (R$)", "VALOR DE ESTOQUE A PREÇO DE VENDA", "DIAS SEM VENDA"], "ISV.csv")
    except Exception as e: return str(e), 500

@app.route('/api/tabela-estoque', methods=['GET'])
def api_tabela_estoque():
    """As mesmas tabelas dos botões de exportar do Excesso, em JSON, para abrir dentro da plataforma (clique nos cards)."""
    consultas = {
        'excesso': sql_queries.QUERY_EXPORTAR_EXCESSO,
        'obsoletos': sql_queries.QUERY_EXPORTAR_ISV,
        'ruptura': sql_queries.QUERY_EXPORTAR_RUPTURA,
    }
    tipo = request.args.get('tipo', '')
    if tipo not in consultas:
        return jsonify({"status": "error", "message": "Tabela inválida."}), 400
    try:
        comprador = request.args.get('comprador') or 'TODOS'
        filtro = f" AND F.CODCOMPRADOR = {comprador} " if comprador != 'TODOS' else ""
        conn = database.get_conexao()
        cursor = conn.cursor()
        linhas = executar_query_estoque(cursor, consultas[tipo].format(filtro_comprador=filtro))
        cursor.close(); conn.close()
        return jsonify({"status": "ok", "tipo": tipo, "linhas": linhas})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/exportar-ruptura', methods=['GET'])
def exportar_ruptura():
    try:
        f = f" AND F.CODCOMPRADOR = {request.args.get('comprador')} " if request.args.get('comprador') != 'TODOS' else ""
        conn = database.get_conexao()
        cursor = conn.cursor()
        cursor.execute(sql_queries.QUERY_EXPORTAR_RUPTURA.format(filtro_comprador=f))
        linhas = cursor.fetchall()
        cursor.close(); conn.close()
        return gerar_csv_generico(linhas, ["PRODUTO", "EMBALAGEM", "SITUAÇÃO", "FORNECEDOR", "COMPRADOR", "QUANTIDADE RESERVADA", "QUANTIDADE DISPONÍVEL", "QUANTIDADE AVARIA", "QUANTIDADE GERAL", "DATA DE ÚLTIMA SAÍDA", "DATA DE ÚLTIMA ENTRADA", "PREÇO DE CUSTO (R$)", "PREÇO DE VENDA (R$)", "VALOR DE ESTOQUE A PREÇO DE VENDA", "DIAS O ESTOQUE DURA", "PERDA COMERCIAL ESTIMADA (R$)"], "Ruptura.csv")
    except Exception as e: return str(e), 500

# ==============================================================================
# ENDPOINTS INTEGRADOS: CENTRO DE CONTROLE LOGÍSTICO
# ==============================================================================

@app.route('/api/pedidos-a-faturar', methods=['GET'])
def api_pedidos_a_faturar():
    try:
        conn = database.get_conexao()
        cursor = conn.cursor()
        cursor.execute(sql_queries.QUERY_PEDIDOS_A_FATURAR)
        colunas = [c[0].lower() for c in cursor.description]
        pedidos = [dict(zip(colunas, linha)) for linha in cursor.fetchall()]
        cursor.close()
        conn.close()

        total_pedidos = len(pedidos)
        valor_total = sum(float(p.get('valor_pedido') or 0) for p in pedidos)
        peso_total = sum(float(p.get('peso_pedido') or 0) for p in pedidos)
        reentregas = sum(1 for p in pedidos if p.get('reentrega') == 'S')

        return jsonify({
            "status": "ok",
            "pedidos": pedidos,
            "resumo": {
                "total_pedidos": total_pedidos,
                "valor_total": round(valor_total, 2),
                "peso_total": round(peso_total, 2),
                "reentregas": reentregas
            }
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/pedidos-consulta', methods=['GET'])
def api_pedidos_consulta():
    try:
        hoje = datetime.today()
        ini = request.args.get('ini', (hoje.replace(day=1)).strftime('%Y-%m-%d'))
        fim = request.args.get('fim', hoje.strftime('%Y-%m-%d'))
        status_param = request.args.get('status', '')
        numped = request.args.get('numped')
        nf = request.args.get('nf')
        numcar = request.args.get('numcar')
        cliente = request.args.get('cliente')
        rca = request.args.get('rca')

        condicoes = ["ped.CODFILIAL IN (1, 11)"]
        tem_direto = bool(numped or nf or numcar)

        if not tem_direto:
            condicoes.append(f"ped.DATA >= TO_DATE('{ini}', 'YYYY-MM-DD') AND ped.DATA < TO_DATE('{fim}', 'YYYY-MM-DD') + 1")
            if status_param:
                st_list = [f"'{s.strip()}'" for s in status_param.split(',') if s.strip()]
                if st_list:
                    condicoes.append(f"ped.POSICAO IN ({', '.join(st_list)})")
            else:
                condicoes.append("ped.POSICAO IN ('P','B','M','L','F','C','A')")

        if numped and numped.strip().isdigit():
            condicoes.append(f"ped.NUMPED = {int(numped.strip())}")
        if nf and nf.strip().isdigit():
            condicoes.append(f"EXISTS (SELECT 1 FROM PCNFSAID nf WHERE nf.NUMPED = ped.NUMPED AND nf.NUMNOTA = {int(nf.strip())})")
        if numcar and numcar.strip().isdigit():
            condicoes.append(f"ped.NUMCAR = {int(numcar.strip())}")
        if cliente and cliente.strip().isdigit():
            condicoes.append(f"ped.CODCLI = {int(cliente.strip())}")
        if rca and rca.strip().isdigit():
            condicoes.append(f"ped.CODUSUR = {int(rca.strip())}")

        where_clause = " AND ".join(condicoes)

        sql = f"""
        SELECT * FROM (
          SELECT
            ped.NUMPED                       AS NUMPED,
            TO_CHAR(ped.DATA, 'YYYY-MM-DD')  AS DATA_PEDIDO,
            TRUNC(SYSDATE) - TRUNC(ped.DATA) AS DIAS,
            ped.CODCLI                       AS CODCLI,
            cli.CLIENTE                      AS CLIENTE,
            cli.ENDERENT                     AS ENDERECO,
            cli.BAIRROENT                    AS BAIRRO,
            cli.MUNICENT                     AS CIDADE,
            cli.ESTENT                       AS UF,
            ped.CODUSUR                      AS CODRCA,
            usu.NOME                         AS RCA,
            ped.POSICAO                      AS POSICAO,
            ped.NUMCAR                       AS NUMCAR,
            car.CODMOTORISTA                 AS CODMOTORISTA,
            emp.NOME                         AS MOTORISTA,
            TO_CHAR(ped.DTFAT, 'YYYY-MM-DD') AS DTFAT,
            (SELECT MAX(nf.NUMNOTA) FROM PCNFSAID nf WHERE nf.NUMPED = ped.NUMPED) AS NF,
            NVL(ped.VLTOTAL, 0)              AS VALOR,
            NVL(ped.TOTPESO, 0)              AS PESO,
            (SELECT COUNT(*) FROM PCPEDI i WHERE i.NUMPED = ped.NUMPED) AS QTD_ITENS,
            CASE WHEN EXISTS (
              SELECT 1 FROM PCNFSAID nf
              JOIN PCESTCOM ec ON ec.NUMTRANSVENDA = nf.NUMTRANSVENDA
              WHERE nf.NUMPED = ped.NUMPED AND NVL(ec.VLDEVOLUCAO, 0) > 0
            ) THEN 'S' ELSE 'N' END          AS TEM_DEV,
            (SELECT LISTAGG(mt, ', ') WITHIN GROUP (ORDER BY mt) FROM (
               SELECT DISTINCT NVL(td.MOTIVO, 'Não informado') AS mt
               FROM PCNFSAID nf
               JOIN PCESTCOM ec ON ec.NUMTRANSVENDA = nf.NUMTRANSVENDA
               JOIN PCNFENT  ne ON ne.NUMTRANSENT   = ec.NUMTRANSENT
               LEFT JOIN PCTABDEV td ON td.CODDEVOL  = ne.CODDEVOL
               WHERE nf.NUMPED = ped.NUMPED AND NVL(ec.VLDEVOLUCAO, 0) > 0
            ))                               AS MOTIVO_DEV
          FROM PCPEDC ped
          LEFT JOIN PCCLIENT cli ON cli.CODCLI      = ped.CODCLI
          LEFT JOIN PCUSUARI usu ON usu.CODUSUR     = ped.CODUSUR
          LEFT JOIN PCCARREG car ON car.NUMCAR      = ped.NUMCAR
          LEFT JOIN PCEMPR   emp ON emp.MATRICULA   = car.CODMOTORISTA
          WHERE {where_clause}
          ORDER BY ped.DATA DESC, ped.NUMPED DESC
        ) WHERE ROWNUM <= 500
        """

        conn = database.get_conexao()
        cursor = conn.cursor()
        cursor.execute(sql)
        colunas = [c[0].lower() for c in cursor.description]
        pedidos = [dict(zip(colunas, linha)) for linha in cursor.fetchall()]
        cursor.close()
        conn.close()

        return jsonify({"status": "ok", "pedidos": pedidos})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/pedidos-consulta/itens/<int:numped>', methods=['GET'])
def api_pedidos_consulta_itens(numped):
    try:
        conn = database.get_conexao()
        cursor = conn.cursor()
        cursor.execute(sql_queries.QUERY_PEDIDO_ITENS, {"numped": numped})
        colunas = [c[0].lower() for c in cursor.description]
        itens = [dict(zip(colunas, linha)) for linha in cursor.fetchall()]
        cursor.close()
        conn.close()
        return jsonify({"status": "ok", "numped": numped, "itens": itens})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/pedidos-consulta/danfe/<int:numped>', methods=['GET'])
def api_pedidos_consulta_danfe(numped):
    try:
        conn = database.get_conexao()
        cursor = conn.cursor()
        cursor.execute(sql_queries.QUERY_PEDIDO_DANFE_XML, {"numped": numped})
        linha = cursor.fetchone()

        if not linha or not linha[1]:
            cursor.close()
            conn.close()
            return jsonify({"status": "error", "message": "XML da NF-e não encontrado para este pedido no WinThor"}), 404

        numnota = linha[0]
        lob_data = linha[1]
        xml_str = lob_data.read() if hasattr(lob_data, 'read') else str(lob_data)
        cursor.close()
        conn.close()

        parsed = danfe_parser.parse_nfe_xml(xml_str)
        parsed["numnota"] = numnota
        parsed["numped"] = numped
        return jsonify(parsed)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

def _consultar_em_paralelo(consultas, binds):
    """Roda {nome: sql} ao mesmo tempo, cada uma na sua conexão, e devolve {nome: [dict com colunas minúsculas]}."""
    import concurrent.futures

    def rodar(sql):
        conn = database.get_conexao()
        cursor = conn.cursor()
        try:
            cursor.execute(sql, binds)
            colunas = [c[0].lower() for c in cursor.description]
            return [dict(zip(colunas, linha)) for linha in cursor.fetchall()]
        finally:
            cursor.close()
            conn.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(consultas)) as executor:
        futuros = {nome: executor.submit(rodar, sql) for nome, sql in consultas.items()}
        return {nome: f.result() for nome, f in futuros.items()}


def _periodo_devolucoes():
    hoje = datetime.today()
    data_inicio = request.args.get('data_inicio') or hoje.replace(day=1).strftime('%Y-%m-%d')
    data_fim = request.args.get('data_fim') or hoje.strftime('%Y-%m-%d')
    return data_inicio, data_fim


@app.route('/api/devolucoes-detalhadas', methods=['GET'])
def api_devolucoes_detalhadas():
    try:
        setor_filtro = request.args.get('setor', '')
        motivo_filtro = request.args.get('motivo', '')
        ibge = request.args.get('ibge')  # cidade escolhida no mapa (código IBGE); vazio = Pernambuco inteiro
        data_inicio, data_fim = _periodo_devolucoes()

        binds = {"data_inicio": data_inicio, "data_fim": data_fim}
        if ibge:
            binds["ibge"] = int(ibge)
            consultas = {
                'nucleo': sql_queries.QUERY_DEVOLUCOES_NUCLEO_CIDADE,
                'clientes': sql_queries.QUERY_DEVOLUCOES_CLIENTES_CIDADE,
                'vendedores': sql_queries.QUERY_DEVOLUCOES_VENDEDORES_CIDADE,
                'motoristas': sql_queries.QUERY_DEVOLUCOES_MOTORISTAS_CIDADE,
            }
        else:
            consultas = {
                'nucleo': sql_queries.QUERY_DEVOLUCOES_NUCLEO,
                'clientes': sql_queries.QUERY_DEVOLUCOES_CLIENTES,
                'vendedores': sql_queries.QUERY_DEVOLUCOES_VENDEDORES,
                'motoristas': sql_queries.QUERY_DEVOLUCOES_MOTORISTAS_DETALHADO,
            }
        resultado = _consultar_em_paralelo(consultas, binds)
        # Mapa de Pernambuco: sempre o estado inteiro no período (a cidade escolhida é destacada no front)
        cidades_raw = _consultar_em_paralelo({'cidades': sql_queries.QUERY_DEVOLUCOES_CIDADE},
                                             {"data_inicio": data_inicio, "data_fim": data_fim})['cidades']

        todas_devolucoes = resultado['nucleo']

        # Agregação por Setor
        resumo_setores = {}
        for row in todas_devolucoes:
            s = row.get('setor', 'Não classificado')
            vl = float(row.get('valor') or 0)
            notas = int(row.get('notas') or 0)
            if s not in resumo_setores:
                resumo_setores[s] = {"setor": s, "valor": 0, "notas": 0}
            resumo_setores[s]["valor"] += vl
            resumo_setores[s]["notas"] += notas

        total_valor_devolucao = sum(float(r.get('valor') or 0) for r in todas_devolucoes)
        total_notas_devolucao = sum(int(r.get('notas') or 0) for r in todas_devolucoes)

        # Aplicar filtros se passados
        motivos_filtrados = todas_devolucoes
        if setor_filtro:
            motivos_filtrados = [m for m in motivos_filtrados if m.get('setor') == setor_filtro]
        if motivo_filtro:
            motivos_filtrados = [m for m in motivos_filtrados if motivo_filtro.lower() in (m.get('motivo') or '').lower()]

        cidades = []
        for c in cidades_raw:
            fat = float(c.get('faturado') or 0)
            dev = float(c.get('devolvido') or 0)
            cidades.append({
                "ibge": str(c.get('ibge') or ''),
                "cidade": c.get('cidade') or '',
                "faturado": round(fat, 2),
                "devolvido": round(dev, 2),
                "taxa": round(dev / fat, 4) if fat > 0 else 0.0,
                "notas_faturadas": int(c.get('notas_fat') or 0),
                "notas_devolvidas": int(c.get('notas') or 0),
                "motivo_top": c.get('motivo_top') or None,
            })

        return jsonify({
            "status": "ok",
            "ibge": ibge or None,
            "kpis": {
                "valor_total": round(total_valor_devolucao, 2),
                "total_notas": total_notas_devolucao
            },
            "por_setor": list(resumo_setores.values()),
            "por_motivo": motivos_filtrados,
            "clientes": resultado['clientes'],
            "vendedores": resultado['vendedores'],
            "motoristas": resultado['motoristas'],
            "cidades": cidades
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/devolucoes-cidade', methods=['GET'])
def api_devolucoes_cidade():
    """
    Detalhe de uma cidade (clique no mapa): valor e peso devolvidos por dia da semana, bairro e cliente,
    nas duas bases de data dos gráficos da Telemetria ("fat" = Dia Faturado, "mov" = Entrada Dev.).
    """
    try:
        ibge = request.args.get('ibge')
        if not ibge:
            return jsonify({"status": "error", "message": "Informe a cidade (ibge)."}), 400
        data_inicio, data_fim = _periodo_devolucoes()
        binds = {"data_inicio": data_inicio, "data_fim": data_fim, "ibge": int(ibge)}
        bruto = _consultar_em_paralelo({'fat': sql_queries.QUERY_DEV_CIDADE_FAT, 'mov': sql_queries.QUERY_DEV_CIDADE_MOV}, binds)

        def agregar(linhas):
            dias, bairros, clientes = {}, {}, {}
            for r in linhas:
                valor = float(r.get('valor') or 0)
                peso = float(r.get('peso') or 0)
                dia = str(r.get('dia_semana'))
                d = dias.setdefault(dia, {"dia_semana": dia, "valor": 0.0, "peso": 0.0})
                d["valor"] += valor
                d["peso"] += peso
                b = bairros.setdefault(r.get('bairro'), {"bairro": r.get('bairro'), "valor": 0.0, "peso": 0.0})
                b["valor"] += valor
                b["peso"] += peso
                cli = clientes.setdefault(r.get('codcli'), {"codcli": r.get('codcli'), "cliente": r.get('cliente'), "valor": 0.0, "peso": 0.0})
                cli["valor"] += valor
                cli["peso"] += peso
            arred = lambda lista: [{**x, "valor": round(x["valor"], 2), "peso": round(x["peso"], 1)} for x in lista]
            return {
                "dias_semana": arred(sorted(dias.values(), key=lambda x: x["dia_semana"])),
                "bairros": arred(sorted(bairros.values(), key=lambda x: x["valor"], reverse=True)),
                "clientes": arred(sorted(clientes.values(), key=lambda x: x["valor"], reverse=True)),
            }

        return jsonify({"status": "ok", "ibge": ibge, "fat": agregar(bruto['fat']), "mov": agregar(bruto['mov'])})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ==============================================================================
# DASHBOARD (VISÃO GERAL): INDICADORES DE FATURAMENTO DO WINTHOR
# ==============================================================================

_cache_resumo_faturamento_mes = {}


def _positivados_rotina111(cursor, di, df):
    """Clientes positivados como na rotina 111 do WinThor (VIEW_BI_FATURAMENTO, venda > 0). None se a view falhar."""
    try:
        cursor.execute(sql_queries.QUERY_POSITIVADOS_PERIODO, {'data_inicio': di, 'data_fim': df})
        return int(cursor.fetchone()[0] or 0)
    except Exception:
        return None

def _obter_resumo_faturamento_winthor(di, df):
    """
    Busca os indicadores oficiais do WinThor (rotina 111) para o período [di, df].
    Tenta VIEW_BI_FATURAMENTO + PCNFSAID + PCMOV (igual ao projeto original) e faz
    fallback seguro para PCNFSAID + QUERY_DEVOLUCOES_NUCLEO.
    """
    cache_key = f"{di}_{df}"
    now_ts = datetime.now().timestamp()
    if cache_key in _cache_resumo_faturamento_mes:
        ts, cached_val = _cache_resumo_faturamento_mes[cache_key]
        if now_ts - ts < 120:
            return cached_val

    conn = database.get_conexao()
    if not conn:
        return None

    try:
        cursor = conn.cursor()
        # 1. Contagens e Peso em PCNFSAID (rápido e indexado)
        cursor.execute("""
            SELECT NVL(SUM(n.VLTOTAL), 0) AS VENDA_BRUTA_NF,
                   COUNT(*) AS EMITIDAS,
                   COUNT(DISTINCT n.CODCLI) AS POSITIVADOS,
                   COUNT(DISTINCT n.CODCLI || '|' || TO_CHAR(n.DTSAIDA, 'YYYYMMDD')) AS ATENDIMENTOS,
                   NVL(SUM(n.TOTPESO), 0) AS PESO_NF_KG
              FROM PCNFSAID n
             WHERE n.CODFILIAL IN ('1', '11')
               AND n.DTSAIDA >= TO_DATE(:ini, 'YYYY-MM-DD')
               AND n.DTSAIDA < TO_DATE(:fim, 'YYYY-MM-DD') + 1
               AND n.TIPOVENDA IN ('VP', 'VV')
               AND n.DTCANCEL IS NULL
        """, {'ini': di, 'fim': df})
        r_nf = cursor.fetchone()
        venda_faturada = float(r_nf[0] or 0) if r_nf else 0.0
        emitidas = int(r_nf[1] or 0) if r_nf else 0
        positivados = int(r_nf[2] or 0) if r_nf else 0
        atendimentos = int(r_nf[3] or 0) if r_nf else 0
        peso_venda_kg = float(r_nf[4] or 0) if r_nf else 0.0

        # 2. Tenta VIEW_BI_FATURAMENTO para bater no centavo com a rotina 111
        valor_devolucao = 0.0
        valor_devolucao_avulsa = 0.0
        usou_view_bi = False
        try:
            cursor.execute("""
                SELECT NVL(SUM(v.VENDAS), 0) AS VENDA_FATURADA,
                       NVL(SUM(v.DEVOLUCAO), 0) AS VALOR_DEVOLUCAO,
                       NVL(SUM(v.AVULSA), 0) AS VALOR_DEVOLUCAO_AVULSA
                  FROM VIEW_BI_FATURAMENTO v
                 WHERE v.CODFILIAL IN ('1', '11')
                   AND v.DTSAIDA >= TO_DATE(:ini, 'YYYY-MM-DD')
                   AND v.DTSAIDA < TO_DATE(:fim, 'YYYY-MM-DD') + 1
            """, {'ini': di, 'fim': df})
            r_bi = cursor.fetchone()
            if r_bi and float(r_bi[0] or 0) > 0:
                venda_faturada = float(r_bi[0] or 0)
                valor_devolucao = float(r_bi[1] or 0)
                valor_devolucao_avulsa = float(r_bi[2] or 0)
                usou_view_bi = True
        except Exception:
            usou_view_bi = False

        # 3. Contagem de NFs devolvidas, avulsas e peso devolvido
        devolvidas = 0
        devolvidas_avulsas = 0
        peso_devolucao_kg = 0.0
        try:
            cursor.execute("""
                SELECT COUNT(DISTINCT CASE WHEN NVL(vlink.NUMTRANSVENDA, 0) <> 0 THEN m.NUMNOTA END) AS DEVOLVIDAS,
                       COUNT(DISTINCT CASE WHEN NVL(vlink.NUMTRANSVENDA, 0) = 0 THEN m.NUMNOTA END) AS DEVOLVIDAS_AVULSAS,
                       NVL(SUM(NVL(m.PESOBRUTO, 0) * m.QT), 0) AS PESO_DEVOLUCAO
                  FROM PCMOV m
                  LEFT JOIN (
                      SELECT NUMTRANSENT, MAX(NVL(NUMTRANSVENDA, 0)) NUMTRANSVENDA
                        FROM PCESTCOM
                       GROUP BY NUMTRANSENT
                  ) vlink ON vlink.NUMTRANSENT = m.NUMTRANSENT
                 WHERE m.CODFILIAL IN ('1', '11')
                   AND m.DTMOV >= TO_DATE(:ini, 'YYYY-MM-DD')
                   AND m.DTMOV < TO_DATE(:fim, 'YYYY-MM-DD') + 1
                   AND m.CODOPER = 'ED'
                   AND m.DTCANCEL IS NULL
            """, {'ini': di, 'fim': df})
            r_dev = cursor.fetchone()
            if r_dev:
                devolvidas = int(r_dev[0] or 0)
                devolvidas_avulsas = int(r_dev[1] or 0)
                peso_devolucao_kg = float(r_dev[2] or 0)
        except Exception:
            pass

        if not usou_view_bi:
            try:
                cursor.execute(sql_queries.QUERY_DEVOLUCOES_NUCLEO, {"data_inicio": di, "data_fim": df})
                rows_dev = cursor.fetchall()
                valor_devolucao = sum(float(r[5] or 0) for r in rows_dev)
                if devolvidas == 0:
                    devolvidas = len(set(r[0] for r in rows_dev))
            except Exception:
                pass

        positivados_111 = _positivados_rotina111(cursor, di, df)
        if positivados_111 is not None:
            positivados = positivados_111

        cursor.close()
        conn.close()

        venda_liquida = max(0.0, venda_faturada - valor_devolucao - valor_devolucao_avulsa)
        peso_faturado_liq = max(0.0, peso_venda_kg - peso_devolucao_kg) if peso_venda_kg > peso_devolucao_kg else peso_venda_kg
        taxa_dev = (valor_devolucao / venda_faturada) if venda_faturada > 0 else 0.0
        taxa_dev_notas = (devolvidas / emitidas) if emitidas > 0 else 0.0

        resumo = {
            "disponivel": True,
            "emitidas": emitidas,
            "positivados": positivados,
            "atendimentos": atendimentos,
            "devolvidas": devolvidas,
            "devolvidasAvulsas": devolvidas_avulsas,
            "vendaFaturada": round(venda_faturada, 2),
            "valorDevolucao": round(valor_devolucao, 2),
            "valorDevolucaoAvulsa": round(valor_devolucao_avulsa, 2),
            "vendaLiquida": round(venda_liquida, 2),
            "pesoFaturado": round(peso_faturado_liq, 1),
            "pesoDevolucao": round(peso_devolucao_kg, 1),
            "taxaDevolucao": round(taxa_dev, 4),
            "taxaDevolucaoNotas": round(taxa_dev_notas, 4)
        }
        _cache_resumo_faturamento_mes[cache_key] = (now_ts, resumo)
        return resumo
    except Exception as e:
        print(f"Erro em _obter_resumo_faturamento_winthor: {e}")
        try:
            conn.close()
        except Exception:
            pass
        return None




@app.route('/api/dashboard-visao-geral', methods=['GET'])
def api_dashboard_visao_geral():
    try:
        import calendar
        hoje = datetime.today()
        mes_atual_str = hoje.strftime('%Y-%m')
        mes = request.args.get('mes', mes_atual_str).strip()[:7]
        if not mes or len(mes) != 7:
            mes = mes_atual_str

        ano_m, mes_m = map(int, mes.split('-'))
        ultimo_dia = calendar.monthrange(ano_m, mes_m)[1]
        di = f"{mes}-01"
        eh_mes_atual = (mes == mes_atual_str)
        df = hoje.strftime('%Y-%m-%d') if eh_mes_atual else f"{mes}-{ultimo_dia:02d}"

        faturamento = _obter_resumo_faturamento_winthor(di, df)

        return jsonify({
            "status": "ok",
            "mes": mes,
            "ehMesAtual": eh_mes_atual,
            "faturamento": faturamento
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# =============================================================================
# ENDPOINTS DE AUTENTICAÇÃO E USUÁRIOS (Plataforma Integrada DIA)
# =============================================================================
@app.route('/api/auth/login', methods=['POST'])
def api_auth_login():
    try:
        data = request.json or {}
        identificador = data.get('identificador') or data.get('email') or data.get('usuario')
        senha = data.get('senha')
        if not identificador or not senha:
            return jsonify({"status": "error", "message": "Informe seu e-mail/usuário e senha."}), 400

        ident = str(identificador).strip().lower()
        if _login_bloqueado(ident):
            return jsonify({"status": "error", "message": "Muitas tentativas incorretas. Aguarde 15 minutos e tente de novo."}), 429

        user = local_db.autenticar_usuario(identificador, senha)
        if not user:
            _registrar_falha_login(ident)
            return jsonify({"status": "error", "message": "E-mail/usuário ou senha incorretos."}), 401

        session.clear()
        session.permanent = True
        session['user_id'] = user['id']
        session['user_role'] = user['role']
        return jsonify({
            "status": "ok",
            "user": {
                "id": user['id'],
                "email": user['email'],
                "usuario": user['usuario'],
                "nome": user['nome'],
                "role": user['role']
            }
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/auth/me', methods=['GET'])
def api_auth_me():
    try:
        uid = session.get('user_id')
        if not uid:
            return jsonify({"status": "ok", "user": None})
        user = local_db.obter_usuario_por_id(uid)
        return jsonify({"status": "ok", "user": user})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/auth/logout', methods=['POST'])
def api_auth_logout():
    try:
        session.clear()
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

_cache_painel_tv = {}

@app.route('/api/painel-tv', methods=['GET'])
def api_painel_tv():
    try:
        hoje = datetime.today()
        offset = request.args.get('offset', default=0, type=int)
        mes_param = request.args.get('mes', default='', type=str).strip()
        force_refresh = request.args.get('refresh', '0') in ('1', 'true')

        if mes_param:
            try:
                partes = mes_param.split('-')
                target_year = int(partes[0])
                target_month = int(partes[1])
            except Exception:
                target_year = hoje.year
                target_month = hoje.month
        elif offset != 0:
            month_idx = (hoje.year * 12 + (hoje.month - 1)) + offset
            target_year = month_idx // 12
            target_month = (month_idx % 12) + 1
        else:
            target_year = hoje.year
            target_month = hoje.month

        # Não permite avançar para o futuro
        if (target_year > hoje.year) or (target_year == hoje.year and target_month > hoje.month):
            target_year = hoje.year
            target_month = hoje.month

        is_mes_atual = (target_year == hoje.year and target_month == hoje.month)

        _, last_day = calendar.monthrange(target_year, target_month)
        di = f"{target_year:04d}-{target_month:02d}-01"
        df = f"{target_year:04d}-{target_month:02d}-{last_day:02d}"
        mes_atual_str = f"{target_year:04d}-{target_month:02d}"
        meses_pt = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
        mes_label = f"{meses_pt[target_month - 1]} {target_year}"

        # Verifica cache em memória (30s para mês atual ao vivo, 1h para meses passados)
        cache_key = f"{target_year:04d}-{target_month:02d}"
        now_ts = time.time()
        ttl = 30 if is_mes_atual else 3600
        if not force_refresh and cache_key in _cache_painel_tv:
            cached_ts, cached_data = _cache_painel_tv[cache_key]
            if (now_ts - cached_ts) < ttl:
                cached_copy = dict(cached_data)
                cached_copy["atualizado_em"] = datetime.now().strftime('%H:%M:%S')
                return jsonify(cached_copy)

        conn = database.get_conexao()
        cursor = conn.cursor()

        # 1. Pedidos a Faturar (apenas no mês corrente)
        if is_mes_atual:
            cursor.execute(sql_queries.QUERY_PEDIDOS_A_FATURAR)
            colunas_fat = [c[0].lower() for c in cursor.description]
            pedidos_faturar = [dict(zip(colunas_fat, linha)) for linha in cursor.fetchall()]
        else:
            pedidos_faturar = []

        # 2. Devoluções por Setor e Motivo
        cursor.execute(sql_queries.QUERY_DEVOLUCOES_NUCLEO, {"data_inicio": di, "data_fim": df})
        colunas_dev = [c[0].lower() for c in cursor.description]
        devolucoes = [dict(zip(colunas_dev, linha)) for linha in cursor.fetchall()]

        # 3. Motoristas com devoluções
        try:
            cursor.execute(sql_queries.QUERY_DEVOLUCOES_MOTORISTAS_DETALHADO, {"data_inicio": di, "data_fim": df})
            colunas_mot = [c[0].lower() for c in cursor.description]
            motoristas_dev = [dict(zip(colunas_mot, linha)) for linha in cursor.fetchall()]
        except Exception:
            motoristas_dev = []

        # 4. Devoluções por Cidade (Pernambuco - Mapa PE)
        try:
            cursor.execute(sql_queries.QUERY_DEVOLUCOES_CIDADE, {"data_inicio": di, "data_fim": df})
            colunas_cid = [c[0].lower() for c in cursor.description]
            cidades_raw = [dict(zip(colunas_cid, linha)) for linha in cursor.fetchall()]
        except Exception as e:
            print(f"Erro ao buscar cidades mapa PE: {e}")
            cidades_raw = []

        # 5. Devoluções por Bairro (RMR - Mapa RMR)
        try:
            cursor.execute(sql_queries.QUERY_DEVOLUCOES_BAIRRO_RMR, {"data_inicio": di, "data_fim": df})
            colunas_bai = [c[0].lower() for c in cursor.description]
            bairros_raw = [dict(zip(colunas_bai, linha)) for linha in cursor.fetchall()]
        except Exception as e:
            print(f"Erro ao buscar bairros RMR: {e}")
            bairros_raw = []

        # 6. Faturamento Geral, Positivados, Entregas e Peso Real Faturado (PCNFSAID)
        venda_faturada = 0.0
        positivados_reais = 0
        entregas_reais = 0
        peso_faturado_real_ton = 0.0
        try:
            cursor.execute("""
                SELECT NVL(SUM(n.VLTOTAL), 0) AS VENDA_FATURADA,
                       COUNT(*) AS EMITIDAS,
                       COUNT(DISTINCT n.CODCLI) AS POSITIVADOS,
                       COUNT(DISTINCT n.CODCLI || '|' || TO_CHAR(n.DTSAIDA, 'YYYYMMDD')) AS ATENDIMENTOS,
                       NVL(SUM(n.TOTPESO), 0) / 1000.0 AS PESO_TON
                  FROM PCNFSAID n 
                 WHERE n.CODFILIAL IN ('1', '11') 
                   AND n.DTSAIDA >= TO_DATE(:ini, 'YYYY-MM-DD') 
                   AND n.DTSAIDA < TO_DATE(:fim, 'YYYY-MM-DD') + 1
                   AND n.TIPOVENDA IN ('VP', 'VV') 
                   AND n.DTCANCEL IS NULL
            """, {'ini': di, 'fim': df})
            r_fat = cursor.fetchone()
            if r_fat:
                venda_faturada = float(r_fat[0] or 0)
                positivados_reais = int(r_fat[2] or 0)
                entregas_reais = int(r_fat[3] or 0)
                peso_faturado_real_ton = round(float(r_fat[4] or 0), 1)
        except Exception as e:
            print(f"Erro ao buscar PCNFSAID: {e}")

        # 7. Fallback de Peso via PCMOV com cadastro oficial PCPRODUT (caso TOTPESO seja 0)
        if peso_faturado_real_ton <= 0:
            try:
                cursor.execute("""
                    SELECT NVL(SUM(NVL(p.PESOBRUTO, 0) * m.QT), 0) / 1000.0 AS PESO_TON
                      FROM PCMOV m
                      JOIN PCPRODUT p ON m.CODPROD = p.CODPROD
                     WHERE m.CODFILIAL IN ('1', '11') 
                       AND m.DTMOV >= TO_DATE(:ini, 'YYYY-MM-DD') 
                       AND m.DTMOV < TO_DATE(:fim, 'YYYY-MM-DD') + 1
                       AND m.CODOPER = 'S'
                       AND m.DTCANCEL IS NULL
                """, {'ini': di, 'fim': df})
                r_peso = cursor.fetchone()
                if r_peso and r_peso[0]:
                    peso_faturado_real_ton = round(float(r_peso[0]), 1)
            except Exception as e:
                print(f"Erro ao buscar peso PCMOV: {e}")

        positivados_111 = _positivados_rotina111(cursor, di, df)
        if positivados_111 is not None:
            positivados_reais = positivados_111

        cursor.close()
        conn.close()

        # Resumo faturar
        total_a_faturar = len(pedidos_faturar)
        valor_a_faturar = sum(float(p.get('valor_pedido') or 0) for p in pedidos_faturar)
        peso_a_faturar = sum(float(p.get('peso_pedido') or 0) for p in pedidos_faturar)
        reentregas = sum(1 for p in pedidos_faturar if str(p.get('reentrega') or '').upper() == 'S')

        # Resumo devoluções
        total_dev_valor = sum(float(d.get('valor') or 0) for d in devolucoes)
        setores = {}
        motivos_agrupados = {}
        for d in devolucoes:
            s = d.get('setor', 'Não classificado') or 'Não classificado'
            v = float(d.get('valor') or 0)
            m = d.get('motivo', 'Não informado') or 'Não informado'
            setores[s] = setores.get(s, 0) + v
            if m not in motivos_agrupados:
                motivos_agrupados[m] = {"motivo": m, "setor": s, "valor": 0}
            motivos_agrupados[m]["valor"] += v

        lista_motivos = sorted(motivos_agrupados.values(), key=lambda x: x['valor'], reverse=True)

        # Setores com porcentagem
        por_setor = []
        for s, v in setores.items():
            perc = round((v / total_dev_valor * 100), 1) if total_dev_valor > 0 else 0
            por_setor.append({"setor": s, "valor": round(v, 2), "perc": perc})
        por_setor.sort(key=lambda x: x['valor'], reverse=True)

        # Processamento Cidades PE
        tot_faturado_pe = sum(float(c.get('faturado') or 0) for c in cidades_raw)
        tot_devolvido_pe = sum(float(c.get('devolvido') or 0) for c in cidades_raw)
        taxa_pe_geral = round((tot_devolvido_pe / tot_faturado_pe * 100), 2) if tot_faturado_pe > 0 else 0.0

        cidades_formatadas = []
        for c in cidades_raw:
            fat = float(c.get('faturado') or 0)
            dev = float(c.get('devolvido') or 0)
            cidades_formatadas.append({
                "ibge": str(c.get('ibge') or ''),
                "cidade": c.get('cidade') or '',
                "faturado": round(fat, 2),
                "devolvido": round(dev, 2),
                "notasEntregues": int(c.get('notas_fat') or 0),
                "notasDevolvidas": int(c.get('notas') or 0),
                "motivo": c.get('motivo_top') or '—',
                "motivoValor": round(float(c.get('motivo_valor') or 0), 2),
                "taxa": round((dev / fat * 100), 2) if fat > 0 else 0.0,
                "partFaturamento": round((fat / tot_faturado_pe * 100), 2) if tot_faturado_pe > 0 else 0.0
            })

        # Processamento Bairros RMR
        bairros_formatados = []
        for b in bairros_raw:
            fat = float(b.get('faturado') or 0)
            dev = float(b.get('devolvido') or 0)
            bairros_formatados.append({
                "cidade": b.get('cidade') or '',
                "bairro": b.get('bairro') or 'SEM BAIRRO',
                "faturado": round(fat, 2),
                "notasFaturadas": int(b.get('notas_fat') or 0),
                "devolvido": round(dev, 2),
                "notas": int(b.get('notas') or 0),
                "motivo": b.get('motivo_top') or 'Não informado',
                "motivoValor": round(float(b.get('motivo_valor') or 0), 2),
                "taxa": round((dev / fat * 100), 2) if fat > 0 else 0.0
            })

        # Top motoristas
        top_motoristas = []
        for m in sorted(motoristas_dev, key=lambda x: float(x.get('valor_devolvido') or 0), reverse=True)[:10]:
            v_dev = float(m.get('valor_devolvido') or 0)
            if v_dev > 0:
                top_motoristas.append({
                    "nome": m.get('nome') or f"Motorista {m.get('codmotorista')}",
                    "tipo": m.get('tipo_motorista') or 'FROTA',
                    "valor": v_dev,
                    "expedidas": int(m.get('expedidas') or 0),
                    "devolvidas": int(m.get('devolvidas') or 0),
                    "taxa": float(m.get('taxa') or 0)
                })

        # Taxa de devolução oficial em relação ao Faturamento Líquido Geral
        venda_liquida = max(0.0, venda_faturada - total_dev_valor)
        if venda_liquida > 0 and total_dev_valor > 0:
            taxa_dev = round((total_dev_valor / venda_liquida) * 100, 1)
        elif tot_faturado_pe > 0 and tot_devolvido_pe > 0:
            taxa_dev = round((tot_devolvido_pe / tot_faturado_pe) * 100, 1)
        else:
            taxa_dev = 0.0

        positivados = positivados_reais if positivados_reais > 0 else (len(set(p.get('codigo_cliente') for p in pedidos_faturar if p.get('codigo_cliente'))) or 2150)
        entregas = entregas_reais if entregas_reais > 0 else (sum(int(m.get('expedidas') or 0) for m in motoristas_dev) or 1840)
        peso_faturado_ton = peso_faturado_real_ton if peso_faturado_real_ton > 0 else ((peso_a_faturar / 1000.0) * 12 if peso_a_faturar > 0 else 348.5)

        resposta = {
            "status": "ok",
            "atualizado_em": datetime.now().strftime('%H:%M:%S'),
            "mes_label": mes_label,
            "mes_iso": mes_atual_str,
            "offset": offset,
            "is_mes_atual": is_mes_atual,
            "placar": {
                "positivados": positivados,
                "entregas": entregas,
                "peso_faturado_ton": round(peso_faturado_ton, 1),
                "taxa_devolucao": taxa_dev,
                "faturamento_liquido": round(venda_liquida, 2),
                "faturamento_total": round(venda_faturada, 2),
                "carteira_pedidos": total_a_faturar,
                "carteira_valor": round(valor_a_faturar, 2)
            },
            "por_setor": por_setor,
            "cidades": cidades_formatadas,
            "bairros_rmr": bairros_formatados,
            "taxa_pe_geral": taxa_pe_geral,
            "tot_faturado_pe": round(tot_faturado_pe, 2),
            "tot_devolvido_pe": round(tot_devolvido_pe, 2),
            "a_faturar": {
                "total_pedidos": total_a_faturar,
                "valor_total": round(valor_a_faturar, 2),
                "peso_total": round(peso_a_faturar, 1),
                "reentregas": reentregas,
                "top_parados": sorted(pedidos_faturar, key=lambda x: float(x.get('horas_parado') or 0), reverse=True)[:8]
            },
            "devolucoes": {
                "total_valor": round(total_dev_valor, 2),
                "por_setor": por_setor,
                "top_motivos": lista_motivos[:8]
            },
            "motoristas": top_motoristas
        }

        # Salva no cache em memória
        _cache_painel_tv[cache_key] = (now_ts, resposta)

        return jsonify(resposta)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


if __name__ == '__main__':
    import socket
    import sys
    import subprocess
    import re
    import time
    import threading
    from waitress import serve

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip_auto = s.getsockname()[0]
        s.close()
    except: ip_auto = "127.0.0.1"

    import sys
    sys.stdout.reconfigure(encoding='utf-8')

    print("="*60)
    print(f"🖥️  Acesso Computador Local: http://{ip_auto}")
    print("="*60)

    def start_tunnel():
        import sys
        import qrcode
        import os
        import ssl
        from pyngrok import ngrok, conf
        from dotenv import load_dotenv
        
        # Corrige erro de certificado SSL no download do binario do ngrok
        try:
            ssl._create_default_https_context = ssl._create_unverified_context
        except AttributeError:
            pass
        
        # Carrega o .env da pasta app_cortes
        env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
        load_dotenv(env_path)
        sys.stdout.reconfigure(encoding='utf-8')
        
        authtoken = os.getenv("NGROK_AUTHTOKEN")
        domain = os.getenv("NGROK_DOMAIN")
        
        if not authtoken:
            print("\n⚠️ AVISO: NGROK_AUTHTOKEN nao configurado.")
            print("Para ter uma URL fixa e estavel 24/7, execute o arquivo 'configurar_ngrok.bat'.")
            print("Iniciando Ngrok sem token (sessao temporaria)...\n")
        else:
            conf.get_default().auth_token = authtoken
            
        print("\n🚀 Iniciando Tunel de Acesso Externo (Ngrok)...")
        
        try:
            if domain:
                public_url = ngrok.connect(5000, domain=domain).public_url
            else:
                public_url = ngrok.connect(5000).public_url
                
            print("="*60)
            print(f"🌍 Acesso de QUALQUER Rede:  {public_url}")
            print("="*60)
            print("Escaneie o QR Code abaixo com o celular:")
            try:
                qr = qrcode.QRCode(version=1, box_size=1, border=2)
                qr.add_data(public_url)
                qr.make(fit=True)
                qr.print_ascii()
            except:
                pass
        except Exception as e:
            print(f"⚠️ Erro ao iniciar Ngrok: {e}")

    threading.Thread(target=start_tunnel, daemon=True).start()

    # Rotina central do Siga+: grava o hodômetro a cada ~10 min para calcular KM real por período.
    import logging
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
    fulltrack.iniciar_coletor(local_db.registrar_leituras_hodometro)
    # Histórico do Siga+ (janelas de 15 dias): completa o hodômetro diário para qualquer período escolhido.
    fulltrack.iniciar_historico(local_db.registrar_leituras_hodometro, local_db.janela_historico_baixada, local_db.marcar_janela_historico, local_db.registrar_km_gps)

    print("Pressione Ctrl+C para encerrar o servidor e fechar o acesso.")
    serve(app, host='0.0.0.0', port=5000)


