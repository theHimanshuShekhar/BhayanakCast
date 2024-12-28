"use client";

import { cn } from "~/lib/utils";

interface Avatar {
  imageUrl: string;
  profileUrl: string;
}
interface AvatarCirclesProps {
  className?: string;
  numPeople?: number;
  avatarUrls: Avatar[];
}

const AvatarCircles = ({ numPeople, className, avatarUrls }: AvatarCirclesProps) => {
  return (
    <div className={cn("z-10 flex -space-x-4 rtl:space-x-reverse", className)}>
      {avatarUrls.map((url) => (
        <a
          key={url.profileUrl}
          href={url.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            className="h-10 w-10 rounded-full border-2 border-white dark:border-gray-800"
            src={url.imageUrl}
            width={40}
            height={40}
            alt={"Avatar"}
          />
        </a>
      ))}
      {(numPeople ?? 0) > 0 && (
        <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-purple-600 bg-purple-600 text-center text-xs font-medium text-white hover:border-purple-500">
          +{numPeople}
        </div>
      )}
    </div>
  );
};

export default AvatarCircles;
