import os
import oracledb
from dotenv import load_dotenv

# Credenciais do Oracle (WinThor) ficam só no .env da pasta app_cortes, nunca no código.
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'), override=False)
USER = os.getenv("ORACLE_USER", "")
PASSWORD = os.getenv("ORACLE_PASSWORD", "")
# O DSN é o endereço: IP, porta (1521 é o padrão) e o nome do banco (Service Name).
DSN = os.getenv("ORACLE_DSN", "")

def testar_conexao():
    try:
        # 1. Tentamos abrir a "porta" de conexão para o banco de dados
        connection = oracledb.connect(user=USER, password=PASSWORD, dsn=DSN)
        print("✅ Sucesso! O Python conseguiu se conectar ao Oracle do Winthor/Harpia.")
        
        # 2. Fechamos a conexão logo em seguida para não sobrecarregar o servidor
        connection.close()

    except Exception as e:
        # 3. Se der erro (senha errada, IP incorreto, firewall barrando), ele avisa qual foi o erro
        print("❌ Ops, não conseguimos conectar. Veja o erro detalhado abaixo:")
        print(e)

# 4. Esta linha diz ao Python para executar o teste assim que rodarmos o arquivo
if __name__ == "__main__":
    testar_conexao()



def get_conexao():
    """Esta função abre a porta do banco e entrega a chave para o app.py"""
    return oracledb.connect(user=USER, password=PASSWORD, dsn=DSN)