import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

// input props
interface ViewerDisplay {
  id: string | null;
  name: string;
  image: string | null;
}

export default function ViewerDisplay(user: ViewerDisplay) {
  return (
    <div className="cursor-pointer bg-white dark:bg-gray-700 border shadow-md flex gap-2 items-center font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 p-1 rounded-md">
      <Avatar>
        <AvatarImage src={user.image || "https://github.com/shadcn.png"} />
        <AvatarFallback>{user.name}</AvatarFallback>
      </Avatar>
      <div className="hidden md:block">{user.name}</div>
    </div>
  );
}
