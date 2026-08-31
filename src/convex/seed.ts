import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Seed mutation: Populates the organizations table with the real
 * organizational structure of the Prefeitura Municipal de Capivari-SP.
 *
 * Source: https://capivari.sp.gov.br/portal/secretarias/
 *         https://capivari.sp.gov.br/portal/educacao/
 *         https://capivari.sp.gov.br/portal/secretarias/saude/
 *
 * Rules:
 * - Only inserts if NO organizations exist (prevents duplicates).
 * - Creates: Paço Municipal → Secretarias → Unidades (UBS, Escolas).
 * - All records created with active: true.
 */
export const seedOrganizations = mutation({
  args: {},
  handler: async (ctx) => {
    // ── Prevent duplicate seeding ──────────────────────────────────────────
    const existing = await ctx.db.query("organizations").first();
    if (existing) {
      return {
        inserted: 0,
        message: "Já existem organizações cadastradas. Seed ignorado para evitar duplicação.",
      };
    }

    const now = Date.now();
    let inserted = 0;

    // Helper to insert an org and return its ID
    async function insertOrg(
      name: string,
      type: "prefeitura" | "paco_municipal" | "gabinete" | "secretaria" | "departamento" | "unidade",
      parentId?: string,
      observation?: string
    ): Promise<string> {
      const id = await ctx.db.insert("organizations", {
        name,
        type,
        parentId: parentId as any,
        active: true,
        observation,
      });
      inserted++;
      return id;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 1. PAÇO MUNICIPAL (Root)
    // ═══════════════════════════════════════════════════════════════════════
    const pacoId = await insertOrg(
      "Paço Municipal de Capivari",
      "paco_municipal",
      undefined,
      "Sede do poder executivo municipal — Rua XV de Novembro, 639, Centro"
    );

    // ═══════════════════════════════════════════════════════════════════════
    // 2. SECRETARIAS
    // Fonte: https://capivari.sp.gov.br/portal/secretarias/
    // ═══════════════════════════════════════════════════════════════════════
    const secretarias: Array<{ name: string; observation?: string }> = [
      {
        name: "Gabinete do Prefeito",
        observation: "Apoio administrativo direto ao Prefeito Municipal",
      },
      {
        name: "Secretaria da Cultura",
        observation: "Promoção cultural, artística e de preservação do patrimônio",
      },
      {
        name: "Secretaria da Pessoa com Deficiência, da Cidadania e da Mulher",
        observation: "Políticas públicas para pessoas com deficiência, cidadania e igualdade de gênero",
      },
      {
        name: "Secretaria de Desenvolvimento Econômico, Turismo e Inovação",
        observation: "Fomento econômico, turismo municipal e inovação",
      },
      {
        name: "Secretaria de Desenvolvimento Social",
        observation: "Assistência social, proteção à infância, adolescência e vulnerable social",
      },
      {
        name: "Secretaria da Educação",
        observation: "Política municipal de educação — rede municipal de ensino",
      },
      {
        name: "Secretaria do Esporte",
        observation: "Políticas públicas de esporte e lazer",
      },
      {
        name: "Secretaria da Fazenda",
        observation: "Gestão financeira, orçamentária e tributária do município",
      },
      {
        name: "Secretaria de Gestão e Governo Digital",
        observation: "Gestão administrativa, tecnologia da informação e governo digital — SIGESGD",
      },
      {
        name: "Secretaria de Governo",
        observation: "Relações institucionais, articulação política e protocolo",
      },
      {
        name: "Secretaria de Infraestrutura e Logística",
        observation: "Obras, pavimentação, drenagem, iluminação pública e mobilidade",
      },
      {
        name: "Secretaria de Meio Ambiente e Agricultura",
        observation: "Proteção ambiental, agropecuária e manejo de resíduos",
      },
      {
        name: "Secretaria de Negócios Jurídicos",
        observation: "Assessoria jurídica, consultoria e contencioso municipal",
      },
      {
        name: "Secretaria de Planejamento e Urbanismo",
        observation: "Planejamento estratégico, uso do solo e zoneamento",
      },
      {
        name: "Secretaria de Relações Públicas",
        observation: "Comunicação institucional, assessoria de imprensa e relações com a comunidade",
      },
      {
        name: "Secretaria da Saúde",
        observation: "Política municipal de saúde — Atenção Básica, Especializada e Vigilância",
      },
      {
        name: "Secretaria de Segurança Pública",
        observation: "Políticas de segurança, prevenção à violência e proteção cidadã",
      },
      {
        name: "Fundo Social de Solidariedade",
        observation: "Gestão do fundo de assistência e desenvolvimento social",
      },
    ];

    const secretariaIds: Record<string, string> = {};
    for (const s of secretarias) {
      const id = await insertOrg(s.name, "secretaria", pacoId, s.observation);
      secretariaIds[s.name] = id;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. UNIDADES DE SAÚDE (vinculadas à Secretaria da Saúde)
    // Fonte: https://capivari.sp.gov.br/portal/secretarias/saude/
    // ═══════════════════════════════════════════════════════════════════════
    const saudeId = secretariaIds["Secretaria da Saúde"];

    const unidadesSaude: Array<{ name: string; observation?: string }> = [
      {
        name: "Centro de Saúde Central — Dr. Mário Dias de Aguiar",
        observation: "Unidade central de referência da Atenção Básica — Rua Padre Haroldo, 553",
      },
      {
        name: "Posto de Saúde — Jardim Primavera",
        observation: "UBS de Atenção Básica — Rua Amazonas, 214, Jardim Primavera",
      },
      {
        name: "Posto de Saúde — Porto Alegre",
        observation: "EACS de Atenção Básica — Rua Vitório Gatti, 210",
      },
      {
        name: "Posto de Saúde — Engenho Velho",
        observation: "EACS de Atenção Básica — Rua Ordália Batista Motta, 230",
      },
      {
        name: "Posto de Saúde — Castelani",
        observation: "PSF de Atenção Básica — Av. Professor Newton Pimenta Neves, s/nº",
      },
      {
        name: "Posto de Saúde — São João",
        observation: "EACS de Atenção Básica — Av. Aurélia Cassaniga Mano, 67",
      },
      {
        name: "Posto de Saúde — Santa Rita",
        observation: "UBS de Atenção Básica — Rua Enio de Godoy, s/n",
      },
      {
        name: "Centro de Especialidades Médicas Shalon",
        observation: "Atenção Especializada — Rua João de Andrade, 51, Jardim Branyl",
      },
      {
        name: "Farmácia Municipal Edgard Dias de Aguiar",
        observation: "Assistência Farmacêutica — Rua Padre Fabiano, s/nº",
      },
      {
        name: "Laboratório Municipal",
        observation: "Exames laboratoriais — Rua Padre Haroldo, 553",
      },
      {
        name: "Centro de Controle de Zoonoses",
        observation: "Vigilância e controle de zoonoses — Rodovia Antônio Forti",
      },
      {
        name: "Ambulatório de IST/HIV/AIDS/Hepatites Virais",
        observation: "Prevenção e tratamento de infecções sexualmente transmissíveis — Rua Bento Dias, 265",
      },
      {
        name: "Ambulatório de Saúde Mental",
        observation: "Atenção à saúde mental — Rua João Vaz, 262, Centro",
      },
      {
        name: "CAPS II — Centro de Atenção Psicossocial",
        observation: "Atenção em saúde mental de média complexidade — Rua Sinharinha Frota, 290",
      },
      {
        name: "CAPS-AD — Centro de Atenção Psicossocial Álcool e Drogas",
        observation: "Atenção em saúde mental para álcool e drogas — Rua Barão do Rio Branco, 43",
      },
      {
        name: "Saúde Bucal",
        observation: "Odontologia municipal — Rua Sinharinha Frota, 578",
      },
      {
        name: "Vigilância Sanitária e Saúde do Trabalhador",
        observation: "Controle sanitário e saúde ocupacional — Rua Tiradentes, 823",
      },
      {
        name: "Vigilância Epidemiológica",
        observation: "Monitoramento epidemiológico — Rua Bento Dias, 265",
      },
      {
        name: "Fisioterapia",
        observation: "Serviço de fisioterapia — Rua João Marchioretto, 78, Jardim São Marcos",
      },
      {
        name: "Almoxarifado da Saúde",
        observation: "Gestão de materiais e suprimentos — Av. Brigadeiro Faria Lima, 50",
      },
      {
        name: "Central de Regulação",
        observation: "Regulação do acesso ambulatorial e hospitalar — Rua XV de Novembro, 1.029",
      },
    ];

    for (const u of unidadesSaude) {
      await insertOrg(u.name, "unidade", saudeId, u.observation);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. UNIDADES DE EDUCAÇÃO (vinculadas à Secretaria da Educação)
    // Fonte: https://capivari.sp.gov.br/portal/educacao/
    // ═══════════════════════════════════════════════════════════════════════
    const educacaoId = secretariaIds["Secretaria da Educação"];

    const unidadesEducacao: Array<{ name: string; observation?: string }> = [
      // ── EMEI (Escola Municipal de Educação Infantil) ──
      {
        name: "EMEI Alcina de Almeida Soares",
        observation: "Educação Infantil — Rua José Stênico, s/n, Engenho Velho",
      },
      {
        name: "EMEI Alcina Santos Proença",
        observation: "Educação Infantil — Rua Dr. Rolando Bolsonaro, 80, Jardim Santa Rita de Cássia",
      },
      {
        name: "EMEI Ana Bortoluci Forner",
        observation: "Educação Infantil — Rua José Vicente, 40, São João Batista",
      },
      {
        name: "EMEI Benedita Gonçalves Quagliato",
        observation: "Educação Infantil — Rua França, s/n, Santo Antônio",
      },
      {
        name: "EMEI Cecília Cerezer Ricomini",
        observation: "Educação Infantil — Rua Otávio Alves de Souza, s/n, Santa Rosa",
      },
      {
        name: "EMEI Emília Benevenuto Ortolani",
        observation: "Educação Infantil — Rua Benedito Caxias, s/n, Castelani",
      },
      {
        name: "EMEI Guerino Padovani",
        observation: "Educação Infantil — Av. José Annicchino, s/n, Padovani",
      },
      {
        name: "EMEI Dra. Jurema Aparecida de Souza Martins",
        observation: "Educação Infantil",
      },
      {
        name: "EMEI Maria Aparecida Boaventura de Almeida Garcia",
        observation: "Educação Infantil — Rua João Adolfo Stein, 287, Centro",
      },
      {
        name: "EMEI Nossa Senhora Rainha da Paz",
        observation: "Educação Infantil — Rua João de Andrade, 79, Jardim Branyl",
      },
      {
        name: "EMEI Rosa Amádio Balan",
        observation: "Educação Infantil — Rua Xavantes, s/n, Vila Balan",
      },
      {
        name: "EMEI José Hypólito Fernandes de Castro Carvalho",
        observation: "Educação Infantil — Av. Newton Pimenta Neves, 800, Castelani",
      },
      {
        name: "EMEI Professora Ester Annicchino Pagotto",
        observation: "Educação Infantil — Rua Padre Fabiano, 1035, Centro",
      },
      {
        name: "EMEI Professora Valéria Datti Quagliato Pacheco",
        observation: "Educação Infantil — Rua Anatólio Pellegrini, 520, Jardim Santa Maria",
      },
      // ── EMEIEF (Escola Municipal de Educação Infantil e Ensino Fundamental) ──
      {
        name: "EMEIEF Professora Maria do Carmo Amaral",
        observation: "Educação Infantil e Ensino Fundamental — Rua Antônio Honora, 196, Morada do Sol",
      },
      {
        name: "EMEIEF Amélia Francisca Alves",
        observation: "Educação Infantil e Ensino Fundamental — Rua João Emídio Capóssoli, 80, Santa Rosa",
      },
      {
        name: "EMEIEF Professora Ana Aparecida Rufino Dias",
        observation: "Educação Infantil e Ensino Fundamental — Rua Vitório Gatti, 250, Porto Alegre",
      },
      {
        name: "EMEIEF Professor Derly Andriotti",
        observation: "Educação Infantil e Ensino Fundamental — Rua Dr. Ênio de Godoy, s/n, Jardim Santa Rita de Cássia",
      },
      {
        name: "EMEIEF Professor José Benedito Pinto Antunes",
        observation: "Educação Infantil e Ensino Fundamental — Rua Padre Fabiano, 1351, Centro",
      },
      {
        name: "EMEIEF Dra. Jurema Aparecida de Sousa Martins",
        observation: "Educação Infantil e Ensino Fundamental — Rua 24 de Junho, 431, Nova Aparecida",
      },
      {
        name: "EMEIEF Professora Teresinha Aparecida Franchi",
        observation: "Educação Infantil e Ensino Fundamental — Av. Dr. Ênio Pires de Camargo, s/n, Ribeirão",
      },
      {
        name: "EMEIEF Professora Maria Rosa Lembo Duarte",
        observation: "Educação Infantil e Ensino Fundamental",
      },
      {
        name: "EMEIEF Professora Lenita de Camargo Penteado Figueiredo",
        observation: "Educação Infantil e Ensino Fundamental — Rua Santa Cruz, 278, Centro",
      },
      // ── EM (Escola Municipal — Ensino Fundamental) ──
      {
        name: "EM Professor Cherubim Fernandes Sampaio",
        observation: "Ensino Fundamental — Rua Josefina Navarro Valli, 27, Gênova",
      },
      {
        name: "EM Augusto Castanho",
        observation: "Ensino Fundamental — Rua General Osório, 551, Centro",
      },
      {
        name: "EM Laura Quagliato Pacheco",
        observation: "Ensino Fundamental — Rua João Emídio Capóssoli, 250, Santa Rosa",
      },
      // ── EICAP (Escola Integral de Capivari) ──
      {
        name: "EICAP Professor Aldo Silveira",
        observation: "Escola Integral — Av. José Annicchino, 1357, Moretti",
      },
      {
        name: "EICAP Professor Dirceu Ortolani Stein",
        observation: "Escola Integral — Av. Newton Pimenta Neves, 258, Castelani",
      },
      {
        name: "EICAP José Annicchino Fu Paulo",
        observation: "Escola Integral — Rua Aristeu Stênico, 31, São João Batista",
      },
      {
        name: "EICAP Lúcia Rosária Armelin Stefanini",
        observation: "Escola Integral — Rua Hermínia de Camargo Penteado, 220, Jardim Santa Terezinha",
      },
      {
        name: "EICAP Professora Teresinha de Jesus Macluf",
        observation: "Escola Integral — Rua Antônio Ribeiro de Godoy, s/n, São Marcos",
      },
      // ── Outras ──
      {
        name: "APAE de Capivari",
        observation: "Associação de Pais e Amigos dos Excepcionais — Educação Especial",
      },
    ];

    for (const u of unidadesEducacao) {
      await insertOrg(u.name, "unidade", educacaoId, u.observation);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. AUDIT LOG
    // ═══════════════════════════════════════════════════════════════════════
    await ctx.db.insert("auditLogs", {
      action: "create",
      entity: "organizations",
      entityId: pacoId,
      details: `Seed executado: ${inserted} organizações criadas (1 Paço Municipal + ${secretarias.length} Secretarias + ${unidadesSaude.length} Unidades de Saúde + ${unidadesEducacao.length} Unidades de Educação)`,
      timestamp: now,
    });

    return {
      inserted,
      message: `${inserted} organizações criadas com sucesso.`,
      breakdown: {
        pacoMunicipal: 1,
        secretarias: secretarias.length,
        unidadesSaude: unidadesSaude.length,
        unidadesEducacao: unidadesEducacao.length,
      },
    };
  },
});
