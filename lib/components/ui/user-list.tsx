import type { User } from "~/lib/server/db/schema";
import BlurFade from "./blur-fade";
import { Avatar, AvatarImage } from "./avatar";

export function UserList({
  userList,
  streamerID,
}: {
  userList: User[];
  streamerID: string;
}) {
  return (
    <>
      {userList.map(
        (user, idx) =>
          user && (
            <div key={user.uuid}>
              {user.uuid === streamerID && (
                <BlurFade
                  delay={0.25 + idx * 0.05}
                  inView
                  className="flex items-center justify-center rounded-full bg-yellow-600 p-1 text-white"
                >
                  <Avatar>
                    <AvatarImage
                      src={user?.avatar_url ?? "https://github.com/shadcn.png"}
                    />
                  </Avatar>
                  <div className="flex items-center px-2 text-center font-bold">
                    {user.name}
                  </div>
                </BlurFade>
              )}

              {user.uuid !== streamerID && (
                <BlurFade
                  delay={0.25 + idx * 0.05}
                  inView
                  className="flex items-center justify-center rounded-full bg-gray-700 p-1"
                >
                  <Avatar>
                    <AvatarImage
                      src={user?.avatar_url ?? "https://github.com/shadcn.png"}
                    />
                  </Avatar>
                  <div className="flex items-center px-2 text-center font-bold">
                    {user.name}
                  </div>
                </BlurFade>
              )}
            </div>
          ),
      )}
    </>
  );
}
