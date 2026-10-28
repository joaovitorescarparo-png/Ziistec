# Arquitetura fiscal V1 (NFS-e) — desenho, nada implementado

**Estado:** apenas desenho. Nenhum código, migration, credencial, certificado, contrato ou chamada a provedor foi criado. Nenhuma NFS-e foi emitida. Este documento prepara a decisão e a Fase F1 (sandbox), que **não foi executada** e exige autorização própria.

Pesquisa de provedores feita em 2026-10-28 em páginas públicas. Preços, limites e prazos mudam; toda linha marcada *não confirmado* precisa ser validada com o provedor antes de decidir.

## 1. Princípios

1. **Comprovante de Serviço ≠ NFS-e.** O `service_receipts` (migration 0100, `zt_issue_service_receipt`, "CS-0001") é documento **não fiscal**, só do dono, não gera lançamento financeiro e continua assim. A NFS-e vive em tabelas próprias (`fiscal_documents`), nunca reaproveita `service_receipts` e a interface nunca chama o comprovante de "nota".
2. **Banco é a autoridade.** Valores, tomador, serviço, regras e transições de estado são resolvidos e validados no banco/servidor; o navegador só mostra a prévia e confirma.
3. **Nunca emitir sozinho.** Nenhuma emissão automática ao concluir a OS. O dono escolhe, vê a prévia, confirma.
4. **Provedor é detalhe de adaptador.** O domínio fala `FiscalProvider`; Spedy e Focus NFe são adaptadores. Nenhum nome de provedor no domínio, nas tabelas de negócio ou nas telas.
5. **Dado fiscal vem da empresa e do contador, nunca de IA.** A IA do app não sugere, preenche nem corrige código de serviço, alíquota, CNAE ou regime.
6. **Receita não duplica.** A NFS-e referencia o lançamento que já existe (`work_orders.billing_entry_id` → `financial_entries`); emitir ou cancelar nota não cria, apaga nem baixa receita nem pagamento.

## 2. Fluxo

```
OS concluída (billing_entry já existe)
  → dono escolhe "Emitir NFS-e"
  → prévia (tomador, serviço, valor, retenções, alíquota; origem de cada campo)
  → validações (bloqueiam; ver §6)
  → confirmação explícita (gera request_id + preview_hash)
  → fila (queued) → despacho (dispatching) → provedor
  → processing (aguarda webhook ou consulta)
  → authorized  (número, código de verificação, PDF, XML)
  → rejected    (código e mensagem normalizados; corrige e cria nova tentativa)
  → cancelamento quando permitido: cancel_requested → cancelled
```

Cancelar a NFS-e **não** cancela o pagamento nem o lançamento. Rejeição não bloqueia a OS nem o financeiro.

## 3. Dados propostos

Rascunho de modelo, para a futura migration (próximo número livre na época; não reservar agora). Todas as tabelas com RLS ligada, sem `GRANT` de escrita ao navegador; escrita só por RPC `SECURITY DEFINER` com `search_path = ''` e pelo handler de webhook com chave de serviço. FKs de tenant sempre compostas `(id, company_id)`.

**`fiscal_settings`** (1 por empresa; só dono): CNPJ, inscrição municipal, regime tributário, CNAE, código de serviço municipal, item da LC 116, alíquota de ISS, retenções (ISS/IR/PIS/COFINS/CSLL/INSS) por padrão, natureza da operação, série/RPS, ambiente (`sandbox` | `production`), referência da empresa no provedor, quem validou e quando, `status` (`incomplete` | `ready`). Origem: formulário do dono com orientação do contador. Produção só habilita após validação explícita e depois de uma emissão de sandbox bem-sucedida.

