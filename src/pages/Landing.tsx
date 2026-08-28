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
  Lock,
  CheckCircle2,
  Smartphone,
  Globe,
  Boxes,
  Zap,
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
    title: "Product Catalog",
    desc: "Maintain a complete catalog with categories, stock levels, suppliers, and detailed product information — all in one place.",
  },
  {
    icon: ClipboardList,
    title: "Request Management",
    desc: "Submit, approve, and track material requests through a structured workflow with full visibility at every step.",
  },
  {
    icon: Shield,
    title: "Full Audit Trail",
    desc: "Every action is logged with timestamps and user attribution for complete accountability and compliance.",
  },
  {
    icon: Building2,
    title: "Organizational Structure",
    desc: "Model any team hierarchy — departments, units, and teams — without being locked into a rigid template.",
  },
  {
    icon: BarChart3,
    title: "Live Dashboard",
    desc: "Real-time overview of stock levels, pending requests, and items requiring attention, always up to date.",
  },
  {
    icon: Lock,
    title: "Role-Based Access",
    desc: "Granular permissions ensure each team member sees and does only what their role allows — nothing more.",
  },
];

const stats = [
  { value: "100%", label: "Stock Control" },
  { value: "5", label: "Access Roles" },
  { value: "∞", label: "Scalable" },
  { value: "24/7", label: "Available" },
];

const roles = [
  { role: "Administrator", perms: ["Full system access", "Manage users and roles", "System configuration"] },
  { role: "Stock Manager", perms: ["Register products and categories", "Record entries and exits", "Approve incoming requests"] },
  { role: "Director", perms: ["View stock levels", "Approve material requests", "Review movement history"] },
  { role: "Secretary", perms: ["View stock overview", "Authorize material requests", "Access management reports"] },
  { role: "Technician", perms: ["Browse available materials", "Submit new requests", "Track request status"] },
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
                Sign In
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="sm" className="gap-2">
                Get Started
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
              Inventory Management Platform
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1]">
              SIGESGD{" "}
              <span className="text-primary/70">Capivari</span>
            </h1>
            <p className="mt-4 text-lg sm:text-xl text-muted-foreground max-w-2xl leading-relaxed">
              A precise, secure inventory management system built for teams that need
              full visibility over their stock — from procurement to delivery.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link to="/auth">
                <Button size="lg" className="gap-2 w-full sm:w-auto">
                  Start Managing Stock
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto" asChild>
                <a href="#features">
                  Learn More
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
              Everything your team needs
            </h2>
            <p className="mt-3 text-muted-foreground">
              Core capabilities designed for teams that manage physical inventory
              and need a reliable, auditable system of record.
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
              Access control by role
            </h2>
            <p className="mt-3 text-muted-foreground">
              Granular permissions ensure every team member has exactly the access they need —
              no more, no less.
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
              Works everywhere
            </h2>
            <p className="mt-3 text-muted-foreground">
              Fully responsive and installable as a progressive web app.
              Works on desktop, tablet, and mobile — no app store required.
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
                <span className="text-sm font-medium">Mobile</span>
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
              Ready to take control?
            </h2>
            <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
              Create your account and start managing inventory with full visibility,
              accountability, and control.
            </p>
            <Link to="/auth" className="mt-8 inline-block">
              <Button size="lg" className="gap-2">
                Open SIGESGD
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
            Inventory management platform for teams that demand precision.
          </p>
        </div>
      </footer>
    </div>
  );
}
