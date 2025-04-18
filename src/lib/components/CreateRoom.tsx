import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { createRoom } from "../server/functions";
import { Button } from "./ui/button";
import {
  Credenza,
  CredenzaBody,
  CredenzaClose,
  CredenzaContent,
  CredenzaDescription,
  CredenzaFooter,
  CredenzaHeader,
  CredenzaTitle,
} from "./ui/credenza";
import { Input } from "./ui/input";

interface CreateRoomProps {
  roomName?: string | null;
  userId?: string;
  setRoomName?: React.Dispatch<React.SetStateAction<string | null>>;
}
export function CreateRoom({ roomName, userId, setRoomName }: CreateRoomProps) {
  const [open, setOpen] = useState(false);
  const [roomDescription, setRoomDescription] = useState("");
  const router = useRouter();

  if (userId === null) {
    return null;
  }
  if (userId === undefined) {
    return null;
  }

  const handleOpen = () => {
    setOpen(true);
  };

  return (
    <>
      <Button onClick={handleOpen} className="text-xl p-8">
        Create New Room
      </Button>

      <Credenza open={open} onOpenChange={setOpen}>
        <CredenzaContent className="bg-white border rounded-md shadow-xl flex flex-col justify-between p-4 dark:bg-gray-800">
          <CredenzaHeader>
            <CredenzaTitle>Create New Room</CredenzaTitle>
            <CredenzaDescription>
              Enter a name and optional description for your room.
            </CredenzaDescription>
          </CredenzaHeader>
          <CredenzaBody>
            <div className="relative flex flex-col gap-2 bg-white dark:bg-gray-800 rounded-md">
              <Input
                className="dark:bg-gray-800"
                placeholder="Room name..."
                type="input"
                autoFocus
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                onChange={(e) => setRoomName?.(e.target.value)}
                value={roomName ?? ""}
              />
              <Input
                className="dark:bg-gray-800"
                placeholder="Room description..."
                type="input"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck="false"
                onChange={(e) => setRoomDescription(e.target.value)}
                value={roomDescription}
              />
            </div>
          </CredenzaBody>
          <CredenzaFooter>
            <CredenzaClose asChild>
              <Button
                onClick={() => {
                  // Handle room creation logic here
                  createRoom({
                    data: {
                      name: roomName || "",
                      description: roomDescription || "",
                      userId: userId,
                    },
                  }).then((roomID) => {
                    console.log("Room created:", roomID);
                    // Close the modal after room creation
                    setOpen(false);
                    // Route to the new room
                    router.navigate({ to: "/room/$roomid", params: { roomid: roomID } });
                  });

                  setOpen(false);
                }}
              >
                Create Room
              </Button>
            </CredenzaClose>
          </CredenzaFooter>
        </CredenzaContent>
      </Credenza>
    </>
  );
}
