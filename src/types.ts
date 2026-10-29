export type Profile = { id: string; nome: string; email: string; papel: string; status: string; telefone: string | null; cpf: string | null; data_nascimento?: string | null; criado_em?: string }
export type EventRow = { id: string; slug: string; nome: string; data: string; descricao: string | null; imagem_capa: string | null; banner: string | null; favicon?: string | null; status: string }
export type QueueRow = { id: string; usuario_id: string; ordem_fila: number; pago: boolean; forma_pagamento: string | null; valor_pagamento: number; status: string; criado_em: string; profile?: Profile }

