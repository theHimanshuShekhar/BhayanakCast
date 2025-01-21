import { Input } from "~/lib/components/ui/input";

interface ChatInputProps {
  inputText: string;
  handleChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  sendMessage: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function ChatInput({ inputText, handleChange, sendMessage }: ChatInputProps) {
  const characterCount = inputText.length;

  const maxLength = 500;

  return (
    <div className="flex-none space-y-2">
      <div className="relative">
        <Input
          id="input-34"
          className="peer pe-14"
          type="text"
          value={inputText}
          maxLength={maxLength}
          onChange={handleChange}
          onKeyDown={sendMessage}
          aria-describedby="character-count"
        />
        <output
          id="character-count"
          className="text-muted-foreground pointer-events-none absolute inset-y-0 end-0 flex items-center justify-center pe-3 text-xs tabular-nums peer-disabled:opacity-50"
          aria-live="polite"
          htmlFor="input-34"
        >
          {characterCount}/{maxLength}
        </output>
      </div>
    </div>
  );
}
