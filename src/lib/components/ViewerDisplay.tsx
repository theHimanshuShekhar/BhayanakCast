import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

// input props
interface ViewerDisplay {
  id: string | null;
  name: string;
  image: string | null;
}

export default function ViewerDisplay(user: ViewerDisplay) {
  return (
    <div className="cursor-pointer flex gap-2 items-center bg-purple-500 text-white dark:bg-purple-700 font-semibold hover:bg-purple-700 dark:hover:bg-purple-600 p-1 rounded-md">
      <Avatar>
        <AvatarImage src={user.image || "https://github.com/shadcn.png"} />
        <AvatarFallback>{user.name}</AvatarFallback>
      </Avatar>
      <div className="hidden md:block">{user.name}</div>
    </div>
  );
}
