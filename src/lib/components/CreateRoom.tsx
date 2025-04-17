import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { createRoom } from "../server/functions";
import { Button } from "./ui/button";
import {
  Credenza,
  CredenzaBody,
  CredenzaClose,
  CredenzaContent,
  CredenzaFooter,
  CredenzaHeader,
  CredenzaTitle,
} from "./ui/credenza";
import { Input } from "./ui/input";

interface CreateRoomProps {
  initialRoomName?: string | null;
  userId?: string | null;
}
export function CreateRoom({ initialRoomName, userId }: CreateRoomProps) {
  const [open, setOpen] = useState(false);
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
          </CredenzaHeader>
          <CredenzaBody>
            <div className="relative flex flex-col gap-2 bg-white dark:bg-gray-800 rounded-md">
              <Input
                className="peer pe-9 ps-9 dark:bg-gray-800"
                placeholder="Room name..."
                type="input"
                defaultValue={initialRoomName || ""}
                autoFocus
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
              <Input
                className="peer pe-9 ps-9 dark:bg-gray-800"
                placeholder="Room description..."
                type="input"
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
                      name: initialRoomName || "",
                      description: "",
                      userId: userId || "",
                    },
                  }).then((roomID) => {
                    console.log("Room created:", roomID);
                    // Close the modal after room creation
                    setOpen(false);
                    // Route to the new room
                    router.navigate({ to: "/room/$roomid", params: { roomid: roomID } });
                  });
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
