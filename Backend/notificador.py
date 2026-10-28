# backend/notificador.py
import os
import time
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
import database
import local_db
import sql_queries

# ==============================================================================
# 1. MAPEAMENTO: SUPERVISORES -> COMPRADORES
# ==============================================================================
# Supervisores, e-mails e compradores ficam em Backend/config_local.json (fora do Git).
# Modelo: Backend/config_local.example.json
SUPERVISORES = local_db.config_local().get("supervisores", {})

# ==============================================================================
# 2. CONFIGURAÇÕES DO GMAIL (SISTEMA DE ENVIO)
# ==============================================================================
EMAIL_REMETENTE = os.getenv("EMAIL_REMETENTE", "")  # definidos no .env (database já carrega o .env)
EMAIL_SENHA = os.getenv("EMAIL_SENHA", "")          # Senha de App gerada no Google
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587

# Defina aqui a hora exata em que o CMD vai disparar os e-mails todos os dias
HORA_ENVIO = "08:00"

def obter_cortes_por_compradores(data_corte, lista_compradores):
    """
    Busca os dados crus dos cortes com o filtro dos compradores.
    Utiliza o extrator limpo do sql_queries.py para o texto visual e o motivo 
    bruto para deduzir a área de origem (Logística/Comercial).
    """
    compradores_str = ",".join(map(str, lista_compradores))
    
    query_notificador = f"""
    SELECT 
        I.CODPROD,
        TO_CHAR(P.CODPROD) || ' - ' || P.DESCRICAO || ' ' || NVL(P.EMBALAGEM, '') AS PRODUTO,
        NVL(COMP.NOME, 'Sem Comprador') AS COMPRADOR,
        I.NUMCAR AS CARREGAMENTO,
        CLI.CLIENTE AS NOME_CLIENTE,
        I.QTCORTADA AS QUANTIDADE_CORTADA,
        I.MOTIVO AS MOTIVO_RAW,
        {sql_queries.EXTRATOR_MOTIVO} AS MOTIVO_CORTE,
        TO_CHAR(I.DATA, 'DD/MM/YYYY HH24:MI') AS DATA_HORA_CORTE,
        NVL(E.QTESTGER, 0) AS ESTOQUE_ATUAL,
        GREATEST((NVL(E.QTESTGER, 0) 
         - NVL((SELECT SUM(ABS(M.QT)) FROM PCMOV M WHERE M.CODPROD = I.CODPROD AND M.CODFILIAL = '1' AND SUBSTR(M.CODOPER,1,1) IN ('E','D') AND TRUNC(M.DTMOV) > TRUNC(I.DATA)), 0)
         + NVL((SELECT SUM(ABS(M.QT)) FROM PCMOV M WHERE M.CODPROD = I.CODPROD AND M.CODFILIAL = '1' AND SUBSTR(M.CODOPER,1,1) IN ('S','R') AND TRUNC(M.DTMOV) > TRUNC(I.DATA)), 0)
        ), 0) AS ESTOQUE_DATA_CORTE
    FROM PCCORTEI I
    JOIN PCPRODUT P ON I.CODPROD = P.CODPROD
    JOIN PCFORNEC FORN ON P.CODFORNEC = FORN.CODFORNEC
    LEFT JOIN PCEMPR COMP ON FORN.CODCOMPRADOR = COMP.MATRICULA
    LEFT JOIN PCCLIENT CLI ON I.CODCLI = CLI.CODCLI
    LEFT JOIN PCEST E ON I.CODPROD = E.CODPROD AND E.CODFILIAL = '1'
    WHERE I.CODFILIAL = '1' AND I.QTCORTADA > 0
      AND I.DATA >= TO_DATE('{data_corte}', 'YYYY-MM-DD') 
      AND I.DATA < TO_DATE('{data_corte}', 'YYYY-MM-DD') + 1
      AND FORN.CODCOMPRADOR IN ({compradores_str})
      {sql_queries.FILTRO_ATIVOS}
    ORDER BY I.DATA DESC
    """
    
    conn = database.get_conexao()
    cursor = conn.cursor()
    cursor.execute(query_notificador)
    colunas = [c[0] for c in cursor.description]
    resultados = [dict(zip(colunas, linha)) for linha in cursor.fetchall()]
    
    cursor.close()
    conn.close()
    
    return resultados

def classificar_area(motivo_raw):
    if motivo_raw and 'USU' in str(motivo_raw).upper():
        return "Logística (Depósito / Separação)"
    return "Comercial / Administrativo"

