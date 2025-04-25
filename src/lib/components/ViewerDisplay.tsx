import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

// input props
interface ViewerDisplay {
  id: string | null;
  name: string;
  image: string | null;
  isStreamer: boolean;
}

export default function ViewerDisplay(user: ViewerDisplay) {
  return (
    <div
      className={`cursor-pointer ${user.isStreamer ? "bg-yellow-300 text-gray-600 dark:bg-yellow-500 hover:bg-yellow-500 dark:hover:bg-yellow-300" : "bg-white dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"}  shadow-md flex gap-2 items-center font-semibold  p-1 rounded-md`}
    >
      <Avatar>
        <AvatarImage src={user.image || "https://github.com/shadcn.png"} />
        <AvatarFallback>{user.name}</AvatarFallback>
      </Avatar>
      <div className="hidden md:block">{user.name}</div>
    </div>
  );
}
