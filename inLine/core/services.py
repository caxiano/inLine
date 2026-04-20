from decimal import Decimal
from django.db import transaction, models
from django.core.exceptions import ValidationError
from django.utils import timezone
from uuid import UUID
from .models import Pedido, FilaPrato, TMA, Prato
from django.db.models import F

# =========================
# CAIXA
# =========================

@transaction.atomic
def create_order(tipo, itens):
    # 1. Cria o pedido pai
    pedido = Pedido.objects.create(tipo=tipo, total=0)
    total_acumulado = 0

    for item in itens:
        prato_id = item["prato_id"]
        qtd = int(item["quantidade"])

        # Buscamos o prato travando a linha (FOR UPDATE)
        prato = Prato.objects.select_for_update().get(id=prato_id)

        # BLOQUEIO: Impede estoque negativo no servidor
        if prato.estoque < qtd:
            raise ValueError(f"Estoque insuficiente para {prato.nome}")

        # OPERAÇÃO ATÔMICA: Subtrai o estoque
        # Se prato.save() estiver baixando 2 vezes, mude para o comando abaixo:
        Prato.objects.filter(id=prato_id).update(estoque=F('estoque') - qtd)
        
        # Atualiza a instância na memória apenas para o cálculo do total
        prato.refresh_from_db()
        total_acumulado += (prato.preco * qtd)

        # 2. Cria os itens na fila (sem mexer no estoque aqui!)
        for _ in range(qtd):
            FilaPrato.objects.create(
                pedido=pedido,
                prato=prato,
                preco_unitario=prato.preco
            )

    pedido.total = total_acumulado
    pedido.save()
    return pedido

# =========================
# INICIAR PRATO
# =========================

def iniciar_producao_item(fila_id):
    item = FilaPrato.objects.get(id=fila_id)
    if not item.started_at:
        item.started_at = timezone.now()  # Registra o início REAL
        item.status = FilaPrato.Status.EM_PRODUCAO
        item.save(update_fields=['started_at', 'status'])
    return item

# =========================
# FINALIZAÇÃO DE PRATO
# =========================



def finalize_prato(fila_id):
    try:
        with transaction.atomic():
            # 1. Busca o item com lock para evitar concorrência
            item = FilaPrato.objects.select_for_update().filter(id=fila_id).first()

            if not item or item.status == FilaPrato.Status.FINALIZADO:
                return None

            agora = timezone.now()

            # 2. GRAVAÇÃO DOS TEMPOS (O CORAÇÃO DO TMA)
            # Se o item não tiver hora de início (pulou a etapa 'em produção'), 
            # assumimos que começou agora para não quebrar o cálculo.
            if not item.started_at:
                item.started_at = item.created_at

            item.finished_at = agora  # Define o fim da produção AGORA
            item.status = FilaPrato.Status.FINALIZADO
            
            # 3. SALVAMENTO EXPLÍCITO
            # Adicionamos os campos de tempo no update_fields
            item.save(update_fields=['status', 'finished_at', 'started_at', 'updated_at'])

            # 4. Atualização do Pedido (se todos os itens do pedido acabaram)
            pedido = item.pedido
            itens_abertos = FilaPrato.objects.filter(pedido=pedido).exclude(
                status__in=[FilaPrato.Status.FINALIZADO, FilaPrato.Status.RETIRADO]
            ).exists()

            if not itens_abertos:
                pedido.status = Pedido.Status.FINALIZADO
                pedido.save(update_fields=['status'])
            
            return item
    except Exception as e:
        print(f"Erro no service finalize_prato: {e}")
        raise e


# =========================
# MÉTRICA TMA (janela fixa)
# =========================

def calculate_tma_per_prato():
    """
    Calcula o TMA focado na performance recente (Janela de até 10 unidades).
    Se houver < 10, calcula com o que houver. Se > 10, pega o lote mais recente.
    """
    # 1. Identifica pratos que possuem itens finalizados aguardando cálculo
    pratos_pendentes = FilaPrato.objects.filter(
        status=FilaPrato.Status.FINALIZADO, 
        usado_em_metrica=False,
        started_at__isnull=False,
        finished_at__isnull=False
    ).values('prato').annotate(total=models.Count('id'))

    for p in pratos_pendentes:
        prato_id = p['prato']
        try:
            with transaction.atomic():
                # 2. Busca o lote (até 10 itens) - selecionamos para update para evitar concorrência
                itens = list(
                    FilaPrato.objects.filter(
                        prato_id=prato_id,
                        status=FilaPrato.Status.FINALIZADO,
                        usado_em_metrica=False
                    )
                    .select_for_update()
                    .order_by('finished_at')[:10]
                )

                qtd = len(itens)
                if qtd == 0:
                    continue

                # 3. Cálculo da média do lote atual
                # Soma a diferença de tempo de cada item individualmente (preparo real)
                soma_segundos = sum([
                    max(0.0, (i.finished_at - i.started_at).total_seconds()) 
                    for i in itens
                ])
                
                media = soma_segundos / qtd

                # 4. Grava a nova métrica na tabela TMA
                TMA.objects.create(
                    prato_id=prato_id,
                    valor_tma_seg=media,
                    ultimo_prato_id=itens[-1].id # Referência para auditoria
                )

                # 5. Marca esses itens como processados
                FilaPrato.objects.filter(
                    id__in=[i.id for i in itens]
                ).update(usado_em_metrica=True)

        except Exception as e:
            print(f"Erro ao calcular TMA para prato {prato_id}: {e}")

# =========================
# RETIRADA DE PEDIDO (janela fixa)
# =========================

def registrar_retirada_total_pedido(pedido_id):
    try:
        with transaction.atomic():
            # 1. Busca o pedido e trava a linha no banco
            pedido = Pedido.objects.select_for_update().get(id=pedido_id)
            
            # 2. Conta quantos itens o pedido tem no total
            total_itens = pedido.filas.count()
            
            # 3. Conta quantos desses itens já estão FINALIZADOS
            total_finalizados = pedido.filas.filter(status=Pedido.Status.FINALIZADO).count()

            # REGRA DE OURO: Só passa se o total for igual ao finalizado
            if total_itens != total_finalizados:
                raise ValidationError(
                    f"Impossível retirar: O pedido tem {total_itens} itens, mas apenas {total_finalizados} estão prontos."
                )

            # 4. Se chegou aqui, todos estão prontos. Então damos baixa em tudo:
            pedido.filas.all().update(
                status=Pedido.Status.RETIRADO, 
                delivered_at=timezone.now()
            )
            
            # 5. Atualiza o status do Pedido pai
            pedido.status = Pedido.Status.RETIRADO
            pedido.save(update_fields=['status'])
            
            return pedido
            
    except Pedido.DoesNotExist:
        return None