def formatar_mensagem_texto(nome_supervisor, dados_cortes, data_str):
    if not dados_cortes:
        return None

    cortes_agrupados = {}
    for row in dados_cortes:
        comp = row['COMPRADOR']
        prod = row['PRODUTO']
        
        if comp not in cortes_agrupados:
            cortes_agrupados[comp] = {}
        if prod not in cortes_agrupados[comp]:
            cortes_agrupados[comp][prod] = {
                'carregamentos': set(),
                'clientes': set(),
                'motivos': set(),
                'motivos_raw': set(),
                'quantidade_cortada': 0,
                'data_hora': row['DATA_HORA_CORTE'], 
                'est_atual': row['ESTOQUE_ATUAL'],
                'est_corte': row['ESTOQUE_DATA_CORTE']
            }
            
        if row['CARREGAMENTO']:
            cortes_agrupados[comp][prod]['carregamentos'].add(str(row['CARREGAMENTO']))
        if row['NOME_CLIENTE']:
            cortes_agrupados[comp][prod]['clientes'].add(str(row['NOME_CLIENTE']).strip())
        if row['MOTIVO_CORTE']:
            cortes_agrupados[comp][prod]['motivos'].add(str(row['MOTIVO_CORTE']).strip())
        if row['MOTIVO_RAW']:
            cortes_agrupados[comp][prod]['motivos_raw'].add(str(row['MOTIVO_RAW']).strip())
            
        cortes_agrupados[comp][prod]['quantidade_cortada'] += (row['QUANTIDADE_CORTADA'] or 0)

    texto = f"Olá, {nome_supervisor}.\nSeguem os alertas de cortes de mercadoria registados no dia {data_str}:\n\n"

    for comprador, produtos in cortes_agrupados.items():
        texto += f"==============================================\n"
        texto += f"PRODUTOS DO COMPRADOR: {comprador.upper()}\n"
        texto += f"==============================================\n"
        
        for prod, info in produtos.items():
            motivos_raw_lista = list(info['motivos_raw'])
            area = classificar_area(motivos_raw_lista[0] if motivos_raw_lista else "")
            
            motivos_lista = list(info['motivos'])
            cargas_str = ", ".join(sorted(list(info['carregamentos'])))
            clientes_str = ", ".join(sorted(list(info['clientes'])))
            motivos_str = " / ".join(motivos_lista)
            qtd_total = int(info['quantidade_cortada'])
            
            texto += f"- {prod}\n"
            texto += f"     - Quantidade Cortada: {qtd_total} un.\n"
            texto += f"     - Corte de: {area}\n"
            texto += f"     - Carregamentos: {cargas_str}\n"
            texto += f"     - Clientes Afetados: {clientes_str}\n"
            texto += f"     - Motivo: {motivos_str}\n"
            texto += f"     - Data e hora do corte: {info['data_hora']}\n"
            texto += f"     - Estoque atual: {max(0, info['est_atual'])} un.\n"
            texto += f"     - Estoque no momento do corte: {max(0, info['est_corte'])} un.\n"
            texto += f"\n"
            
    texto += "----------------------------------------------\n"
    texto += "Plataforma Automática de Inteligência de Estoque | DIA DIST"
    return texto

def enviar_email(destinatario, assunto, corpo):
    try:
        msg = MIMEMultipart()
        msg['From'] = f"Alertas DIA DIST <{EMAIL_REMETENTE}>"
        msg['To'] = destinatario
        msg['Subject'] = assunto
        msg.attach(MIMEText(corpo, 'plain', 'utf-8'))

        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(EMAIL_REMETENTE, EMAIL_SENHA)
        server.sendmail(EMAIL_REMETENTE, destinatario, msg.as_string())
        server.quit()
        print(f"✅ E-mail enviado com sucesso para {destinatario}")
    except Exception as e:
        print(f"❌ Erro ao enviar e-mail para {destinatario}: {e}")

def rotina_diaria_alertas():
    # Define a data do relatório (o dia de ontem)
    ontem_obj = datetime.today() - timedelta(days=1)
    data_sql = ontem_obj.strftime('%Y-%m-%d')
    data_formatada = ontem_obj.strftime('%d/%m/%Y')
    
    print(f"\n🚀 Iniciando varredura de cortes para o dia {data_formatada}...")

    for supervisor, configs in SUPERVISORES.items():
        cortes = obter_cortes_por_compradores(data_sql, configs['compradores_ids'])
        mensagem = formatar_mensagem_texto(supervisor, cortes, data_formatada)
        
        if mensagem:
            print(f"Disparando relatório para {supervisor}...")
            assunto = f"⚠️ Alerta Diário de Cortes - {data_formatada}"
            enviar_email(configs['email'], assunto, mensagem)
        else:
            print(f"👍 Nenhum corte registado para a equipa de {supervisor} no dia {data_formatada}.")

def iniciar_servidor_continuo():
    print("="*60)
    print("🚀 Servidor de Notificações Automáticas Iniciado!")
    print(f"⏰ Os relatórios serão disparados diariamente às {HORA_ENVIO}.")
    print("⚠️ Mantenha esta janela do CMD aberta (pode minimizar).")
    print("="*60)
    
    while True:
        # Pega a hora exata no formato HH:MM
        agora = datetime.now().strftime("%H:%M")
        
        if agora == HORA_ENVIO:
            rotina_diaria_alertas()
            
            # Dorme 61 segundos para garantir que o relógio passe para o próximo minuto 
            # e o sistema não envie o e-mail duas vezes no mesmo dia.
            print(f"\n⏳ Rotina concluída. A aguardar até amanhã às {HORA_ENVIO}...")
            time.sleep(61)
            
        # O sistema "dorme" por 30 segundos para não consumir CPU desnecessariamente
        time.sleep(30)

if __name__ == "__main__":
    # Inicia o Loop Infinito
    iniciar_servidor_continuo()