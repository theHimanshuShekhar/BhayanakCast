import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import ReactPlayer from "react-player";
import useWebSocket, { ReadyState } from "react-use-websocket";
import ViewerDisplay from "~/lib/components/ViewerDisplay";
import { getRoomFromDB, getServerURL, getUserFromDB } from "~/lib/server/functions";

// Cache time for query data (5 seconds)
const cacheTime = 1000 * 5;

// Create a route for /room/$roomid
export const Route = createFileRoute("/room/$roomid")({
  // Define the component to render for this route
  component: RouteComponent,
  ssr: false,

  // Function to run before the component loads
  beforeLoad: async ({ context, params }) => {
    // Redirect to home if the user is not authenticated
    if (!context.user) {
      throw redirect({ to: "/" });
    }

    // Fetch server URL
    const serverInfo = await getServerURL();

    // Configure query options for fetching user data
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

  // Construct WebSocket URL
  const wsURL = `${serverInfo.protocol === "https" ? "wss" : "ws"}://${serverInfo.serverURL}/_ws`;

  // Use WebSocket hook
  const { readyState } = useWebSocket(wsURL, {
    retryOnError: true,
    shouldReconnect: () => true,
    onOpen: () => {
      console.log("WebSocket connection opened");
    },
    onClose: () => {
      console.log("WebSocket connection closed");
    },
    onError: (error) => {
      console.error("WebSocket error", error);
    },
  });

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
      <div className="p-2 border col-span-full lg:col-span-2 flex flex-col bg-white dark:bg-gray-800 rounded-md shadow-xl">
        <div className="grow min-w-full min-h-[400px] rounded-md overflow-hidden dark:bg-gray-900">
          <ReactPlayer
            className="min-w-full min-h-full rounded-md overflow-hidden border-none max-h-full max-w-full"
            url="https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4"
          />
        </div>
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
      <div className="bg-white dark:bg-gray-800 flex flex-col col-span-full lg:col-span-1 gap-2 p-2 border rounded-md shadow-xl">
        <div className="flex flex-col gap-1 p-2">
          <div className="flex flex-wrap justify-between gap-1 items-start">
            <div className="font-bold text-xl break-words flex-1 min-w-0">
              {roomFromDB.name}
            </div>
            <div
              className={`inline-block p-2 rounded-md text-white text-sm shrink-0 ${connectionStatus === "Connected" ? "bg-green-500 dark:bg-green-900" : "bg-red-500 dark:bg-red-900"}`}
            >
              {connectionStatus}
            </div>
          </div>
          <div className="text-sm break-words">{roomFromDB.description}</div>
        </div>
        <div className="grow min-h-[300px] flex flex-col gap-1 ">
          <div className="border grow bg-white dark:bg-gray-700 p-2 rounded-md">
            Stream Chat
          </div>
          <div className="border bg-white dark:bg-gray-700 p-2 rounded-md">Input Box</div>
        </div>
      </div>
    </div>
  );
}