**`fiscal_documents`**: `company_id`, `work_order_id`, `billing_entry_id` (FKs compostas), `kind = 'nfse'`, `status`, `request_id`, `preview_hash`, `provider` (texto do adaptador), `provider_ref` (id/ref no provedor), `environment`, `snapshot` jsonb (tomador, serviço, valores, tributos usados — imutável após `queued`), `number`, `verification_code`, `issued_at`, caminhos de XML/PDF no Storage privado, `error_code`/`error_message` normalizados, `cancel_reason`, auditoria (quem pediu, quando). Índices: `unique(company_id, request_id)` e **uma NFS-e ativa por OS** (`unique(work_order_id) where status in ('queued','dispatching','processing','authorized','cancel_requested')`).

**`fiscal_webhook_events`**: `provider`, `event_id` (único por provedor), `received_at`, `signature_ok`, hash do corpo bruto, `processed_at`. Serve a repetição segura e a auditoria; sem segredo, sem PII além do necessário.

Segredos **não** ficam no banco: chave do provedor só em variável de ambiente do servidor (Vercel), por ambiente.

## 4. Estados e transições

`draft → queued → dispatching → processing → authorized | rejected`; `authorized → cancel_requested → cancelled` (ou volta a `authorized` se o cancelamento for negado). `rejected` e `cancelled` são finais para aquele registro; nova tentativa é novo registro com novo `request_id`. Transições só por função de servidor, que checa o estado de origem (`update … where status = origem`) e ignora transição fora de ordem, inclusive a causada por webhook repetido ou atrasado. `dispatching` sem resposta por mais que o limite passa a `processing` **depois** de consultar o provedor, nunca por suposição.

## 5. Interface `FiscalProvider`

Contrato neutro (descrito em TypeScript; implementação em JavaScript, só no servidor; o navegador nunca importa adaptador):

```ts
/** @typedef {'queued'|'processing'|'authorized'|'rejected'|'cancel_requested'|'cancelled'} FiscalStatus */
/** @typedef {{ code:string, message:string, retryable:boolean, field?:string }} FiscalError */

interface FiscalProvider {
  capabilities(): { nfseMunicipal:boolean, nfseNacional:boolean, multiCnpj:boolean, sandbox:boolean,
                    webhookSignature:'hmac'|'token'|'none', idempotencyKey:'header'|'field'|'none',
                    cancellation:boolean, pdf:boolean, xml:boolean }
  upsertCompany(company)                       // cadastra/atualiza o prestador no provedor
  configureTaxProfile(companyRef, settings)    // regime, serviço, alíquotas
  uploadCertificate(companyRef, pfx, password) // só se o provedor exigir; ver §6
  issueServiceInvoice(companyRef, invoice, idempotencyKey) // -> { providerRef, status }
  getServiceInvoice(companyRef, providerRef)   // -> { status, number?, verificationCode?, error? }
  cancelServiceInvoice(companyRef, providerRef, reason, idempotencyKey)
  downloadXml(companyRef, providerRef)         // -> bytes
  downloadPdf(companyRef, providerRef)         // -> bytes
  verifyWebhook({ rawBody, headers, now })     // -> { ok, eventId, providerRef } (tempo constante)
  mapStatus(providerStatus): FiscalStatus
  mapError(providerError): FiscalError
}
```

Regras: o adaptador **traduz** (status, erro, campos) e não decide negócio; nenhuma resposta de provedor entra no banco sem passar por `mapStatus`/`mapError`; `capabilities()` decide o que a tela oferece (por exemplo, esconder cancelamento se o provedor não suportar).

## 6. Segurança

