import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ErrorBoundary } from "react-error-boundary";
import ReactPlayer from "react-player";
import useWebSocket, { ReadyState } from "react-use-websocket";
import ViewerDisplay from "~/lib/components/ViewerDisplay";
import { getRoomFromDB, getServerURL, getUserFromDB } from "~/lib/server/functions";
import { MessageType } from "~/lib/types";

// Cache time for query data (5 seconds)
const cacheTime = 1000 * 5;

// Error fallback component for ReactPlayer
function VideoErrorFallback({ error }: { error: Error }) {
  return (
    <div className="flex items-center justify-center h-full bg-red-100 dark:bg-red-900">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-red-800 dark:text-red-200">
          Error loading video
        </h3>
        <p className="text-sm text-red-600 dark:text-red-300">{error.message}</p>
      </div>
    </div>
  );
}

// Create a route for /room/$roomid
export const Route = createFileRoute("/room/$roomid")({
  component: RouteComponent,
  ssr: false,

  beforeLoad: async ({ context, params }) => {
    if (!context.user) {
      throw redirect({ to: "/" });
    }

    const serverInfo = await getServerURL();
    const roomID = params.roomid;
    const userId = context.user.id;

    if (!roomID) {
      throw redirect({ to: "/" });
    }

    // Configure query options for fetching user and room data
    const userQueryOptions = queryOptions({
      queryKey: ["user", userId],
      queryFn: ({ signal }) => getUserFromDB({ signal, data: userId }),
      staleTime: cacheTime,
      refetchInterval: cacheTime + 1,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
      retry: 1,
      retryDelay: 1000,
    });

    const roomQueryOptions = queryOptions({
      queryKey: ["room", roomID, userId],
      queryFn: ({ signal }) =>
        getRoomFromDB({
          signal,
          data: { roomid: roomID, userid: userId },
        }),
      staleTime: cacheTime,
      refetchInterval: cacheTime + 1,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
      retry: 1,
      retryDelay: 1000,
    });

    const [userFromDB, roomFromDB] = await Promise.all([
      context.queryClient.ensureQueryData(userQueryOptions),
      context.queryClient.ensureQueryData(roomQueryOptions),
    ]);

    if (!userFromDB || !roomFromDB) {
      throw redirect({ to: "/" });
    }

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
  const { roomQueryOptions, userQueryOptions, serverInfo } = Route.useLoaderData();

  const { data: userFromDB } = useSuspenseQuery({
    ...userQueryOptions,
    queryFn: () => getUserFromDB({ data: userQueryOptions.queryKey[1] as string }),
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

  // Use WebSocket hook with improved reconnection logic
  const { readyState, sendMessage } = useWebSocket(wsURL, {
    retryOnError: true,
    shouldReconnect: (closeEvent) => {
      // Don't reconnect on 1000 (normal closure) or 1001 (going away)
      return closeEvent.code !== 1000 && closeEvent.code !== 1001;
    },
    reconnectInterval: 2000,
    reconnectAttempts: 5,
    onOpen: () => {
      console.log("WebSocket connection opened");
      sendMessage(
        JSON.stringify({
          type: MessageType.JOIN,
          userID: userFromDB.id,
          roomID: roomFromDB.id,
        }),
      );
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

  if (!roomFromDB) {
    return <div>Room not found</div>;
  }

  return (
    <div className="grow grid grid-cols-3 gap-2">
      <div className="col-span-full lg:col-span-2 flex flex-col rounded-md gap-2">
        <div className="min-w-full rounded-md overflow-hidden bg-black grow">
          <ErrorBoundary FallbackComponent={VideoErrorFallback}>
            <ReactPlayer
              className="min-w-full min-h-full rounded-md overflow-hidden border-none max-h-full max-w-full border-3 border-yellow-500"
              url={
                "https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4"
                // "https://www.youtube.com/watch?v=wjQ-8YEi7-k"
              }
              controls
              muted
              width="100%"
              height="100%"
              config={{
                file: {
                  attributes: {
                    controlsList: "nodownload",
                    disablePictureInPicture: true,
                  },
                },
              }}
              key={typeof window === "undefined" ? "server" : "client"}
            />
          </ErrorBoundary>
        </div>
        <div className="flex gap-1">
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
              className={`inline-block p-2 rounded-md text-white text-sm shrink-0 ${
                connectionStatus === "Connected"
                  ? "bg-green-500 dark:bg-green-900"
                  : "bg-red-500 dark:bg-red-900"
              }`}
            >
              {connectionStatus}
            </div>
          </div>
          <div className="text-sm break-words">{roomFromDB.description}</div>
        </div>
        <div className="grow min-h-[300px] flex flex-col gap-1">
          <div className="border grow bg-gray-100 dark:bg-gray-700 p-2 rounded-md overflow-y-auto">
            {/* Chat messages will be rendered here */}
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Chat coming soon...
            </div>
          </div>
          <input
            type="text"
            placeholder="Type a message..."
            className="border bg-gray-100 dark:bg-gray-700 w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  );
}
