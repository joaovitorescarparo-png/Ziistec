# Agente ZiisTec no WhatsApp — plano V1

Nada do que está aqui foi implementado nesta onda. Não há credencial Meta, número
empresarial, webhook publicado nem transcrição. O que existe hoje é a **camada
interna de comandos** (`src/lib/operationsCommands.js` +
`operationsCommandEngine.js`), já usada pelo simulador da Central de Operações.

Este documento descreve como o WhatsApp entra depois **sem mudar o núcleo**: ele
vira apenas mais uma origem que produz o mesmo command object.

## Arquitetura futura

```
Meta WhatsApp Cloud API
  -> webhook (função server-side, nunca o navegador)
  -> verificação do webhook (GET hub.challenge) e da assinatura (X-Hub-Signature-256)
  -> proteção contra replay (message id já visto) e rate limit por remetente
  -> identidade: telefone -> usuário ZiisTec autorizado (vínculo explícito, opt-in)
  -> mídia/áudio: download autenticado
  -> transcrição (voz -> texto)
  -> command parser (hoje: rascunhoDeFrase; depois: NLU/LLM)
  -> RESOLVE pelo contexto que a SESSÃO daquele usuário pode ver
  -> PROPOSE (requires_confirmation / needs_clarification)
  -> CONFIRM pelo próprio WhatsApp (botão ou "confirmar")
  -> EXECUTE pelas RPCs oficiais (as mesmas da Central de Operações)
  -> auditoria em work_order_dispatch_events com source='whatsapp'
```

O que **não** muda: o fluxo
`INPUT -> PARSE -> RESOLVE -> PROPOSE -> CONFIRM -> EXECUTE`, as 6 intents, a
regra de ambiguidade e a origem da empresa. Trocar o parser não mexe em nada
depois dele, porque a saída é sempre o mesmo payload estruturado.

## Segurança — requisitos de entrada

Nenhum destes é opcional para ligar o WhatsApp:

- **Verificação do webhook**: responder ao desafio de verificação da Meta com o
  token combinado, guardado como secret de servidor.
- **Assinatura de cada entrega**: validar `X-Hub-Signature-256` (HMAC-SHA256 com
  o App Secret) sobre o corpo **bruto**. Corpo sem assinatura válida é descartado
  antes de qualquer parsing.
- **Replay protection**: o `id` de cada mensagem é registrado; id repetido é
  ignorado. Entrega duplicada da Meta é normal e não pode virar duas OS.
- **Idempotência**: o `id` da mensagem vira o `p_request` das RPCs, então um
  reenvio cai no caminho de replay que a 0116 já tem (devolve o mesmo evento, sem
  reaplicar).
- **Rate limit** por remetente e por empresa, decidido no servidor.
- **Identidade nunca vem do payload**: o telefone que a Meta envia é apenas
  chave de busca. Só opera quem tiver vínculo explícito, aprovado dentro do
  produto, com um usuário ZiisTec ativo. Telefone desconhecido recebe recusa
  neutra e nada é criado. (Esta onda **não** armazena telefone.)
- **Tenant isolation**: a empresa vem do vínculo do usuário, jamais da mensagem.
  O contexto de resolução é o que a RLS daquele usuário permite ver — o agente
  não enxerga cliente que o usuário não enxerga.
- **service_role nunca no frontend** e nunca no caminho do webhook de usuário:
  a execução usa a sessão do usuário vinculado, pelas RPCs com `SECURITY DEFINER`
  que já validam dono, empresa, membro ativo e assinatura.
- **Confirmação antes de operação importante**: criar, agendar, atribuir e anotar
  exigem confirmação explícita. Consulta (`get_*`) não escreve e não precisa.
- **Logs sem conteúdo sensível desnecessário**: registrar id da mensagem,
  usuário resolvido, intent e desfecho. Não registrar o corpo da mensagem, áudio,
  telefone completo nem transcrição crua.

## Por que a confirmação é obrigatória

A interpretação de linguagem natural erra. "Cancela a OS do Plaza" pode casar com
dois clientes e duas ordens. O produto trata isso com `needs_clarification` e com
proposta explícita: nada operacional acontece porque uma frase foi interpretada.
Essa regra está no banco e na camada pura, não na interface do WhatsApp — então
vale para qualquer origem.

## Ordem de implementação sugerida

1. Vínculo telefone -> usuário dentro do produto (opt-in, revogável, auditado).
2. Função de webhook com verificação, assinatura, replay e rate limit — sem
   nenhuma execução ainda, só registrando que a mensagem chegou e foi aceita.
3. Parser real substituindo `rascunhoDeFrase`, com os mesmos testes de
   ambiguidade e de data absoluta.
4. Confirmação pelo WhatsApp (botões) ligada ao `podeExecutar`.
5. Áudio: download autenticado + transcrição, produzindo `source='voice_transcript'`.

## Fora de escopo

Twilio, Evolution API, WhatsApp Web não oficial, QR Code, número pessoal, agente
autônomo sem confirmação e qualquer execução sem usuário vinculado.
