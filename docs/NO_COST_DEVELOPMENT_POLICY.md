# ZiisTec — política de desenvolvimento sem custo adicional

## Regra atual

Enquanto o ZiisTec não tiver **mais de 4 clientes pagantes**, o desenvolvimento e a homologação devem evitar novos custos recorrentes ou por uso.

### Não criar sem autorização explícita

- Supabase development branch paga.
- Novo projeto Supabase pago.
- Gateway de pagamento com mensalidade/custo fixo antes de existir necessidade comercial real.
- Google Places ou outra API paga apenas para conveniência de desenvolvimento.
- Serviços de monitoramento, filas, e-mail, storage ou IA adicionais que gerem nova cobrança recorrente.
- Qualquer infraestrutura paralela paga apenas para homologação.

## Caminho permitido sem custo adicional

1. GitHub branch `product-v2-review` e PR draft.
2. CI/Verify/CodeQL já existentes.
3. Preview Vercel já conectado ao projeto.
4. Preview deve falhar fechado se não tiver banco de homologação próprio; nunca pode cair silenciosamente no Supabase de produção.
5. Supabase de produção apenas para:
   - leitura;
   - advisors/logs;
   - testes SQL controlados com `BEGIN ... ROLLBACK`;
   - nenhuma migration V2 aplicada antes da homologação final.
6. Testes estáticos e de contrato versionados em `supabase/tests` e `scripts`.
7. Não copiar dados reais de clientes para ambientes de teste.

## IA paga: desligada por padrão

Os endpoints de Orçamento com IA e Financeiro com IA usam um **cost gate fail-closed** no servidor.

- A presença de `ANTHROPIC_API_KEY` sozinha **não autoriza consumo**.
- A IA paga só pode chamar o provedor quando `ENABLE_PAID_AI=true` estiver configurada explicitamente no servidor.
- Com a flag ausente ou diferente de `true`, o servidor responde `503` antes de consumir quota e antes de chamar a Anthropic.
- O Orçamento com IA também valida `owner` antes da trava de custo; um técnico autenticado recebe `403` e não consome quota.
- O CI executa testes mockados que provam esses comportamentos sem rede e sem gerar custo.

Quando a política de custo for revista, a ativação dessa flag deve ser uma decisão explícita e separada; não deve acontecer automaticamente só porque uma chave de provedor existe.

## Quando rever esta política

A política pode ser revista quando houver **5 ou mais clientes pagantes** ou quando o proprietário autorizar explicitamente um custo específico antes da criação do recurso.

Mesmo depois disso, qualquer recurso pago deve ter justificativa, custo conhecido e forma simples de desligamento.
