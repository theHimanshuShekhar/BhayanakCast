import { Badge } from "~/lib/components/ui/badge";

export function ConnectionState({ isConnected }: { isConnected: boolean }) {
  return (
    <div
      className={"my-2 inline-block rounded-md p-1 align-middle uppercase text-gray-100"}
    >
      Connection:
      <span>
        <Badge className={`mx-1 ${isConnected ? "bg-green-600" : "bg-red-600"}`}>
          {isConnected ? "True" : "False"}
        </Badge>
      </span>
    </div>
  );
}
