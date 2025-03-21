import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import useWebSocket, { ReadyState } from "react-use-websocket";
import ViewerDisplay from "~/lib/components/ViewerDisplay";
import { getRoomFromDB, getServerURL, getUserFromDB } from "~/lib/server/functions";

const cacheTime = 1000 * 5;

export const Route = createFileRoute("/room/$roomid")({
  component: RouteComponent,
  beforeLoad: async ({ context, params }) => {
    if (!context.user) {
      throw redirect({ to: "/" });
    }

    const serverInfo = await getServerURL();

    const userQueryOptions = queryOptions({
      queryKey: ["user", context.user.id],
      queryFn: ({ signal, queryKey }) => getUserFromDB({ signal, data: queryKey[1] }),
      staleTime: cacheTime,
      refetchInterval: cacheTime + 1,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
      retry: 1,
      retryDelay: 1000,
    });

    const userFromDB = await context.queryClient.ensureQueryData(userQueryOptions);

    if (!userFromDB || userFromDB.length < 1) {
      throw redirect({ to: "/" });
    }

    const roomID = params.roomid;
    if (!roomID) {
      throw redirect({ to: "/" });
    }
    if (!context.user) {
      throw redirect({ to: "/" });
    }
    const roomQueryOptions = queryOptions({
      queryKey: ["room", roomID, context.user.id, context.user],
      queryFn: ({ signal }) => {
        if (!context.user) return;
        return getRoomFromDB({
          signal,
          data: { roomid: roomID, userid: context.user.id },
        });
      },
      staleTime: cacheTime,
      refetchInterval: cacheTime + 1,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
      retry: 1,
      retryDelay: 1000,
    });

    const roomFromDB = await context.queryClient.ensureQueryData(roomQueryOptions);

    return { userFromDB, roomFromDB, userQueryOptions, roomQueryOptions, serverInfo };
  },
  loader: ({ context }) => {
    return {
      userFromDB: context.userFromDB,
      roomFromDB: context.roomFromDB,
      userQueryOptions: context.userQueryOptions,
      roomQueryOptions: context.roomQueryOptions,
      serverInfo: context.serverInfo,
    };
  },
  preload: true,
  shouldReload: true,
});

function RouteComponent() {
  const { userQueryOptions, roomQueryOptions, serverInfo } = Route.useLoaderData();

  const { data: userFromDB } = useSuspenseQuery({
    ...userQueryOptions,
    queryFn: () => getUserFromDB({ data: userQueryOptions.queryKey[1] }),
  });
  const { data: roomFromDB } = useSuspenseQuery({
    ...roomQueryOptions,
    queryFn: () =>
      getRoomFromDB({
        data: {
          roomid: roomQueryOptions.queryKey[1] as string,
          userid: roomQueryOptions.queryKey[2] as string,
        },
      }),
  });

  const { readyState } = useWebSocket(
    `${serverInfo.protocol === "https" ? "wss" : "ws"}://${serverInfo.serverURL}/_ws`,
    {
      shouldReconnect: () => typeof window !== "undefined",
      onOpen: () => {
        console.log("WebSocket connection opened");
      },
      onClose: () => {
        console.log("WebSocket connection closed");
      },
      onError: (error) => {
        console.error("WebSocket error", error);
      },
    },
  );

  const connectionStatus = {
    [ReadyState.CONNECTING]: "Connecting",
    [ReadyState.OPEN]: "Connected",
    [ReadyState.CLOSING]: "Closing",
    [ReadyState.CLOSED]: "Closed",
    [ReadyState.UNINSTANTIATED]: "Uninstantiated",
  }[readyState];

  console.info("userFromDB", userFromDB);

  if (!roomFromDB) {
    return <div>Room not found</div>;
  }

  return (
    <div className="grow grid grid-cols-3 gap-2">
      <div className="border-2 border-blue-300 col-span-full md:col-span-2 flex flex-col">
        <div className="grow border min-h-[240px]">Stream Player</div>
        <div className="flex gap-1 p-2">
          {roomFromDB.viewers.map((viewer) => (
            <ViewerDisplay
              id={viewer.id}
              image={viewer.image}
              name={viewer.name}
              key={viewer.id}
            />
          ))}
        </div>
      </div>
      <div className="border-2 border-blue-300 flex flex-col col-span-full md:col-span-1 gap-2 p-2">
        <div className="flex flex-col gap-1">
          <div className="text-xl font-bold">{roomFromDB.name}</div>
          <div className="text-sm">{roomFromDB.description}</div>
          <div>{connectionStatus}</div>
        </div>
        <div className="border grow min-h-[300px] flex flex-col gap-1">
          <div className="border grow">Stream Chat</div>
          <div className="border">Input Box</div>
        </div>
      </div>
    </div>
  );
}
