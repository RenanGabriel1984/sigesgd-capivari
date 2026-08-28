import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings as SettingsIcon } from "lucide-react";

export default function Settings() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div><h1 className="text-2xl font-bold tracking-tight">Configurações</h1><p className="text-sm text-muted-foreground">Configurações do sistema</p></div>
        <Card className="border-border/50"><CardHeader><CardTitle className="text-base flex items-center gap-2"><SettingsIcon className="h-4 w-4" /> Configurações Gerais</CardTitle></CardHeader><CardContent>
          <p className="text-sm text-muted-foreground">Configurações adicionais serão disponibilizadas nas próximas versões do sistema.</p>
        </CardContent></Card>
      </div>
    </AppShell>
  );
}
