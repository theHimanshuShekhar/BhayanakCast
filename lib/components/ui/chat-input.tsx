import { useState, type ChangeEvent } from "react";
import { Input } from "~/lib/components/ui/input";

interface UseCharacterLimitProps {
  maxLength: number;
}

export function useCharacterLimit({ maxLength }: UseCharacterLimitProps) {
  const [value, setValue] = useState("");
  const characterCount = value.length;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
  };

  return {
    value,
    characterCount,
    handleChange,
    maxLength,
  };
}

export function ChatInput() {
  const maxLength = 50;
  const {
    value,
    characterCount,
    handleChange,
    maxLength: limit,
  } = useCharacterLimit({ maxLength });

  return (
    <div className="flex-none space-y-2">
      <div className="relative">
        <Input
          id="input-34"
          className="peer pe-14"
          type="text"
          value={value}
          maxLength={maxLength}
          onChange={handleChange}
          aria-describedby="character-count"
        />
        <output
          id="character-count"
          className="text-muted-foreground pointer-events-none absolute inset-y-0 end-0 flex items-center justify-center pe-3 text-xs tabular-nums peer-disabled:opacity-50"
          aria-live="polite"
          htmlFor="input-34"
        >
          {characterCount}/{limit}
        </output>
      </div>
    </div>
  );
}
