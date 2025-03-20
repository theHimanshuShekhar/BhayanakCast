import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

// input props
interface UserDisplay {
  id: string | null;
  name: string;
  image: string | null;
}

export default function UserDisplay(user: UserDisplay) {
  return (
    <div className="cursor-pointer flex gap-2 items-center font-semibold hover:bg-accent p-1 rounded-md">
      <Avatar>
        <AvatarImage src={user.image || "https://github.com/shadcn.png"} />
        <AvatarFallback>{user.name}</AvatarFallback>
      </Avatar>
      <div className="hidden md:block">{user.name}</div>
    </div>
  );
}
