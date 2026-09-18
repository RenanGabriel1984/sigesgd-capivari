import { forwardRef, type KeyboardEvent, type ComponentProps } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = ComponentProps<typeof Input> & {
  /** Sobrescreve classes do ícone (tamanho/posição) quando o layout exigir */
  iconClassName?: string;
};

/**
 * Campo de pesquisa padronizado do SIGESGD.
 *
 * Comportamento no celular: a pesquisa acontece a cada tecla (state
 * controlado); o ENTER apenas PREVINE submit/recarregamento e DESFOCA o
 * campo — o teclado virtual recolhe, o termo e o resultado permanecem.
 * `type="search"` + `enterKeyHint="search"` dão a legenda correta da tecla
 * e o botão de limpar nos navegadores móveis.
 */
export const SearchInput = forwardRef<HTMLInputElement, Props>(function SearchInput(
  { className, iconClassName, onKeyDown, ...props },
  ref
) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
    onKeyDown?.(e);
  };
  return (
    <>
      <Search
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground",
          iconClassName
        )}
      />
      <Input
        ref={ref}
        type="search"
        enterKeyHint="search"
        className={cn("pl-9", className)}
        onKeyDown={handleKeyDown}
        {...props}
      />
    </>
  );
});
