# backend/danfe_parser.py
import xml.etree.ElementTree as ET

def parse_nfe_xml(xml_content):
    """
    Recebe o conteúdo string de um XML de NF-e (layout 4.00) e retorna um dicionário
    estruturado para exibição do DANFE.
    """
    if isinstance(xml_content, bytes):
        xml_content = xml_content.decode('utf-8', errors='ignore')
        
    # Remove declaração de namespace para facilitar queries xpath
    try:
        root = ET.fromstring(xml_content)
    except Exception as e:
        return {"erro": f"Erro ao processar XML: {str(e)}"}
        
    ns = {'nfe': 'http://www.portalfiscal.inf.br/nfe'}
    
    # Suporta tanto <nfeProc> quanto <NFe>
    infNFe = root.find('.//nfe:infNFe', ns)
    if infNFe is None:
        infNFe = root.find('.//infNFe')
        ns = {}
        
    if infNFe is None:
        return {"erro": "Estrutura infNFe não encontrada no XML"}
        
    def find_text(elem, path, default=""):
        if elem is None:
            return default
        node = elem.find(path, ns) if ns else elem.find(path)
        return node.text.strip() if (node is not None and node.text) else default

    # 1. Chave e Identificação
    chave = infNFe.attrib.get('Id', '').replace('NFe', '')
    ide = infNFe.find('nfe:ide', ns) if ns else infNFe.find('ide')
    nNF = find_text(ide, 'nfe:nNF' if ns else 'nNF')
    serie = find_text(ide, 'nfe:serie' if ns else 'serie')
    natOp = find_text(ide, 'nfe:natOp' if ns else 'natOp')
    dhEmi = find_text(ide, 'nfe:dhEmi' if ns else 'dhEmi')
    dhSaiEnt = find_text(ide, 'nfe:dhSaiEnt' if ns else 'dhSaiEnt')
    tpNF = find_text(ide, 'nfe:tpNF' if ns else 'tpNF')  # 1 = Saída, 0 = Entrada
    
    # 2. Protocolo de Autorização
    protNFe = root.find('.//nfe:protNFe', ns) if ns else root.find('.//protNFe')
    nProt = find_text(protNFe, './/nfe:nProt' if ns else './/nProt')
    dhRecbto = find_text(protNFe, './/nfe:dhRecbto' if ns else './/dhRecbto')
    
    # 3. Emitente
    emit = infNFe.find('nfe:emit', ns) if ns else infNFe.find('emit')
    enderEmit = emit.find('nfe:enderEmit', ns) if (emit is not None and ns) else (emit.find('enderEmit') if emit is not None else None)
    emitente = {
        "cnpj": find_text(emit, 'nfe:CNPJ' if ns else 'CNPJ'),
        "xNome": find_text(emit, 'nfe:xNome' if ns else 'xNome'),
        "xFant": find_text(emit, 'nfe:xFant' if ns else 'xFant'),
        "ie": find_text(emit, 'nfe:IE' if ns else 'IE'),
        "logradouro": find_text(enderEmit, 'nfe:xLgr' if ns else 'xLgr'),
        "numero": find_text(enderEmit, 'nfe:nro' if ns else 'nro'),
        "bairro": find_text(enderEmit, 'nfe:xBairro' if ns else 'xBairro'),
        "municipio": find_text(enderEmit, 'nfe:xMun' if ns else 'xMun'),
        "uf": find_text(enderEmit, 'nfe:UF' if ns else 'UF'),
        "cep": find_text(enderEmit, 'nfe:CEP' if ns else 'CEP'),
        "fone": find_text(enderEmit, 'nfe:fone' if ns else 'fone')
    }
    
    # 4. Destinatário
    dest = infNFe.find('nfe:dest', ns) if ns else infNFe.find('dest')
    enderDest = dest.find('nfe:enderDest', ns) if (dest is not None and ns) else (dest.find('enderDest') if dest is not None else None)
    doc_dest = find_text(dest, 'nfe:CNPJ' if ns else 'CNPJ') or find_text(dest, 'nfe:CPF' if ns else 'CPF')
    destinatario = {
        "documento": doc_dest,
        "xNome": find_text(dest, 'nfe:xNome' if ns else 'xNome'),
        "ie": find_text(dest, 'nfe:IE' if ns else 'IE'),
        "logradouro": find_text(enderDest, 'nfe:xLgr' if ns else 'xLgr'),
        "numero": find_text(enderDest, 'nfe:nro' if ns else 'nro'),
        "bairro": find_text(enderDest, 'nfe:xBairro' if ns else 'xBairro'),
        "municipio": find_text(enderDest, 'nfe:xMun' if ns else 'xMun'),
        "uf": find_text(enderDest, 'nfe:UF' if ns else 'UF'),
        "cep": find_text(enderDest, 'nfe:CEP' if ns else 'CEP'),
        "fone": find_text(enderDest, 'nfe:fone' if ns else 'fone')
    }
    
    # 5. Totais
    icmsTot = infNFe.find('.//nfe:ICMSTot', ns) if ns else infNFe.find('.//ICMSTot')
    totais = {
        "vBC": float(find_text(icmsTot, 'nfe:vBC' if ns else 'vBC', '0')),
        "vICMS": float(find_text(icmsTot, 'nfe:vICMS' if ns else 'vICMS', '0')),
        "vBCST": float(find_text(icmsTot, 'nfe:vBCST' if ns else 'vBCST', '0')),
        "vST": float(find_text(icmsTot, 'nfe:vST' if ns else 'vST', '0')),
        "vProd": float(find_text(icmsTot, 'nfe:vProd' if ns else 'vProd', '0')),
        "vFrete": float(find_text(icmsTot, 'nfe:vFrete' if ns else 'vFrete', '0')),
        "vSeg": float(find_text(icmsTot, 'nfe:vSeg' if ns else 'vSeg', '0')),
        "vDesc": float(find_text(icmsTot, 'nfe:vDesc' if ns else 'vDesc', '0')),
        "vIPI": float(find_text(icmsTot, 'nfe:vIPI' if ns else 'vIPI', '0')),
        "vNF": float(find_text(icmsTot, 'nfe:vNF' if ns else 'vNF', '0'))
    }
    
    # 6. Transporte
    transp = infNFe.find('nfe:transp', ns) if ns else infNFe.find('transp')
    transporta = transp.find('nfe:transporta', ns) if (transp is not None and ns) else (transp.find('transporta') if transp is not None else None)
    vol = transp.find('nfe:vol', ns) if (transp is not None and ns) else (transp.find('vol') if transp is not None else None)
    transporte = {
        "modFrete": find_text(transp, 'nfe:modFrete' if ns else 'modFrete'),
        "xNome": find_text(transporta, 'nfe:xNome' if ns else 'xNome'),
        "cnpj": find_text(transporta, 'nfe:CNPJ' if ns else 'CNPJ'),
        "qVol": find_text(vol, 'nfe:qVol' if ns else 'qVol'),
        "pesoL": float(find_text(vol, 'nfe:pesoL' if ns else 'pesoL', '0')),
        "pesoB": float(find_text(vol, 'nfe:pesoB' if ns else 'pesoB', '0'))
    }
    
    # 7. Itens (det)
    itens = []
    dets = infNFe.findall('nfe:det', ns) if ns else infNFe.findall('det')
    for d in dets:
        prod = d.find('nfe:prod', ns) if ns else d.find('prod')
        imposto = d.find('nfe:imposto', ns) if ns else d.find('imposto')
        icms = imposto.find('.//nfe:ICMS', ns) if (imposto is not None and ns) else (imposto.find('.//ICMS') if imposto is not None else None)
        
        nItem = d.attrib.get('nItem', '')
        cProd = find_text(prod, 'nfe:cProd' if ns else 'cProd')
        xProd = find_text(prod, 'nfe:xProd' if ns else 'xProd')
        ncm = find_text(prod, 'nfe:NCM' if ns else 'NCM')
        cfop = find_text(prod, 'nfe:CFOP' if ns else 'CFOP')
        uCom = find_text(prod, 'nfe:uCom' if ns else 'uCom')
        qCom = float(find_text(prod, 'nfe:qCom' if ns else 'qCom', '0'))
        vUnCom = float(find_text(prod, 'nfe:vUnCom' if ns else 'vUnCom', '0'))
        vProd = float(find_text(prod, 'nfe:vProd' if ns else 'vProd', '0'))
        
        itens.append({
            "nItem": nItem,
            "cProd": cProd,
            "xProd": xProd,
            "ncm": ncm,
            "cfop": cfop,
            "uCom": uCom,
            "qCom": qCom,
            "vUnCom": vUnCom,
            "vProd": vProd
        })
        
    # 8. Informações complementares
    infAdic = infNFe.find('nfe:infAdic', ns) if ns else infNFe.find('infAdic')
    infCpl = find_text(infAdic, 'nfe:infCpl' if ns else 'infCpl')
    
    return {
        "status": "ok",
        "chave": chave,
        "nNF": nNF,
        "serie": serie,
        "natOp": natOp,
        "dhEmi": dhEmi,
        "dhSaiEnt": dhSaiEnt,
        "tpNF": tpNF,
        "protocolo": nProt,
        "dhRecbto": dhRecbto,
        "emitente": emitente,
        "destinatario": destinatario,
        "totais": totais,
        "transporte": transporte,
        "itens": itens,
        "infCpl": infCpl
    }
