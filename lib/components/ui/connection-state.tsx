export function ConnectionState({ isConnected }: { isConnected: boolean }) {
  return (
    <div
      className={`my-2 inline-block rounded-md p-1 uppercase text-gray-100 ${isConnected ? "bg-green-600" : "bg-red-600"}`}
    >
      Connection: <span className="font-semibold">{`${isConnected}`}</span>
    </div>
  );
}