- **Somente dono** vê, configura, emite e cancela. Técnico não lê `fiscal_*`. Anônimo e usuário sem empresa, nada. Membro desativado, nada. RLS + RPC são a autoridade.
- **Chave do provedor** só no servidor; nunca em `VITE_*`, resposta de API, log ou banco.
- **Certificado digital** nunca passa pelo navegador. Preferir o provedor guardar o certificado (upload direto do dono ao provedor, ou pelo servidor sem persistir); **não armazenar PFX nem senha**. Se o servidor tiver de repassar, é em memória, uma requisição, sem log. Validade do certificado é informada pelo provedor e avisada ao dono.
- **Webhook**: assinatura obrigatória quando o provedor assina; verificar sobre o **corpo bruto**, comparação em tempo constante, janela de tempo curta (replay), `event_id` único (repetição devolve 200 sem reprocessar). Para provedor que só envia token estático em cabeçalho, o token é segredo por ambiente **e** o handler nunca confia no corpo: ele só usa o `providerRef` para **consultar o provedor** (`getServiceInvoice`) e grava o resultado da consulta.
- **Logs** sem CNPJ completo, CPF, e-mail ou valores de tomador; ids e hashes bastam.
- **Validações que bloqueiam a emissão:** `fiscal_settings.status = ready`; ambiente coerente; OS concluída; tomador com documento válido e endereço; `billing_entry_id` existente e sem NFS-e ativa; valor e itens iguais ao `preview_hash` confirmado; serviço mapeado para um código municipal/LC 116 cadastrado. Material interno ou custo nunca entra no valor do serviço (regra de dinheiro do produto).

## 7. Idempotência e falhas

- `request_id` gerado na confirmação; `unique(company_id, request_id)` devolve o mesmo registro em reenvio. O mesmo `request_id` vira a chave de idempotência enviada ao provedor.
- `preview_hash` (hash do snapshot confirmado) impede emitir algo diferente do que o dono viu: se OS, tomador ou valor mudarem antes do despacho, a emissão para e pede nova prévia.
- Timeout, queda de rede ou resposta perdida: **consultar o provedor primeiro** (`getServiceInvoice` pela mesma chave); só repetir o envio, com a **mesma** chave, se o provedor disser que não conhece o pedido. Nunca gerar chave nova para "tentar de novo".
- Uma NFS-e ativa por OS (índice parcial) e transições condicionais ao estado de origem tornam webhook duplicado, fora de ordem e duplo clique inofensivos.

## 8. Comparativo técnico: Spedy × Focus NFe

Fontes: documentação e páginas públicas dos dois provedores, consultadas em 2026-10-28; buscas complementares devolveram só material secundário para alguns pontos (marcados).

| Critério | Spedy | Focus NFe |
|---|---|---|
| NFS-e municipal | Sim (emissão assíncrona de `service-invoices`) | Sim |
| NFS-e Nacional | **Não confirmado** (nenhuma documentação oficial localizada na rodada) | Sim: endpoint próprio `/v2/nfsen` com referência (`ref`) |
| Multi-CNPJ (SaaS com várias empresas) | **Não confirmado** | Sim; CNPJ adicional cobrado à parte |
| Sandbox | Sim (URL própria) | Sim (`homologacao`) |
| Autenticação | `X-Api-Key` | Basic (token como usuário) |
| Idempotência | `integrationId` informado pelo cliente | `ref` único; repetido devolve 422 (consultar, não reenviar) |
| Webhook | Padrão *Standard Webhooks*: HMAC-SHA256 do corpo, com rotação de segredo | Token em cabeçalho (sem HMAC do corpo); novas tentativas por até 48 h |
| Certificado | **Não confirmado** (como o certificado é enviado e guardado) | **Não confirmado** (como o certificado é enviado e guardado) |
| Cancelamento, PDF, XML | Esperado na API de `service-invoices`; não conferido item a item | Sim |
| Limites de taxa | 5 req/s e 100 req/min | Não confirmado |
| Cobertura de municípios | **Não confirmado** para as cidades dos clientes | Integração de município não coberto tem taxa (R$ 199 no momento da consulta); cobertura das cidades dos clientes **não conferida** |
| Reforma Tributária (IBS/CBS) | **Não confirmado** | Guia oficial de adequação publicado; validação ativa dos campos pela Receita/CGIBS desde 2026-04-01 segundo esse guia |
| Preço | Planos anuais (R$ 890 / 1.890 / 2.490 no momento da consulta) | Planos mensais de ~R$ 94,90 a R$ 572; CNPJ adicional R$ 39,90 |
| Modelo de preço para SaaS multiempresa | Por plano anual da conta; repasse por cliente **a negociar** | Por CNPJ adicional; repasse por cliente **a negociar** |
| Suporte e documentação | Documentação pública; suporte **não avaliado** | Documentação pública extensa; suporte **não avaliado** |

