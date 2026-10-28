import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Category, NfeItem, ProductForMatch } from "@/lib/nfe";
import { quickProductPrefill, type QuickProductFormState } from "@/lib/quickProduct";
import React from "react";

export interface QuickProductFormProps {
  open: boolean;
  onClose: () => void;
  targetIndex: number;
  form: QuickProductFormState;
  onFormChange: (patch: Partial<QuickProductFormState>) => void;
  loading: boolean;
  categories: Category[];
  onSave: () => Promise<void>;
  onCancel: () => void;
  onCreateCategory: () => Promise<void>;
  newCategoryName: string;
  onNewCategoryNameChange: (value: string) => void;
  categoryOpen: boolean;
  onCategoryOpenChange: (value: boolean) => void;
}

export function QuickProductForm({
  open,
  onClose,
  form,
  onFormChange,
  loading,
  categories,
  onSave,
  onCancel,
  onCreateCategory,
  newCategoryName,
  onNewCategoryNameChange,
  categoryOpen,
  onCategoryOpenChange,
}: QuickProductFormProps) {
  return (
    <Dialog open={open} onOpenChange={(value) => value ? onCancel() : onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Cadastrar novo produto</DialogTitle>
          <DialogDescription>
            O produto é criado apenas no catálogo, com estoque inicial zero e sem afetar
            o estoque da entrada. A linha permanecerá aberta.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm text-muted-foreground">Nome do produto *</label>
            <Input
              className="min-w-0 flex-1"
              value={form.name}
              onChange={(event) => onFormChange({ name: event.target.value })}
              placeholder="KIT TECLADO E MOUSE USB SLIM CHOCO"
            />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm text-muted-foreground">Descrição fiscal</label>
            <Input
              className="min-w-0 flex-1"
              value={form.description}
              onChange={(event) => onFormChange({ description: event.target.value })}
              placeholder="Sem descrição fiscal"
            />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm text-muted-foreground">Categoria *</label>
            <Select
              value={form.categoryId || "none"}
              onValueChange={(value) => onFormChange({ categoryId: value === "none" ? "" : value })}
            >
              <SelectTrigger className="min-w-0 flex-1 mt-1">
                <SelectValue placeholder="Selecione a categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Selecione a categoria</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category._id} value={category._id}>
                    {category.name}
                  </SelectItem>
                ))}
                <SelectItem value="__new__">Criar categoria</SelectItem>
              </SelectContent>
            </Select>
            {form.categoryId === "" && (
              <p className="text-xs text-amber-700">
                Selecione uma categoria cadastrada ou crie uma nova para continuar.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm text-muted-foreground">Unidade de medida</label>
            <Select
              value={form.unitOfMeasure || "none"}
              onValueChange={(value) => onFormChange({ unitOfMeasure: value === "none" ? "un" : value })}
            >
              <SelectTrigger className="min-w-0 flex-1 mt-1">
                <SelectValue placeholder="Selecionar unidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Selecionar unidade</SelectItem>
                <SelectItem value="pc">Peça (pc)</SelectItem>
                <SelectItem value="un">Unidade (un)</SelectItem>
                {["kg","g","m","l","ml","cx","pct","prx","rol"].map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unit.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm text-muted-foreground">Marca</label>
            <Input
              className="min-w-0 flex-1"
              value={form.brand}
              onChange={(event) => onFormChange({ brand: event.target.value })}
              placeholder="Opcional — somente quando houver evidência no documento"
            />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm text-muted-foreground">Modelo</label>
            <Input
              className="min-w-0 flex-1"
              value={form.model}
              onChange={(event) => onFormChange({ model: event.target.value })}
              placeholder="Opcional — somente quando houver evidência no documento"
            />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm text-muted-foreground">Especificação</label>
            <Input
              className="min-w-0 flex-1"
              value={form.specification}
              onChange={(event) => onFormChange({ specification: event.target.value })}
              placeholder="Opcional"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-3">
          <Button variant="outline" onClick={onCancel} type="button" disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={() => void onSave()} type="button" disabled={loading}>
            Salvar produto
          </Button>
        </DialogFooter>

        {categoryOpen && (
          <CategoryCreatorDialog
            open={categoryOpen}
            onOpenChange={onCategoryOpenChange}
            name={newCategoryName}
            onNameChange={onNewCategoryNameChange}
            onSave={onCreateCategory}
            onCancel={() => onCategoryOpenChange(false)}
            loading={loading}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface CategoryCreatorDialogProps {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  name: string;
  onNameChange: (value: string) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}

export function CategoryCreatorDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  onSave,
  onCancel,
  loading,
}: CategoryCreatorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova categoria</DialogTitle>
          <DialogDescription>
            Crie uma categoria para classificar o produto recém-cadastrado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="text-sm text-muted-foreground">Nome da categoria *</label>
          <Input
            className="min-w-0 flex-1"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Ex.: Periféricos"
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} type="button" disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={onSave} type="button" disabled={loading || !name.trim()}>
            Criar categoria
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { NfeItem, ProductForMatch } from "@/lib/nfe";
export type { QuickProductFormState } from "@/lib/quickProduct";
export { quickProductPrefill } from "@/lib/quickProduct";
