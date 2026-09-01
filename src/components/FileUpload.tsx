import { useState, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Camera, Upload, X, FileText, Image, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface FileUploadProps {
  /** Current storage ID (if file already uploaded) */
  storageId?: string | null;
  /** Called when file is uploaded and storage ID is available */
  onUpload: (storageId: string) => void;
  /** Called when file is removed */
  onRemove?: () => void;
  /** Whether to show camera capture option */
  capture?: boolean;
  /** Accepted file types */
  accept?: string;
  /** Label text */
  label?: string;
  /** Whether the upload is disabled */
  disabled?: boolean;
  /** Size variant */
  size?: "sm" | "md";
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function FileUpload({
  storageId,
  onUpload,
  onRemove,
  capture = true,
  accept = "image/*",
  label,
  disabled = false,
  size = "md",
}: FileUploadProps) {
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const fileUrl = useQuery(
    api.storage.getUrl,
    storageId ? { storageId } : "skip"
  );
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast.error("Arquivo muito grande. Tamanho máximo: 10MB");
      return;
    }

    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!response.ok) throw new Error("Falha no upload");

      const { storageId: newStorageId } = await response.json();
      onUpload(newStorageId);
      toast.success("Arquivo enviado com sucesso");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao enviar arquivo");
    }
    setUploading(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const isImage = fileUrl && (fileUrl.includes("image") || storageId?.includes("img"));

  // Small size variant
  if (size === "sm") {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleFileInput}
          className="hidden"
        />
        {capture && (
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileInput}
            className="hidden"
          />
        )}
        {storageId ? (
          <div className="flex items-center gap-1.5">
            {fileUrl ? (
              <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                <Image className="h-3 w-3" /> Ver foto
              </a>
            ) : (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" /> Arquivo anexado
              </span>
            )}
            {!disabled && onRemove && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={onRemove}
              >
                <X className="h-3 w-3 text-destructive" />
              </Button>
            )}
          </div>
        ) : uploading ? (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Enviando...
          </span>
        ) : (
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={() => cameraInputRef.current?.click()}
              disabled={disabled}
            >
              <Camera className="h-3 w-3" /> Foto
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
            >
              <Upload className="h-3 w-3" /> Arquivo
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Normal size variant
  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileInput}
        className="hidden"
      />
      {capture && (
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileInput}
          className="hidden"
        />
      )}

      {storageId && fileUrl ? (
        <div className={`relative ${isImage ? "border rounded-lg overflow-hidden" : ""}`}>
          {isImage ? (
            <div className="relative group">
              <img
                src={fileUrl}
                alt="Preview"
                className="w-full h-32 object-cover"
              />
              {!disabled && (
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="h-3 w-3 mr-1" /> Substituir
                  </Button>
                  {onRemove && (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={onRemove}
                    >
                      <X className="h-3 w-3 mr-1" /> Remover
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
              <FileText className="h-8 w-8 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">Arquivo anexado</p>
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Clique para visualizar
                </a>
              </div>
              {!disabled && (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-3 w-3" />
                  </Button>
                  {onRemove && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={onRemove}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : uploading ? (
        <div className="flex items-center gap-2 p-3 border rounded-lg border-dashed">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Enviando arquivo...</span>
        </div>
      ) : (
        <div
          className={`flex items-center gap-2 p-3 border rounded-lg border-dashed cursor-pointer transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "hover:border-primary/50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          {label && <p className="text-xs text-muted-foreground mb-2">{label}</p>}
          <div className="flex items-center gap-2 w-full">
            {capture && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={(e) => { e.stopPropagation(); cameraInputRef.current?.click(); }}
                disabled={disabled}
              >
                <Camera className="h-4 w-4" /> Tirar Foto
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              disabled={disabled}
            >
              <Upload className="h-4 w-4" /> Selecionar Arquivo
            </Button>
            <span className="text-xs text-muted-foreground">
              {accept.includes("image") ? "Imagens" : "Arquivos"} (máx. 10MB)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