Contexto regulatório (fonte secundária, sem confirmação oficial nesta rodada): ME/EPP do Simples Nacional podem ser obrigados a emitir pelo padrão nacional a partir de 2026-09-01. Se for verdade para a base de clientes, **suporte a NFS-e Nacional vira requisito**, não diferencial.

## 9. Recomendação

**Spedy adequada: PARCIAL.** Atende idempotência, sandbox, assinatura de webhook com rotação e limites claros, mas NFS-e Nacional, multi-CNPJ, cobertura municipal e Reforma Tributária não foram confirmados.

**Focus NFe adequada: SIM, com uma compensação e itens a validar no sandbox** (certificado, limites de taxa, cobertura das cidades reais). Tem NFS-e Nacional com referência idempotente, sandbox, multi-CNPJ e guia de adequação à Reforma Tributária. Não assina o corpo do webhook; a compensação já está no desenho (§6): token como segredo por ambiente e **sempre reconsultar** o provedor antes de gravar qualquer coisa.

**Provedor recomendado para a F1 (sandbox): Focus NFe**, pelo suporte documentado à NFS-e Nacional e ao multi-CNPJ, que são os dois riscos maiores para uma base de prestadores pequenos; a cobertura das cidades reais é o primeiro item do sandbox. A escolha é reversível porque tudo passa por `FiscalProvider`; Spedy pode ser avaliada no mesmo sandbox por um adaptador depois, se a cobertura das cidades dos clientes assim pedir. Nenhuma contratação, conta ou credencial foi criada.

## 10. Fase F1 — sandbox (planejada, **não executada**)

Pré-condições: H0 concluída; decisão de provedor; contador valida os campos de `fiscal_settings`; autorização expressa.

1. Conta de **sandbox** do provedor escolhido (credencial só em variável de ambiente do ambiente de homologação; nunca em repositório).
2. Migration de `fiscal_settings`, `fiscal_documents`, `fiscal_webhook_events` e RPCs, **só no Staging descartável**, com teste SQL rollback-safe (isolamento por empresa, só dono, índice de NFS-e ativa, transições, idempotência, técnico sem acesso).
3. Adaptador mínimo + testes contratuais com cliente falso (assinatura/token inválido, replay, evento repetido, timeout seguido de consulta, erro normalizado, status fora de ordem).
4. Empresa fictícia de teste: emitir, receber webhook, baixar PDF/XML, cancelar, rejeição forçada.
5. Critério de saída: nenhum documento duplicado em 100 repetições de envio e de webhook; nenhum segredo em log, bundle ou resposta; chave de produção ausente do ambiente.
6. Produção fiscal fica para outra decisão, depois de piloto com um cliente e contador.

## 11. Fora de escopo agora e perguntas em aberto

Escopo fora: emissão real, certificado real, tela de emissão, NFS-e em lote, NF-e de produto, conciliação fiscal, retenções calculadas automaticamente além dos campos informados.

Em aberto: quais municípios os clientes reais usam e se estão no padrão nacional; regime e CNAE dos primeiros clientes; se o certificado fica no provedor; modelo de repasse de custo ao cliente; regra de cancelamento por prazo/município; campos de IBS/CBS exigidos no leiaute vigente.

**Fiscal readiness: PASS (desenho).** Fronteira com o comprovante não fiscal definida, interface neutra, estados e idempotência especificados, segurança de segredos/certificado/webhook especificada, plano de sandbox escrito e não executado.
