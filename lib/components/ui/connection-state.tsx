import { Badge } from "~/lib/components/ui/badge";

export function ConnectionState({ isConnected }: { isConnected: boolean }) {
  return (
    <div className={"inline-block rounded-md align-middle uppercase text-gray-100"}>
      Connection:
      <span>
        <Badge className={`mx-1 ${isConnected ? "bg-green-600" : "bg-red-600"}`}>
          <span>{isConnected ? "True" : "False"}</span>
        </Badge>
      </span>
    </div>
  );
}
