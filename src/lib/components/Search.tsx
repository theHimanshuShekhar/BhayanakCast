import { ArrowRight, Search } from "lucide-react";
import { useId } from "react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface SearchBarProps {
  setSearchString: (query: string | null) => void;
}

export function SearchBar({ setSearchString }: SearchBarProps) {
  const id = useId();
  return (
    <div className="space-y-2 flex flex-col min-w-[300px]">
      <Label htmlFor={id}>Search or Create a room</Label>
      <div className="relative bg-white dark:bg-gray-800 rounded-md">
        <Input
          onChange={(event) => {
            setSearchString(event.currentTarget.value);
          }}
          id={id}
          className="peer pe-9 ps-9 dark:bg-gray-800"
          placeholder="Search..."
          type="search"
        />
        <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground/80 peer-disabled:opacity-50">
          <Search size={16} strokeWidth={2} />
        </div>
        <button
          className="absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-lg text-muted-foreground/80 outline-offset-2 transition-colors hover:text-foreground focus:z-10 focus-visible:outline focus-visible:outline-ring/70 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Submit search"
          type="submit"
        >
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
