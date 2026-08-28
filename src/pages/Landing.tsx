import { motion } from "framer-motion";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowRight,
  Shield,
  Package,
  ClipboardList,
  BarChart3,
  Building2,
  CheckCircle2,
  Smartphone,
  Globe,
} from "lucide-react";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.1 } },
};

const features = [
  {
    icon: Package,
    title: "Catálogo de Produtos",
    desc: "Mantenha um catálogo completo com categorias, níveis de estoque, fornecedores e informações detalhadas — tudo em um só lugar.",
  },
  {
    icon: ClipboardList,
    title: "Gestão de Solicitações",
    desc: "Envie, aprove e acompanhe solicitações de materiais por meio de um fluxo estruturado com visibilidade total em cada etapa.",
  },
  {
    icon: Shield,
    title: "Trilha de Auditoria",
    desc: "Cada ação é registrada com carimbo de data/hora e atribuição de usuário para total responsabilidade e conformidade.",
  },
  {
  icon: Building2,
    title: "Estrutura Organizacional",
    desc: "Modele qualquer hierarquia de equipe — departamentos, unidades e setores — sem ficar preso a um modelo rígido.",
  },
  {
    icon: BarChart3,
    title: "Painel em Tempo Real",
    desc: "Visão geral dos níveis de estoque, solicitações pendentes e itens que necessitam atenção, sempre atualizados.",
  },
  {
    icon: Shield,
    title: "Acesso por Perfil",
    desc: "Permissões granulares garantem que cada membro da equipe veja e faça apenas o que seu perfil permite — nada mais.",
  },
];

const stats = [
  { value: "100%", label: "Controle de Estoque" },
  { value: "5", label: "Perfis de Acesso" },
  { value: "∞", label: "Escalável" },
  { value: "24/7", label: "Disponível" },
];

const roles = [
  { role: "Administrador", perms: ["Acesso total ao sistema", "Gerenciar usuários e perfis", "Configurações gerais"] },
  { role: "Responsável pelo Estoque", perms: ["Cadastrar produtos e categorias", "Registrar entradas e saídas", "Aprovar solicitações pendentes"] },
  { role: "Diretor", perms: ["Consultar níveis de estoque", "Aprovar solicitações de materiais", "Revisar histórico de movimentações"] },
  { role: "Secretário", perms: ["Consultar visão geral do estoque", "Autorizar fornecimento de materiais", "Acessar relatórios gerenciais"] },
  { role: "Técnico", perms: ["Consultar materiais disponíveis", "Criar novas solicitações", "Acompanhar status das solicitações"] },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xs">
              SG
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">SIGESGD</p>
              <p className="text-[10px] text-muted-foreground leading-tight hidden sm:block">Capivari</p>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/auth">
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
                Entrar
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="sm" className="gap-2">
                Começar
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] via-transparent to-primary/[0.02]" />
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28 lg:py-36">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-3 py-1 text-xs text-muted-foreground mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Plataforma de Gestão de Estoque
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1]">
              SIGESGD{" "}
              <span className="text-primary/70">Capivari</span>
            </h1>
            <p className="mt-4 text-lg sm:text-xl text-muted-foreground max-w-2xl leading-relaxed">
              Sistema Integrado de Gestão da Secretaria de Gestão e Governo Digital —
              Controle inteligente de estoque, materiais e movimentações para a
              administração pública.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link to="/auth">
                <Button size="lg" className="gap-2 w-full sm:w-auto">
                  Começar a Gerenciar
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto" asChild>
                <a href="#features">
                  Saiba Mais
                </a>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border/60 bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
          <motion.div
            variants={stagger}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="grid grid-cols-2 md:grid-cols-4 gap-6"
          >
            {stats.map((stat) => (
              <motion.div key={stat.label} variants={fadeIn} className="text-center">
                <p className="text-3xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-2xl mb-12"
          >
            <h2 className="text-3xl font-bold tracking-tight">
              Tudo que sua equipe precisa
            </h2>
            <p className="mt-3 text-muted-foreground">
              Funcionalidades essenciais projetadas para equipes que gerenciam
              estoque físico e precisam de um sistema confiável e auditável.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((feat, i) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
              >
                <Card className="h-full border-border/50 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4">
                      <feat.icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-semibold mb-1.5">{feat.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Roles */}
      <section className="bg-muted/30 border-y border-border/60 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-2xl mb-12"
          >
            <h2 className="text-3xl font-bold tracking-tight">
              Controle de acesso por perfil
            </h2>
            <p className="mt-3 text-muted-foreground">
              Permissões granulares garantem que cada membro da equipe tenha exatamente
              o acesso que precisa — nem mais, nem menos.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((item, i) => (
              <motion.div
                key={item.role}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
              >
                <Card className="h-full border-border/50 shadow-sm">
                  <CardContent className="p-6">
                    <h3 className="font-semibold mb-3">{item.role}</h3>
                    <ul className="space-y-2">
                      {item.perms.map((p) => (
                        <li key={p} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Platform */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center max-w-2xl mx-auto"
          >
            <h2 className="text-3xl font-bold tracking-tight">
              Funciona em qualquer dispositivo
            </h2>
            <p className="mt-3 text-muted-foreground">
              Totalmente responsivo e instalável como aplicativo web progressivo.
              Funciona em desktop, tablet e celular — sem necessidade de loja de aplicativos.
            </p>
            <div className="flex justify-center gap-8 mt-8">
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Globe className="h-6 w-6" />
                </div>
                <span className="text-sm font-medium">Desktop</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Smartphone className="h-6 w-6" />
                </div>
                <span className="text-sm font-medium">Celular</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60 bg-muted/30 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold tracking-tight">
              Pronto para começar?
            </h2>
            <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
              Crie sua conta e comece a gerenciar o estoque com visibilidade total,
              responsabilidade e controle.
            </p>
            <Link to="/auth" className="mt-8 inline-block">
              <Button size="lg" className="gap-2">
                Acessar o SIGESGD
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground font-bold text-[9px]">
              SG
            </div>
            <span className="text-sm font-medium">SIGESGD Capivari</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Plataforma de gestão de estoque para equipes que exigem precisão.
          </p>
        </div>
      </footer>
    </div>
  );
}
