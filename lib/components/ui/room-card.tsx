import { MagicCard } from "~/lib/components/ui/magic-card";
import AvatarCircles from "./avatar-circles";

const avatars = [
  {
    imageUrl: "https://avatars.githubusercontent.com/u/16860528",
    profileUrl: "https://github.com/dillionverma",
  },
  {
    imageUrl: "https://avatars.githubusercontent.com/u/20110627",
    profileUrl: "https://github.com/tomonarifeehan",
  },
  {
    imageUrl: "https://avatars.githubusercontent.com/u/106103625",
    profileUrl: "https://github.com/BankkRoll",
  },
  {
    imageUrl: "https://avatars.githubusercontent.com/u/59228569",
    profileUrl: "https://github.com/safethecode",
  },
  {
    imageUrl: "https://avatars.githubusercontent.com/u/59442788",
    profileUrl: "https://github.com/sanjay-mali",
  },
  {
    imageUrl: "https://avatars.githubusercontent.com/u/89768406",
    profileUrl: "https://github.com/itsarghyadas",
  },
];

interface RoomCardProps {
  roomName: string;
}

export function RoomCard({ roomName }: RoomCardProps) {
  return (
    <div
      className={"h-[200px] w-full flex-col gap-4 sm:h-[300px] md:h-[300px] lg:h-[250px]"}
    >
      <MagicCard
        className="flex cursor-pointer flex-col items-center justify-center whitespace-nowrap border text-center text-4xl shadow-2xl"
        gradientColor={"#262626"}
      >
        <div className="pb-2">{roomName}</div>
        <AvatarCircles
          numPeople={avatars.length}
          avatarUrls={avatars.slice(0, 5)}
          className="flex justify-center"
        />
      </MagicCard>
    </div>
  );
}
