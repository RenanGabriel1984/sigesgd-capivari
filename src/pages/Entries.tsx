  {categoryOpen && (
    <Dialog
      open={categoryOpen}
      onOpenChange={onCategoryOpenChange}
    >
      <DialogContent className="sm:max-w-xs">
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
            value={newCategoryName}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => onNewCategoryNameChange(event.target.value)}
            placeholder="Nome da categoria"
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} type="button" disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={onCreateCategory} type="button" disabled={loading || !newCategoryName.trim()}>
            Criar categoria
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )}
